import { z } from 'zod';
import { config } from '../../config.js';
import { serpSearch, type SerpResult } from '../../brightdata/serp.js';
import { extract } from '../../llm/provider.js';
import { normalizeCompany, similarity } from '../../util/normalize.js';
import { detectAts } from './ats/detect.js';
import type { Resolved } from './types.js';

const NON_COMPANY_HOSTS =
  /linkedin\.|facebook\.|twitter\.|x\.com|glassdoor\.|crunchbase\.|wikipedia\.|comparably\.|indeed\.|ziprecruiter\./i;

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
function tokenMatches(norm: string, token: string): boolean {
  const t = normalizeCompany(token).replace(/\s+/g, '');
  if (!t) return false;
  if (similarity(norm, t) >= 0.8) return true;
  const words = norm.split(' ').filter((w) => w.length >= 3);
  const first = words[0];
  if (!first) return false;
  return t === first || t.startsWith(first) || first.startsWith(t);
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
    } catch {
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
    const score = priority[detectAts(c.url).atsType] ?? 0;
    if (score > 0 && (!best || score > best.score)) best = { url: c.url, score };
  }
  return best ? resolvedFor(best.url, website) : { careersUrl: null, atsType: 'unknown', websiteUrl: website };
}
