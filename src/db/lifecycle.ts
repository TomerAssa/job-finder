/**
 * Company lifecycle: which companies are worth crawling, and why not.
 *
 * A sweep over a few thousand companies spends most of its credits confirming
 * nothing. Some of that is unavoidable — a real company with a JS careers
 * portal is a genuine miss worth retrying — but a large slice is companies that
 * have simply stopped existing, and those were being paid for on every cycle
 * because an absent careers page looks identical whatever caused it.
 *
 * This layer separates the causes, writes them down with the evidence, and
 * exposes them as lists the user can triage: skip, or check by hand.
 *
 * Nothing here deletes a company. A flag is a reason to stop spending on one,
 * not grounds for throwing away a row the user may have notes against.
 */
import { basename } from 'node:path';
import { db, now } from './client.js';
import { readCsv, unwrapExcel } from '../util/csv.js';
import { normalizeCompany, similarity } from '../util/normalize.js';
import { hostOf, hostLooksLikeCompany, isJobBoardHost } from '../util/hosts.js';
import { looksAcquired } from '../util/brand.js';
import { invalidateCompanyCache } from './companies.js';

/** States a company can be parked in. `live` is the only one that still crawls. */
export type Lifecycle =
  | 'suspected_closed'
  | 'acquired'
  | 'no_web_presence'
  | 'out_of_scope'
  | 'live';

/** Every state that puts a company on a list, whether or not it stops the crawl. */
export const DORMANT_STATES: readonly Lifecycle[] = [
  'suspected_closed', 'acquired', 'no_web_presence', 'out_of_scope',
];

/**
 * The states that actually stop the crawl — and the ones that deliberately do not.
 *
 * These are two different answers to two different questions, and collapsing
 * them cost real money the first time: parking every flagged company skipped
 * Augury, a company with hundreds of employees that is plainly hiring, because
 * the only host a SERP had ever returned for it was a job board. "We could not
 * find their site" is a statement about our search, not about the company, and
 * a later crawl may well resolve it — SERP results move.
 *
 * So `suspected_closed` and `out_of_scope` are claims about the company and are
 * worth no further spend. `no_web_presence` is a claim about us: it goes on a
 * list for a human to look at, and keeps getting crawled at the normal price.
 */
export const SKIP_STATES: readonly Lifecycle[] = ['suspected_closed', 'acquired', 'out_of_scope'];
export const REVIEW_STATES: readonly Lifecycle[] = ['no_web_presence'];

/** Human label and the visible list each dormant state maintains. */
export const STATE_LISTS: Record<Lifecycle, string | null> = {
  suspected_closed: '⚠ Suspected closed',
  // Its own list, because it means something different and leads somewhere:
  // the openings moved to the acquirer rather than vanishing.
  acquired: '→ Acquired (jobs moved to the buyer)',
  no_web_presence: '⚠ No website found',
  out_of_scope: '⚠ Out of scope (not Israeli)',
  live: null, // confirmed-live companies belong to their real sectors, not a flag list
};

/**
 * A lifecycle operation that could not be done, with the reason the user needs
 * in order to fix it. Thrown rather than returned empty: a seed that silently
 * imported nothing is how a skip list stays empty while the crawl keeps paying.
 */
export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleError';
  }
}

/**
 * SQL predicate for companies a crawl should still consider.
 *
 * Shared by the searcher's selection and by `dueCount`, for the same reason
 * `unresolvedBackoffClause()` is shared: a progress bar whose target counts
 * companies the run then skips looks like a stall.
 */
export function activeCompanyClause(): string {
  return `(lifecycle IS NULL OR lifecycle NOT IN (${SKIP_STATES.map((s) => `'${s}'`).join(',')}))`;
}

/** True when this state takes a company out of the crawl. */
export function skipsCrawl(state: string | null | undefined): boolean {
  return !!state && (SKIP_STATES as readonly string[]).includes(state);
}

/** How many companies in scope are flagged, by state. Used to explain an empty selection. */
export function dormantCounts(listIds?: number[]): Record<string, number> {
  const scope = listIds?.length
    ? `AND id IN (SELECT company_id FROM company_list_members WHERE list_id IN (${listIds.map(() => '?').join(',')}))`
    : '';
  const rows = db()
    .prepare(
      `SELECT lifecycle, COUNT(*) c FROM companies
        WHERE lifecycle IS NOT NULL AND lifecycle <> 'live' ${scope}
        GROUP BY lifecycle`,
    )
    .all(...(listIds ?? [])) as { lifecycle: string; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.lifecycle, r.c]));
}

