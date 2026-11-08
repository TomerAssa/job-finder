/**
 * Find a company's ATS board by guessing its slug and asking the ATS directly.
 *
 * This is the cheapest resolution path there is, and it exists because the two
 * dearer ones stopped working. Search returns `google.com/goto?url=…` wrappers
 * and aggregators (see probeDomain.ts), and probing conventional careers paths
 * on a company's own domain misses for most small startups — SURF Security
 * serves its 404 page at /careers with a 200, and that pattern is the norm.
 *
 * But the boards themselves have public JSON APIs, and `ats/apis.ts` calls them
 * with a plain `fetch` rather than through the proxy. So a guess costs **no
 * BrightData credits and no search**: build the handful of slugs a company
 * plausibly uses, ask each ATS, and keep the board that answers.
 *
 * The danger is obvious and is the one this codebase has been bitten by before:
 * a guessed slug can land on somebody else's board, which is how three openings
 * at Cyble arrived labelled "Cybool". Two guards, both deliberate:
 *
 *  1. A candidate slug is only tried if `tokenMatches()` would accept it for
 *     this company — the same rule, tightened to 0.95 similarity after real
 *     false positives, that gates the deterministic SERP fast-path.
 *  2. A board is only claimed when it actually returns at least one opening. A
 *     board with no jobs tells us nothing, and claiming it would record a
 *     careers URL nobody has verified.
 */
import { normalizeCompany } from '../../util/normalize.js';
import { tokenMatches } from './resolveCareers.js';
import { atsBoardUrl } from './probeDomain.js';
import {
  greenhouseJobs, leverJobs, workableJobs, ashbyJobs, smartRecruitersJobs, recruiteeJobs,
} from './ats/apis.js';
import type { AtsType, FoundPosition, Resolved } from './types.js';

/** Words companies drop when registering a board slug. */
const DROPPABLE = new Set([
  'security', 'cyber', 'cybersecurity', 'technologies', 'technology', 'tech', 'labs', 'lab',
  'systems', 'system', 'software', 'solutions', 'group', 'holdings', 'industries', 'ai', 'io',
  'digital', 'data', 'networks', 'network', 'medical', 'health', 'bio', 'pharma', 'energy',
  'israel', 'global', 'international', 'ltd', 'inc', 'llc', 'corp', 'company', 'co',
]);

/**
 * Slugs a company plausibly registered, best-first.
 *
 * Kept short on purpose: every candidate is an HTTP call per ATS, and a longer
 * list mostly adds ways to hit a stranger's board rather than ways to find
 * this one.
 */
export function slugCandidates(name: string): string[] {
  const norm = normalizeCompany(name);
  if (!norm) return [];
  const words = norm.split(' ').filter(Boolean);
  const kept = words.filter((w) => !DROPPABLE.has(w));

  const out = [
    words.join(''),           // "surfsecurity"
    words.join('-'),          // "surf-security"
    kept.join(''),            // "surf"
    kept.join('-'),
  ];

  // Rebrand tails. "SURF Security" runs its board as `surfai`, which no
  // rule derived from the registered name will ever produce — and it was found
  // only by searching the web by hand. The tails are few and each guess is a
  // free API call, and `tokenMatches` still has to accept whatever comes out,
  // so this widens the net without loosening the catch.
  const first = kept[0] ?? words[0];
  if (first && first.length >= 3) {
    for (const tail of ['ai', 'io', 'sec', 'hq']) out.push(`${first}${tail}`);
  }

  return [...new Set(out.map((s) => s.replace(/[^a-z0-9-]/g, '')).filter((s) => s.length >= 3))];
}

type Fetcher = (token: string) => Promise<FoundPosition[]>;

/** The boards worth asking, in rough order of how often they appear in this data. */
export function defaultBoards(): Array<[AtsType, Fetcher]> {
  return [
    ['greenhouse', greenhouseJobs],
    ['comeet', async () => { throw new Error('comeet has no slug-addressable API'); }],
    ['lever', leverJobs],
    ['ashby', ashbyJobs],
    ['workable', workableJobs],
    ['smartrecruiters', smartRecruitersJobs],
    ['recruitee', recruiteeJobs],
  ].filter(([t]) => t !== 'comeet') as Array<[AtsType, Fetcher]>;
}

export interface AtsSlugResult extends Resolved {
  /** Openings the board returned, so the caller need not fetch them again. */
  positions: FoundPosition[];
  slug?: string;
  /** API calls made. None are billable, but the number is worth logging. */
  calls: number;
}

/**
 * Ask each ATS whether it hosts a board for this company.
 *
 * Returns `careersUrl: null` when nothing answered — which is a real answer
 * here, unlike a timeout: these are direct API calls, and a 404 from Greenhouse
 * means that board does not exist.
 */
export async function probeAtsBySlug(
  name: string,
  opts: { boards?: Array<[AtsType, Fetcher]>; maxSlugs?: number } = {},
): Promise<AtsSlugResult> {
  const norm = normalizeCompany(name);
  const boards = opts.boards ?? defaultBoards();
  const slugs = slugCandidates(name)
    // Guard 1: never try a slug this company could not credibly own.
    .filter((s) => tokenMatches(norm, s))
    .slice(0, Math.max(1, opts.maxSlugs ?? 6));

  let calls = 0;
  for (const slug of slugs) {
    // All boards for one slug at once. Sequentially this was six round trips
    // per slug and dominated the wall clock of a crawl — 28 seconds a company —
    // despite costing nothing. A 404 is the expected answer for most guesses,
    // so failures are not errors here and no verdict is recorded from one.
    const answers = await Promise.allSettled(boards.map(([, fetcher]) => fetcher(slug)));
    calls += answers.length;

    for (let i = 0; i < answers.length; i++) {
      const a = answers[i];
      if (a.status !== 'fulfilled') continue;
      // Guard 2: an empty board is not evidence that it is theirs.
      if (!a.value.length) continue;
      const atsType = boards[i][0];
      return {
        careersUrl: atsBoardUrl(atsType, slug),
        atsType,
        token: slug,
        websiteUrl: null,
        positions: a.value,
        slug,
        calls,
      };
    }
  }
  return { careersUrl: null, atsType: 'unknown', websiteUrl: null, positions: [], calls };
}
