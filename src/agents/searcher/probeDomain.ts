/**
 * Find a company's careers page on its own domain, without asking a search engine.
 *
 * Why this exists: the SERP layer stopped being usable. A fresh, uncached query
 * for "Votiro careers jobs" came back with GovCIO, a LinkedIn "VP Security jobs"
 * listing and "Tevora Information Security Director, Fairfax VA", and seven of
 * nine results were `google.com/goto?url=…` redirect wrappers rather than
 * destination URLs. DuckDuckGo returns real URLs but almost only aggregators —
 * Indeed, Glassdoor, ZipRecruiter — which the resolver is right to refuse. The
 * LLM was returning `{"careers_url": null}` because it was shown nothing usable,
 * and that is the real reason 1,162 companies have no careers page, not the
 * model.
 *
 * A company's careers page is almost always at a conventional path on its own
 * domain, so when we know the domain we can go straight there. It is cheaper
 * than the two SERP queries plus an LLM pick that it replaces, and it is
 * deterministic: no ranking, no snippets, nothing to misread.
 *
 * It needs a domain that really belongs to the company, which is the catch —
 * `companies.website_url` is often the first non-social host a SERP returned
 * (Aidoc is on file as google.com), so callers must check with
 * `hostLooksLikeCompany()` first.
 */
import { detectAtsInHtml, detectAts } from './ats/detect.js';
import { hostOf } from '../../util/hosts.js';
import { looksAcquired } from '../../util/brand.js';
import type { Resolved } from './types.js';

/**
 * Paths to try, best-first. Deliberately short: every one is a billable
 * request, and the point of this is to be cheaper than searching.
 */
export const CAREERS_PATHS = ['/careers', '/jobs', '/careers/open-positions', '/about/careers', '/join-us'];

/** A page that exists but is the site's "not found" page rather than a careers page. */
export function looksLikeNotFound(html: string): boolean {
  const head = html.slice(0, 4000);
  const title = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '';
  if (/not found|404|page (?:does not exist|you are looking for)|doesn'?t exist/i.test(title)) return true;
  // A body with no content to speak of is not a careers page either, whatever
  // it calls itself.
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 400;
}

/**
 * Does this page actually advertise jobs?
 *
 * Kept deliberately loose. A false positive costs one wasted extraction pass,
 * which the extractor then reports as zero roles; a false negative sends the
 * company back to the search engine that has already been shown not to work.
 */
export function looksLikeCareersPage(html: string): boolean {
  if (looksLikeNotFound(html)) return false;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const signals = [
    /open positions?/i, /job openings?/i, /we'?re hiring/i, /current openings?/i,
    /apply now/i, /view (?:all )?(?:jobs|positions)/i, /join (?:our|the) team/i,
    /careers? at/i, /all (?:jobs|positions|openings)/i,
  ];
  return signals.filter((re) => re.test(text)).length >= 1;
}

export interface ProbeOpts {
  /** Fetcher; injected in tests. Should throw on a hard failure. */
  fetch: (url: string) => Promise<string>;
  /**
   * The company this domain is supposed to belong to. Given it, the probe also
   * notices when the page has stopped being theirs.
   */
  companyName?: string;
  /** How many paths to try before giving up. Each one is billable. */
  maxPaths?: number;
  paths?: string[];
}

export interface ProbeResult extends Resolved {
  /** Which path produced the hit, for the run log. */
  via?: string;
  /** Requests actually spent, so a caller can report the cost. */
  requests: number;
  /** The organisation this domain now belongs to, when it is not the company's. */
  acquiredBy?: string | null;
  /** The brand string that said so, for the evidence column. */
  sawBrand?: string | null;
}

/**
 * Probe a company's own domain for its careers page.
 *
 * Returns the ATS board when the careers page embeds or links one — that is the
 * best possible answer, because a tokened board has a structured API and needs
 * no parsing at all. Otherwise returns the careers page itself for the
 * extractor to read. `careersUrl` is null when nothing was found.
 */
export async function probeCareersOnDomain(
  website: string,
  opts: ProbeOpts,
): Promise<ProbeResult> {
  const host = hostOf(website);
  const origin = (() => {
    try {
      return new URL(website).origin;
    } catch {
      return null;
    }
  })();
  if (!host || !origin) return { careersUrl: null, atsType: 'unknown', websiteUrl: website, requests: 0 };

  const paths = (opts.paths ?? CAREERS_PATHS).slice(0, Math.max(1, opts.maxPaths ?? 3));
  let requests = 0;

  for (const path of paths) {
    const url = `${origin}${path}`;
    let html: string;
    try {
      html = await opts.fetch(url);
      requests++;
    } catch {
      // One unreachable path says nothing about the next, and the caller still
      // has the search fallback. Not swallowed in the dangerous sense: no
      // verdict is recorded from a failure here.
      requests++;
      continue;
    }

    // Before anything is believed about this page: is it still theirs?
    //
    // This has to come first, and the ordering is the whole point. Votiro's
    // /careers serves Menlo Security's Ashby board, so a probe that looked for
    // an embedded ATS before checking the brand would hand Votiro's row the
    // acquirer's board and file Menlo's openings under Votiro — the same
    // mis-attribution that put 33 US federal roles under an Israeli company.
    if (opts.companyName) {
      const taken = looksAcquired(html, opts.companyName);
      if (taken?.successor) {
        return {
          careersUrl: null,
          atsType: 'unknown',
          websiteUrl: origin,
          via: path,
          requests,
          acquiredBy: taken.successor,
          sawBrand: taken.sawBrand,
        };
      }
    }

    // Best case: the page names an ATS board, which has a real API behind it.
    const embedded = detectAtsInHtml(html);
    if (embedded.atsType !== 'unknown') {
      const boardUrl = atsBoardUrl(embedded.atsType, embedded.token) ?? url;
      return {
        careersUrl: boardUrl,
        atsType: embedded.atsType,
        token: embedded.token,
        websiteUrl: origin,
        via: path,
        requests,
      };
    }

    if (looksLikeCareersPage(html)) {
      return {
        careersUrl: url,
        atsType: detectAts(url).atsType === 'unknown' ? 'generic' : detectAts(url).atsType,
        websiteUrl: origin,
        via: path,
        requests,
      };
    }
  }

  return { careersUrl: null, atsType: 'unknown', websiteUrl: origin, requests };
}

/** Canonical board URL for a tokened ATS, so the extractor can use its API. */
export function atsBoardUrl(atsType: string, token?: string): string | null {
  if (!token) return null;
  switch (atsType) {
    case 'greenhouse': return `https://boards.greenhouse.io/${token}`;
    case 'lever': return `https://jobs.lever.co/${token}`;
    case 'workable': return `https://apply.workable.com/${token}`;
    case 'ashby': return `https://jobs.ashbyhq.com/${token}`;
    case 'smartrecruiters': return `https://careers.smartrecruiters.com/${token}`;
    case 'recruitee': return `https://${token}.recruitee.com`;
    case 'bamboohr': return `https://${token}.bamboohr.com/careers`;
    default: return null;
  }
}