export interface FlagInput {
  companyId: number;
  lifecycle: Lifecycle;
  reason: string;
  evidence: string;
  /** 'user' is permanent and overrides anything; 'auto' never overwrites 'user'. */
  source?: 'auto' | 'user';
  /** Who the company became — the acquirer, for an 'acquired' flag. */
  successor?: string | null;
}

/**
 * Park a company, or confirm it live.
 *
 * Returns false when the write was declined because the user had already ruled
 * on this company by hand — the house rule that anything the user typed outranks
 * anything a scraper found. The caller reports it; it is not an error.
 */
export function flagCompany(input: FlagInput): boolean {
  const source = input.source ?? 'auto';
  const current = db()
    .prepare('SELECT lifecycle_source FROM companies WHERE id = ?')
    .get(input.companyId) as { lifecycle_source: string } | undefined;
  if (!current) throw new LifecycleError(`No company with id ${input.companyId}`);
  if (source === 'auto' && current.lifecycle_source === 'user') return false;

  db()
    .prepare(
      `UPDATE companies
          SET lifecycle = ?, lifecycle_reason = ?, lifecycle_evidence = ?,
              lifecycle_source = ?, lifecycle_at = ?, lifecycle_successor = ?
        WHERE id = ?`,
    )
    .run(
      input.lifecycle, input.reason, input.evidence, source, now(),
      input.successor ?? null, input.companyId,
    );
  return true;
}

/**
 * Map a reason from the expansion vetting pass onto a lifecycle state.
 *
 * Returns null for a reason nobody has taught this function, so the caller can
 * report it instead of filing it under the nearest state. "Not Israeli" is not
 * "closed", and a skip list that blurs them cannot be audited later.
 */
export function lifecycleFromRemovalReason(
  raw: string,
): { lifecycle: Lifecycle; reason: string } | null {
  const r = raw.trim().toLowerCase();
  if (!r) return null;
  if (r === 'dead-domain') return { lifecycle: 'suspected_closed', reason: 'dead-domain' };
  if (r === 'closed') return { lifecycle: 'suspected_closed', reason: 'closed' };
  if (r === 'likely-closed') return { lifecycle: 'suspected_closed', reason: 'likely-closed' };
  if (r.startsWith('not-israeli')) return { lifecycle: 'out_of_scope', reason: 'not-israeli' };
  if (r === 'acquired' || r === 'merged') return { lifecycle: 'acquired', reason: 'acquired' };
  return null;
}

export interface SeedResult {
  rows: number;
  flagged: number;
  inserted: number;
  keptUserDecision: number;
  /** Reasons the mapping does not know. Reported, never guessed at. */
  unmapped: { name: string; reason: string }[];
}

/**
 * Load a vetting CSV (`List,Name,Reason,Evidence`) into the skip lists.
 *
 * Companies removed from an expansion before import are mostly not in the
 * database at all, so remembering them means inserting the row — otherwise the
 * next expansion re-adds all 233 of them and the crawl pays for every one again.
 */
