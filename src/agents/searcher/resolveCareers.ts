import { z } from 'zod';
import { config } from '../../config.js';
import { isAuthError } from '../../brightdata/client.js';
import { serpSearch, type SerpResult } from '../../brightdata/serp.js';
import { extract } from '../../llm/provider.js';
import { normalizeCompany, similarity } from '../../util/normalize.js';
import { detectAts } from './ats/detect.js';
import type { Resolved } from './types.js';

const NON_COMPANY_HOSTS =
  /linkedin\.|facebook\.|twitter\.|x\.com|glassdoor\.|crunchbase\.|wikipedia\.|comparably\.|indeed\.|ziprecruiter\./i;

/**
 * Hosts that list many companies' jobs, so a page on one is never *this*
 * company's careers page.
 *
 * Accepting one is not a cosmetic error: whatever roles the page happens to
 * show get scraped and filed under this company. That is how three openings at
 * Cyble arrived labelled "Cybool" — the resolver picked a LinkedIn jobs page
 * for a similarly-named company and an LLM read it as if it were the careers
 * site. Venture portfolio boards are the same trap wearing a company's domain.
 */
const JOB_BOARD_HOSTS =
  /linkedin\.|glassdoor\.|indeed\.|ziprecruiter\.|dice\.com|monster\.|wellfound\.|angel\.co|builtin\.|allremote\.|secretjobs\.|techaviv\.|crunchbase\.|portfoliojobs\.|\.vc$|\.vc\//i;

/** True when a URL lives on a multi-company job board rather than a company's own site or ATS. */
export function isJobBoardHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  // A venture fund's board is usually jobs.<fund>.com listing its portfolio.
  if (/^jobs\.(insightpartners|initialized|f2vc|jvpvc|decibel|greylock|sequoiacap|a16z|bvp|lightspeedvp)\./i.test(host)) {
    return true;
  }
  return JOB_BOARD_HOSTS.test(host);
}

const Select = z.object({ careers_url: z.string().nullable(), reason: z.string().optional() });

export interface ResolveOpts {
  hintDomain?: string;
  /** Short company context (sector + description) to help match ATS slugs. */
  context?: string;
}

function resolvedFor(url: string, website: string | null): Resolved {
  const d = detectAts(url);
  return { careersUrl: url, atsType: d.atsType, token: d.token, websiteUrl: website };
}

/**
 * True when an ATS slug clearly belongs to the company: high overall similarity,
 * or the slug equals/prefixes the company's distinctive first word (e.g. slug
 * "entro" or "dreamgroup" for "Entro Security" / "Dream Security"). Rejects
 * unrelated brands (slug "tenableinc"/"palantir"/"paytm").
 */
export function tokenMatches(norm: string, token: string): boolean {
  const t = normalizeCompany(token).replace(/\s+/g, '');
  if (!t) return false;
  // 0.8 accepted one-character differences between genuinely different
  // companies — "specter" scored 0.875 against both Specters and SpecterX, and
  // "celestia" 0.875 against Celestya. The matches this threshold exists for
  // (spacing and punctuation, "cyberark" for Cyber Ark) sit at or near 1.0, so
  // tightening it loses nothing real.
  if (similarity(norm, t) >= 0.95) return true;
  const words = norm.split(' ').filter((w) => w.length >= 3);
  const first = words[0];
  if (!first) return false;

  // The two prefix directions are not equally safe, and treating them as if
  // they were is what let one Ashby board be claimed by three companies at
  // once. A slug may EXTEND the company's distinctive word — "dreamgroup" for
  // Dream Security, a brand or parent group — because that still names this
  // company. But a slug that is merely a PREFIX of the name ("rain" for
  // RainCheck AI, Rainguard AI and Rein Security alike) names a shorter,
  // different company and matches every longer one that starts the same way.
  // Rejecting that direction costs nothing: the candidate falls through to the
  // LLM pick, which sees the sector and description too.
  return t === first || t.startsWith(first);
}

/**
 * Resolve a company to its OWN careers/ATS URL. Precision first: accept an ATS
 * board only when its slug clearly matches the company (deterministic fast-path);
 * otherwise ask Gemini — armed with the company's sector/description and result
 * snippets — to pick the URL for THIS exact company, or return none.
 */