export function seedFromRemovalCsv(path: string, opts: { dryRun?: boolean } = {}): SeedResult {
  const rows = readCsv(path);
  if (rows.length === 0) throw new LifecycleError(`${basename(path)} has no rows.`);

  const headers = Object.keys(rows[0]);
  for (const required of ['Name', 'Reason']) {
    if (!headers.includes(required)) {
      throw new LifecycleError(
        `${basename(path)} has no "${required}" column — found: ${headers.join(', ')}.`,
      );
    }
  }

  const result: SeedResult = { rows: 0, flagged: 0, inserted: 0, keptUserDecision: 0, unmapped: [] };
  const find = db().prepare('SELECT id FROM companies WHERE name_norm = ?');
  const insert = db().prepare(
    `INSERT INTO companies (name, name_norm, metadata, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`,
  );

  const apply = db().transaction(() => {
    for (const r of rows) {
      const name = unwrapExcel(r['Name'] ?? '');
      const nameNorm = normalizeCompany(name);
      if (!name || !nameNorm) continue;
      result.rows++;

      const mapped = lifecycleFromRemovalReason(unwrapExcel(r['Reason'] ?? ''));
      if (!mapped) {
        result.unmapped.push({ name, reason: unwrapExcel(r['Reason'] ?? '') });
        continue;
      }

      const evidence =
        unwrapExcel(r['Evidence'] ?? '') ||
        `Removed from ${unwrapExcel(r['List'] ?? 'an expansion')} during vetting.`;

      let row = find.get(nameNorm) as { id: number } | undefined;
      if (!row) {
        if (opts.dryRun) {
          result.inserted++;
          result.flagged++;
          continue;
        }
        const info = insert.run(
          name,
          nameNorm,
          JSON.stringify({ Source: 'expansion vetting', List: unwrapExcel(r['List'] ?? '') }),
          now(),
        );
        row = { id: Number(info.lastInsertRowid) };
        result.inserted++;
      }

      if (opts.dryRun) {
        result.flagged++;
        continue;
      }
      if (flagCompany({ companyId: row.id, lifecycle: mapped.lifecycle, reason: mapped.reason, evidence }))
        result.flagged++;
      else result.keptUserDecision++;
    }
  });

  apply();
  if (!opts.dryRun) invalidateCompanyCache();
  return result;
}

/** What repeated DNS lookups said about a hostname. */
export type DomainVerdict = 'alive' | 'dead' | 'unknown';

/**
 * Rule the domain dead only when every attempt agreed that it does not exist.
 *
 * The distinction between "no such domain" and "the lookup failed" is the whole
 * value of this check. NXDOMAIN is a fact about the world; SERVFAIL, a timeout
 * or a rate-limited resolver is a fact about the network, and parking a live
 * company on one of those is a silent, expensive error — the company never gets
 * crawled again and nothing says why. One resolving attempt beats any number of
 * failures, which is why `alive` wins outright.
 *
 * `attempts` holds one entry per lookup: null when it resolved, otherwise the
 * error code.
 */
export function domainVerdict(attempts: (string | null)[]): DomainVerdict {
  if (attempts.length === 0) return 'unknown';
  if (attempts.some((a) => a === null)) return 'alive';
  const notFound = (code: string) => /ENOTFOUND|NXDOMAIN|ENODATA/i.test(code);
  return attempts.every((a) => a !== null && notFound(a)) ? 'dead' : 'unknown';
}

export interface ScanResult {
  candidates: number;
  flagged: number;
  keptUserDecision: number;
  examples: { name: string; checkedAt: string | null }[];
}

/**
 * Park companies a crawl looked for and could not find on the web at all.
 *
 * `resolveCareers` keeps the first non-social host it sees across two SERP
 * queries — up to twenty results — so a checked company with no website and no
 * careers page is one where nothing company-owned came back for its own name.
 * That is a much stronger signal than a missing careers page on its own, and
 * it is the cheapest group to stop paying for.
 */
export function scanForNoWebPresence(opts: { dryRun?: boolean } = {}): ScanResult {
  const rows = db()
    .prepare(
      `SELECT id, name, last_checked_at FROM companies
        WHERE last_checked_at IS NOT NULL
          AND COALESCE(careers_url, '') = ''
          AND COALESCE(website_url, '') = ''
          AND lifecycle IS NULL
          AND is_demo = 0
        ORDER BY name COLLATE NOCASE`,
    )
    .all() as { id: number; name: string; last_checked_at: string | null }[];

  const result: ScanResult = {
    candidates: rows.length,
    flagged: 0,
    keptUserDecision: 0,
    examples: rows.slice(0, 10).map((r) => ({ name: r.name, checkedAt: r.last_checked_at })),
  };
  if (opts.dryRun) return result;

  const apply = db().transaction(() => {
    for (const r of rows) {
      const ok = flagCompany({
        companyId: r.id,
        lifecycle: 'no_web_presence',
        reason: 'no-website-found',
        evidence:
          `Searched ${r.last_checked_at ?? 'previously'}: two SERP queries for this name returned ` +
          `no company-owned site and no careers page.`,
      });
      if (ok) result.flagged++;
      else result.keptUserDecision++;
    }
  });
  apply();
  invalidateCompanyCache();
  return result;
}