export async function resolveCareers(name: string, opts: ResolveOpts = {}): Promise<Resolved> {
  const norm = normalizeCompany(name);
  const seen = new Map<string, SerpResult>();
  let website = opts.hintDomain ?? null;

  const queries = [
    `${name} careers jobs`,
    `${name} careers greenhouse OR lever OR comeet OR workable OR ashby`,
  ];

  for (const q of queries) {
    let results: SerpResult[] = [];
    try {
      results = await serpSearch(q, 10);
    } catch (err) {
      // Bad credentials fail every query the same way. Swallowing that would
      // report "no careers page found" for the whole list and mark each company
      // checked, so it has to reach the caller.
      if (isAuthError(err)) throw err;
      continue;
    }
    for (const r of results) {
      if (!seen.has(r.url)) seen.set(r.url, r);
      if (!website && !NON_COMPANY_HOSTS.test(r.url)) {
        try {
          website = new URL(r.url).origin;
        } catch {
          /* ignore */
        }
      }
    }

    const candidates = [...seen.values()];

    // Fast path: an ATS board whose slug clearly matches the company name.
    for (const c of candidates) {
      if (isJobBoardHost(c.url)) continue;
      const d = detectAts(c.url);
      if (d.token && tokenMatches(norm, d.token)) {
        return { careersUrl: c.url, atsType: d.atsType, token: d.token, websiteUrl: website };
      }
    }

    // Otherwise let Gemini disambiguate once we've gathered enough candidates.
    if (q === queries[queries.length - 1] || candidates.length >= 8) {
      const picked = await geminiPick(name, opts.context, candidates);
      if (picked) return resolvedFor(picked, website);
      if (config.searchUseLlm) return { careersUrl: null, atsType: 'unknown', websiteUrl: website };
      return deterministicPick(candidates, website);
    }
  }

  return { careersUrl: null, atsType: 'unknown', websiteUrl: website };
}

async function geminiPick(
  name: string,
  context: string | undefined,
  candidates: SerpResult[],
): Promise<string | null> {
  if (!config.searchUseLlm || candidates.length === 0) return null;
  const list = candidates
    .slice(0, 12)
    .map((c, i) => `${i + 1}. ${c.title}\n   ${c.url}\n   ${(c.description ?? '').slice(0, 140)}`)
    .join('\n');
  try {
    const sel = await extract(
      `Company: "${name}"${context ? ` — ${context}` : ''}.\n\n` +
        `Below are web search results. Return the ONE url that is this exact company's official ` +
        `careers/jobs page — their own site or their ATS board (Greenhouse, Lever, Workable, ` +
        `Comeet, Ashby, SmartRecruiters, Recruitee). NOTE: an ATS board slug is often the ` +
        `company's short name, brand, or parent group (e.g. "dreamgroup" for "Dream Security"), ` +
        `so a reasonable brand/sector match counts. But do NOT return a clearly DIFFERENT, ` +
        `well-known company's board (different industry or brand). If nothing plausibly belongs ` +
        `to "${name}", return null.\n\n` +
        `Return JSON: {"careers_url": "<url or null>"}\n\n${list}`,
      Select,
      { temperature: 0 },
    );
    const url = sel.careers_url?.trim();
    if (!url || !/^https?:\/\//.test(url)) return null;
    // The prompt asks for the company's own page, but a near-name match is
    // exactly where it gives in and returns an aggregator. Cheaper to refuse
    // here than to scrape a stranger's openings into this company's row.
    if (isJobBoardHost(url)) return null;
    return candidates.some((c) => c.url === url) ? url : null;
  } catch {
    return null;
  }
}

function deterministicPick(candidates: SerpResult[], website: string | null): Resolved {
  const priority: Record<string, number> = {
    greenhouse: 5, lever: 5, workable: 5, ashby: 5, smartrecruiters: 5, recruitee: 5, comeet: 4, generic: 2, unknown: 0,
  };
  let best: { url: string; score: number } | null = null;
  for (const c of candidates) {
    if (isJobBoardHost(c.url)) continue;
    const score = priority[detectAts(c.url).atsType] ?? 0;
    if (score > 0 && (!best || score > best.score)) best = { url: c.url, score };
  }
  return best ? resolvedFor(best.url, website) : { careersUrl: null, atsType: 'unknown', websiteUrl: website };
}