export interface DnsScanResult {
  checked: number;
  dead: number;
  alive: number;
  unknown: number;
  keptUserDecision: number;
  examples: { name: string; host: string; verdict: DomainVerdict }[];
}

/** One DNS lookup: null when the host resolves, otherwise the error code. */
export type HostLookup = (host: string) => Promise<string | null>;

async function defaultLookup(host: string): Promise<string | null> {
  const { resolve4, resolve6 } = await import('node:dns/promises');
  try {
    await resolve4(host);
    return null;
  } catch (err4) {
    try {
      await resolve6(host);
      return null;
    } catch (err6) {
      const code = (err6 as NodeJS.ErrnoException)?.code ?? (err4 as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';
      return String(code);
    }
  }
}

/**
 * Park companies whose own domain no longer exists.
 *
 * This is where the dead ones actually show up. "No website at all" turned out
 * to catch exactly one company in sixteen hundred, because the resolver keeps
 * the first non-social host a SERP returns, so `website_url` is nearly always
 * set to something. Whether that something still resolves is the real question,
 * and DNS answers it for free — no BrightData credits, no page fetch.
 *
 * Each host is tried `attempts` times and parked only on a unanimous NXDOMAIN;
 * see `domainVerdict`.
 */
export async function scanDeadDomains(
  opts: {
    limit?: number;
    attempts?: number;
    dryRun?: boolean;
    includeResolved?: boolean;
    concurrency?: number;
    lookup?: HostLookup;
  } = {},
): Promise<DnsScanResult> {
  const attempts = Math.max(1, opts.attempts ?? 2);
  const lookup = opts.lookup ?? defaultLookup;
  const rows = db()
    .prepare(
      `SELECT id, name, website_url FROM companies
        WHERE COALESCE(website_url, '') <> ''
          AND lifecycle IS NULL
          AND is_demo = 0
          ${opts.includeResolved ? '' : `AND COALESCE(careers_url, '') = ''`}
        ORDER BY name COLLATE NOCASE
        ${opts.limit != null ? `LIMIT ${Math.max(0, Number(opts.limit))}` : ''}`,
    )
    .all() as { id: number; name: string; website_url: string }[];

  const result: DnsScanResult = {
    checked: 0, dead: 0, alive: 0, unknown: 0, keptUserDecision: 0, examples: [],
  };

  const { default: PQueue } = await import('p-queue');
  const queue = new PQueue({ concurrency: opts.concurrency ?? 12 });
  const verdicts: { id: number; name: string; host: string; verdict: DomainVerdict }[] = [];

  await queue.addAll(
    rows.map((r) => async () => {
      // An aggregator host says nothing about whether this company exists, so
      // its DNS answer must not be read as evidence either way.
      if (isJobBoardHost(r.website_url)) return;
      const host = hostOf(r.website_url);
      if (!host) return;
      const tries: (string | null)[] = [];
      for (let i = 0; i < attempts; i++) {
        tries.push(await lookup(host));
        if (tries[tries.length - 1] === null) break; // resolved; no need to retry
      }
      const verdict = domainVerdict(tries);
      result.checked++;
      result[verdict]++;
      verdicts.push({ id: r.id, name: r.name, host, verdict });
    }),
  );

  result.examples = verdicts.filter((v) => v.verdict === 'dead').slice(0, 15);
  if (opts.dryRun) return result;

  const write = db().transaction(() => {
    for (const v of verdicts) {
      if (v.verdict !== 'dead') continue;
      const ok = flagCompany({
        companyId: v.id,
        lifecycle: 'suspected_closed',
        reason: 'dead-domain',
        evidence: `DNS: ${v.host} did not resolve on ${attempts} attempt(s) (NXDOMAIN) on ${now().slice(0, 10)}.`,
      });
      if (!ok) result.keptUserDecision++;
    }
  });
  write();
  invalidateCompanyCache();
  return result;
}

/**
 * Park companies whose only known "website" is somebody else's job board.
 *
 * These are the ones where a crawl never found the company's own site — the
 * SERP came back with Wellfound, BuiltIn or a VC's portfolio board and nothing
 * else. That is not evidence the company is gone, so it is filed as
 * `no_web_presence` rather than closed: it is a manual-check queue, not a
 * graveyard.
 */
export function scanAggregatorOnly(opts: { dryRun?: boolean } = {}): ScanResult {
  const rows = (
    db()
      .prepare(
        `SELECT id, name, website_url, last_checked_at FROM companies
          WHERE COALESCE(website_url, '') <> ''
            AND COALESCE(careers_url, '') = ''
            AND lifecycle IS NULL
            AND is_demo = 0
          ORDER BY name COLLATE NOCASE`,
      )
      .all() as { id: number; name: string; website_url: string; last_checked_at: string | null }[]
  ).filter((r) => isJobBoardHost(r.website_url));

  const result: ScanResult = {
    candidates: rows.length,
    flagged: 0,
    keptUserDecision: 0,
    examples: rows.slice(0, 10).map((r) => ({ name: r.name, checkedAt: r.last_checked_at })),
  };
  if (opts.dryRun) return result;

  const write = db().transaction(() => {
    for (const r of rows) {
      const ok = flagCompany({
        companyId: r.id,
        lifecycle: 'no_web_presence',
        reason: 'aggregator-only',
        evidence: `No company-owned site was ever found — the only host on file is ${hostOf(r.website_url)}, a job board.`,
      });
      if (ok) result.flagged++;
      else result.keptUserDecision++;
    }
  });
  write();
  invalidateCompanyCache();
  return result;
}

export interface AcquiredScanResult {
  checked: number;
  flagged: number;
  keptUserDecision: number;
  /** Pages that named nobody, so nothing could be concluded. */
  inconclusive: number;
  /** Rows whose stored website is not demonstrably theirs, so not worth reading. */
  skippedUnverifiedHost: number;
  found: { name: string; successor: string; sawBrand: string | null }[];
}

/**
 * Find companies whose own site now serves somebody else's brand.
 *
 * The signal is specific: the page at their domain carries no mention of them
 * and does name another organisation. That is what an acquisition looks like
 * from outside — `cyberark.com` serves Palo Alto Networks, `votiro.com/careers`
 * serves Menlo Security — and it is invisible to every other check, because the
 * domain resolves and returns 200.
 *
 * Only acts when a successor can actually be named. "This page does not say
 * your name" also describes a rebrand and a generic holding page, and guessing
 * between them would produce a confident wrong answer, which is worse here than
 * no answer: the company would stop being crawled and the row would say why in
 * terms that were not true.
 */
export async function scanAcquisitions(
  opts: {
    fetch: (url: string) => Promise<string>;
    limit?: number;
    dryRun?: boolean;
    /** Also re-examine companies already parked as closed. */
    includeClosed?: boolean;
    concurrency?: number;
  },
): Promise<AcquiredScanResult> {
  const where = opts.includeClosed
    ? `(lifecycle IS NULL OR lifecycle = 'suspected_closed')`
    : 'lifecycle IS NULL';
  const rows = db()
    .prepare(
      `SELECT id, name, website_url FROM companies
        WHERE ${where}
          AND COALESCE(website_url, '') <> ''
          AND COALESCE(careers_url, '') = ''
          AND last_checked_at IS NOT NULL
          AND is_demo = 0
        ORDER BY name COLLATE NOCASE
        ${opts.limit != null ? `LIMIT ${Math.max(0, Number(opts.limit))}` : ''}`,
    )
    .all() as { id: number; name: string; website_url: string }[];

  const result: AcquiredScanResult = {
    checked: 0, flagged: 0, keptUserDecision: 0, inconclusive: 0, skippedUnverifiedHost: 0, found: [],
  };

  const { default: PQueue } = await import('p-queue');
  const queue = new PQueue({ concurrency: opts.concurrency ?? 6 });
  const hits: { id: number; name: string; successor: string; sawBrand: string | null }[] = [];

  await queue.addAll(
    rows.map((r) => async () => {
      // The same guard the careers probe needs, and for a sharper reason: a
      // dry run without it reported "2C3D -> Google" and "ADIN Dental Implants
      // -> Google", because those rows carry google.com as their website. The
      // detector would have parked three live companies as bought by Google.
      if (isJobBoardHost(r.website_url)) return;
      if (!hostLooksLikeCompany(hostOf(r.website_url), r.name, similarity)) {
        result.skippedUnverifiedHost++;
        return;
      }
      let html: string;
      try {
        html = await opts.fetch(r.website_url);
      } catch {
        // A fetch that failed is not evidence about the brand. No verdict.
        return;
      }
      result.checked++;
      const check = looksAcquired(html, r.name);
      if (!check || !check.successor) {
        result.inconclusive++;
        return;
      }
      hits.push({ id: r.id, name: r.name, successor: check.successor, sawBrand: check.sawBrand });
    }),
  );

  result.found = hits.map(({ name, successor, sawBrand }) => ({ name, successor, sawBrand }));
  if (opts.dryRun) {
    result.flagged = hits.length;
    return result;
  }

  const write = db().transaction(() => {
    for (const h of hits) {
      const ok = flagCompany({
        companyId: h.id,
        lifecycle: 'acquired',
        reason: 'brand-mismatch',
        evidence:
          `Their own site now serves another brand: "${h.sawBrand ?? h.successor}". ` +
          `Nothing on the page names ${h.name}. The openings are likely at ${h.successor}.`,
        successor: h.successor,
      });
      if (ok) result.flagged++;
      else result.keptUserDecision++;
    }
  });
  write();
  invalidateCompanyCache();
  return result;
}

/**
 * Record an acquisition by hand, with the acquirer.
 *
 * Stored as a user decision, so no scan can relabel it, and the successor is
 * the point: it says where to go looking instead.
 */
export function markAcquired(name: string, successor: string, evidence?: string): DormantRow | null {
  const nameNorm = normalizeCompany(name);
  const row = db().prepare('SELECT id FROM companies WHERE name_norm = ?').get(nameNorm) as
    | { id: number }
    | undefined;
  if (!row) return null;
  flagCompany({
    companyId: row.id,
    lifecycle: 'acquired',
    reason: 'acquired',
    evidence: evidence ?? `Acquired by ${successor}; recorded by hand.`,
    successor,
    source: 'user',
  });
  invalidateCompanyCache();
  return listDormant({ state: 'acquired' }).find((r) => r.id === row.id) ?? null;
}

/**
 * Rebuild the visible lists from the lifecycle column.
 *
 * The column is what the searcher obeys; these lists are what the user browses.
 * Deriving one from the other on demand keeps them from drifting apart, which a
 * pair of hand-maintained lists always eventually does.
 */
export function syncLifecycleLists(): Record<string, number> {
  const out: Record<string, number> = {};
  const apply = db().transaction(() => {
    for (const state of DORMANT_STATES) {
      const listName = STATE_LISTS[state];
      if (!listName) continue;
      db()
        .prepare(
          `INSERT INTO company_lists (name, source_file, imported_at) VALUES (?, 'derived:lifecycle', ?)
           ON CONFLICT(name) DO UPDATE SET imported_at = excluded.imported_at`,
        )
        .run(listName, now());
      const listId = (db().prepare('SELECT id FROM company_lists WHERE name = ?').get(listName) as { id: number }).id;

      db()
        .prepare(
          `DELETE FROM company_list_members
            WHERE list_id = ?
              AND company_id NOT IN (SELECT id FROM companies WHERE lifecycle = ?)`,
        )
        .run(listId, state);
      db()
        .prepare(
          `INSERT INTO company_list_members (list_id, company_id)
           SELECT ?, id FROM companies WHERE lifecycle = ?
           ON CONFLICT DO NOTHING`,
        )
        .run(listId, state);
      out[listName] = (
        db().prepare('SELECT COUNT(*) c FROM company_list_members WHERE list_id = ?').get(listId) as { c: number }
      ).c;
    }
  });
  apply();
  return out;
}

export interface DormantRow {
  id: number;
  name: string;
  sector: string | null;
  lifecycle: string;
  lifecycle_reason: string | null;
  lifecycle_evidence: string | null;
  lifecycle_source: string;
  lifecycle_at: string | null;
  lifecycle_successor: string | null;
  website_url: string | null;
  employees: string | null;
}

/** The parked companies, newest decision first. */
export function listDormant(opts: { state?: Lifecycle; limit?: number } = {}): DormantRow[] {
  const where = opts.state
    ? 'lifecycle = ?'
    : `lifecycle IS NOT NULL AND lifecycle <> 'live'`;
  const params = opts.state ? [opts.state] : [];
  return db()
    .prepare(
      `SELECT id, name, sector, lifecycle, lifecycle_reason, lifecycle_evidence,
              lifecycle_source, lifecycle_at, lifecycle_successor, website_url,
              json_extract(metadata, '$.Employees') AS employees
         FROM companies WHERE ${where}
        ORDER BY lifecycle, name COLLATE NOCASE
        ${opts.limit != null ? `LIMIT ${Math.max(0, Number(opts.limit))}` : ''}`,
    )
    .all(...params) as DormantRow[];
}

/**
 * Record that a manual check found a company alive after all.
 *
 * Stored as a 'user' decision so no later scan can park it again, and the
 * careers backoff is cleared too — the whole point of checking by hand is to
 * put the company back in the queue.
 */
export function markLive(name: string, evidence: string): DormantRow | null {
  const nameNorm = normalizeCompany(name);
  const row = db().prepare('SELECT id FROM companies WHERE name_norm = ?').get(nameNorm) as
    | { id: number }
    | undefined;
  if (!row) return null;
  flagCompany({
    companyId: row.id,
    lifecycle: 'live',
    reason: 'manual',
    evidence,
    source: 'user',
  });
  db().prepare('UPDATE companies SET careers_unresolved_at = NULL WHERE id = ?').run(row.id);
  invalidateCompanyCache();
  return listDormant({ state: 'live' }).find((r) => r.id === row.id) ?? null;
}

export interface CareersGapRow {
  id: number;
  name: string;
  sector: string | null;
  website_url: string | null;
  employees: string | null;
  last_checked_at: string | null;
  needs_llm: number;
  positions: number;
  /**
   * Whether `website_url` plausibly belongs to this company. The crawler stores
   * the first non-social host a search returned, which is often somebody
   * else's, so the host alone would send a manual dive to the wrong place.
   */
  own_site: boolean;
}

/**
 * Companies that demonstrably exist but whose openings we cannot see.
 *
 * This is the deep-dive queue, and the opposite of a skip list: a website came
 * back for the name, so the company is real, but no careers page resolved. The
 * cause is usually a JS portal, a careers page behind a cross-origin iframe, or
 * an ATS slug nothing matched — all of which a human can crack in a minute and
 * no amount of re-crawling will.
 *
 * Ordered by headcount, because that is the strongest predictor in this data of
 * whether a company is hiring at all.
 */
export function careersGap(opts: { listIds?: number[]; minEmployees?: boolean } = {}): CareersGapRow[] {
  const params: number[] = [];
  let scope = '';
  if (opts.listIds?.length) {
    scope = `AND c.id IN (SELECT company_id FROM company_list_members WHERE list_id IN (${opts.listIds
      .map(() => '?')
      .join(',')}))`;
    params.push(...opts.listIds);
  }
  const sizeRank = `CASE json_extract(c.metadata, '$.Employees')
      WHEN '500+' THEN 5 WHEN '201-500' THEN 4 WHEN '51-200' THEN 3
      WHEN '11-50' THEN 2 WHEN '1-10' THEN 1 ELSE 0 END`;
  const rows = db()
    .prepare(
      `SELECT c.id, c.name, c.sector, c.website_url,
              json_extract(c.metadata, '$.Employees') AS employees,
              c.last_checked_at, c.needs_llm,
              (SELECT COUNT(*) FROM positions p WHERE p.company_id = c.id) AS positions
         FROM companies c
        WHERE c.last_checked_at IS NOT NULL
          AND COALESCE(c.careers_url, '') = ''
          AND COALESCE(c.website_url, '') <> ''
          AND (c.lifecycle IS NULL OR c.lifecycle = 'live')
          AND c.is_demo = 0
          ${opts.minEmployees ? `AND ${sizeRank} >= 3` : ''}
          ${scope}
        ORDER BY ${sizeRank} DESC, c.name COLLATE NOCASE`,
    )
    .all(...params) as CareersGapRow[];
  // A company known only by somebody else's job board has not been shown to
  // exist, so it is a lead to chase elsewhere, not a careers page to go and
  // read. `scanAggregatorOnly` flags those; this keeps them out meanwhile.
  return rows
    .filter((r) => !isJobBoardHost(r.website_url ?? ''))
    .map((r) => ({
      ...r,
      own_site: hostLooksLikeCompany(hostOf(r.website_url), r.name, similarity),
    }))
    // The ones whose own site we have are the cheapest dives: open it and look.
    .sort((a, b) => Number(b.own_site) - Number(a.own_site));
}
