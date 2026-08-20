import PQueue from 'p-queue';
import { db, now } from '../../db/client.js';
import { startLog, finishLog } from '../../db/checkLog.js';
import type { CompanyRow } from '../../db/schema.js';
import type { FoundPosition } from './types.js';
import { config, requireBrightData } from '../../config.js';
import { isAuthError } from '../../brightdata/client.js';
import { isFresh, markFresh, redis } from '../../redis.js';
import { resolveCareers } from './resolveCareers.js';
import { extractPositions } from './extract.js';
import { linkedinPmJobs } from './sources/linkedin.js';
import { isProductManager } from '../../util/roles.js';
import { isSameJob } from './sameJob.js';

export interface SearchOpts {
  limit?: number;
  /**
   * Re-check every company in scope, however recently it was visited.
   * Without this, companies checked within CHECK_TTL_DAYS are left alone.
   */
  force?: boolean;
  /**
   * Restrict the crawl to companies in these lists (see `company_lists`).
   * Without it the searcher walks every company it knows about, which is now
   * thousands of rows across several sectors rather than one 500-row export.
   */
  listIds?: number[];
  /**
   * Called after each company finishes. Lets a long run report progress while
   * it is still going, rather than only between batches.
   */
  onCompany?: (done: number, total: number) => void;
  /**
   * Checked before each company starts. Lets a long run stop on a budget or a
   * cancellation without the caller having to slice the work into batches — and
   * batches are expensive here, because each one drains the queue before the
   * next refills it.
   */
  shouldStop?: () => boolean | Promise<boolean>;
}

export interface SearchRunResult {
  /** Companies actually processed. Authoritative — the caller must not infer it. */
  processed: number;
  /** Selected but skipped as still fresh. */
  skipped: number;
}

/**
 * A link to the careers page is not a link to the job.
 *
 * When a page has no per-role links — a JS careers site read as text — the
 * extractor sometimes returns the page's own URL for every role. Storing that
 * makes "job ↗" go to an index rather than the posting, and makes two sightings
 * of one role look like different postings because one run captured the page URL
 * and another captured nothing.
 */
function positionUrl(raw: string | null | undefined, careersUrl: string | null): string | null {
  const url = raw?.trim();
  if (!url) return null;
  if (!careersUrl) return url;
  const strip = (u: string) => u.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  return strip(url) === strip(careersUrl) ? null : url;
}

function upsertPositions(
  companyId: number,
  source: string,
  positions: FoundPosition[],
  careersUrl: string | null = null,
): { added: number; product: number; seen: Set<number> } {
  const insert = db().prepare(
    `INSERT INTO positions
       (company_id, title, location, url, source, description, is_product, discovered_at, last_seen_at)
     VALUES (@company_id, @title, @location, @url, @source, @description, @is_product, @discovered_at, @discovered_at)`,
  );
  // Every row already stored for this company under the same title. The match
  // cannot be done in SQL alone: whether two rows are one opening depends on the
  // source and the posting id inside the URL (see sameJob.ts).
  const siblings = db().prepare(
    `SELECT id, title, url, source FROM positions
      WHERE company_id = ? AND lower(trim(title)) = lower(trim(?))`,
  );
  const touch = db().prepare(
    `UPDATE positions SET last_seen_at = ?, closed_at = NULL,
            description = COALESCE(description, ?), location = COALESCE(location, ?)
      WHERE id = ?`,
  );
  let added = 0;
  let product = 0;
  const seen = new Set<number>();
  const tx = db().transaction((items: FoundPosition[]) => {
    for (const p of items) {
      if (!p.title) continue;
      const isProduct = isProductManager(p.title) ? 1 : 0;
      const title = p.title.trim();
      const url = positionUrl(p.url, careersUrl);
      const candidates = siblings.all(companyId, title) as { id: number; title: string; url: string | null; source: string | null }[];
      const existed = candidates.find((c) => isSameJob(c, { title, url, source }));
      if (existed) {
        // Already known: record that it is still advertised, and fill in
        // anything this source knows that the stored row does not.
        touch.run(now(), p.description ?? null, p.location ?? null, existed.id);
        seen.add(existed.id);
        continue;
      }

      const info = insert.run({
        company_id: companyId,
        title,
        location: p.location ?? null,
        url,
        source,
        description: p.description ?? null,
        is_product: isProduct,
        discovered_at: now(),
      });
      seen.add(Number(info.lastInsertRowid));
      added++;
      if (isProduct) product++;
    }
  });
  tx(positions);
  return { added, product, seen };
}

/**
 * Mark the postings a company no longer advertises as closed.
 *
 * Only ever called when the scrape actually returned something. An empty result
 * usually means the page moved or failed to parse, and treating that as "every
 * role here is gone" would wipe out a company's listings on one bad fetch.
 */
function closeVanishedPositions(companyId: number, seen: Set<number>): number {
  if (seen.size === 0) return 0;
  const ids = [...seen];
  const info = db()
    .prepare(
      `UPDATE positions SET closed_at = ?
        WHERE company_id = ? AND closed_at IS NULL
          AND id NOT IN (${ids.map(() => '?').join(',')})`,
    )
    .run(now(), companyId, ...ids);
  return info.changes;
}

async function processCompany(company: CompanyRow, force: boolean): Promise<string> {
  if (!force && (await isFresh(company.id))) {
    const logId = startLog('searcher', company.id);
    finishLog(logId, 'skipped', { reason: 'fresh' });
    return `· ${company.name}: skipped (checked recently)`;
  }

  const logId = startLog('searcher', company.id);
  try {
    // Reuse a previously resolved careers URL if we have one; else resolve via SERP.
    let careersUrl = company.careers_url;
    let atsType = company.ats_type ?? 'unknown';
    let token: string | undefined;
    let websiteUrl = company.website_url;

    if (!careersUrl || force) {
      let context: string | undefined;
      try {
        const meta = company.metadata ? JSON.parse(company.metadata) : {};
        context = [meta['Primary Sector'], meta['Description']].filter(Boolean).join(' — ').slice(0, 200) || undefined;
      } catch {
        /* ignore bad metadata */
      }
      const resolved = await resolveCareers(company.name, {
        hintDomain: company.website_url ?? undefined,
        context,
      });
      careersUrl = resolved.careersUrl;
      atsType = resolved.atsType;
      token = resolved.token;
      websiteUrl = resolved.websiteUrl ?? websiteUrl;
    }

    db()
      .prepare(
        `UPDATE companies SET careers_url = ?, ats_type = ?, website_url = ?,
           status = 'checked', last_error = NULL, last_checked_at = ? WHERE id = ?`,
      )
      .run(careersUrl, atsType, websiteUrl, now(), company.id);

    let added = 0;
    let found = 0;
    let product = 0;
    let source = 'none';
    let needsLlm = false;
    const seen = new Set<number>();
    if (careersUrl) {
      const result = await extractPositions({ careersUrl, atsType: atsType as any, token, websiteUrl });
      found = result.positions.length;
      source = result.source;
      needsLlm = result.needsLlm;
      const up = upsertPositions(company.id, source, result.positions, careersUrl);
      added = up.added;
      product = up.product;
      for (const id of up.seen) seen.add(id);
    }

    // LinkedIn Jobs safety net: PM roles in Israel — reaches companies whose own
    // careers site we couldn't scrape (SPA / cross-origin iframe ATS).
    let liProduct = 0;
    try {
      const liJobs = await linkedinPmJobs(company.name);
      if (liJobs.length) {
        const up2 = upsertPositions(company.id, 'linkedin', liJobs);
        liProduct = up2.product;
        product += up2.product;
        found += up2.added;
        for (const id of up2.seen) seen.add(id);
      }
    } catch {
      /* LinkedIn is optional */
    }

    const closed = closeVanishedPositions(company.id, seen);

    db().prepare(`UPDATE companies SET needs_llm = ? WHERE id = ?`).run(needsLlm ? 1 : 0, company.id);
    await markFresh(company.id, config.checkTtlDays);
    finishLog(logId, 'ok', { careersUrl, atsType, source, found, added, product, liProduct, needsLlm, closed });
    if (!careersUrl && found === 0) return `? ${company.name}: no careers page found`;
    const tag = product ? '★' : found ? '✓' : '·';
    return `${tag} ${company.name}: ${found} roles, ${product} PM${liProduct ? ` (${liProduct} via LinkedIn)` : ''}` +
      `${closed ? `, ${closed} closed` : ''} via ${source}${needsLlm ? ' [needs-llm]' : ''}`;
  } catch (err) {
    // Credentials are wrong: let the run abort rather than recording this
    // company as an error it could recover from on a retry.
    if (isAuthError(err)) throw err;
    let msg = err instanceof Error ? err.message : String(err);
    const cause = (err as any)?.cause;
    if (cause) msg += ` — cause: ${cause.message ?? cause.code ?? cause}`;
    db()
      .prepare(`UPDATE companies SET status = 'error', last_error = ?, last_checked_at = ? WHERE id = ?`)
      .run(msg, now(), company.id);
    finishLog(logId, 'error', { error: msg });
    return `✗ ${company.name}: ${msg}`;
  }
}

/**
 * Reset every company that does NOT yet have an Israel-based PM role back to
 * 'pending' so a re-scan re-processes them (now with the LinkedIn source + render).
 * Companies that already have an Israel PM role are left untouched.
 */
export async function resetNoPmCompanies(): Promise<number> {
  const info = db()
    .prepare(
      `UPDATE companies SET status = 'pending', needs_llm = 0
       WHERE status IN ('checked', 'error')
         AND id NOT IN (
           SELECT DISTINCT p.company_id FROM positions p
           JOIN position_requirements r ON r.position_id = p.id
           WHERE p.is_product = 1 AND r.is_israel = 1
         )`,
    )
    .run();
  try {
    const keys = await redis().keys('checked:*');
    if (keys.length) await redis().del(...keys);
  } catch {
    /* freshness clear is best-effort */
  }
  return info.changes;
}

/** Why a run selected no companies. The cause decides what the user should do. */
function explainEmptySelection(opts: SearchOpts, params: number[]): string {
  if (opts.limit != null && Number(opts.limit) <= 0) {
    return 'Nothing to search: the limit was 0. Raise --limit to actually visit anything.';
  }

  const scope = opts.listIds?.length
    ? `WHERE id IN (SELECT company_id FROM company_list_members WHERE list_id IN (${opts.listIds.map(() => '?').join(',')}))`
    : '';
  const inScope = (
    db().prepare(`SELECT COUNT(*) c FROM companies ${scope}`).get(...params) as { c: number }
  ).c;

  if (inScope === 0) {
    return opts.listIds?.length
      ? 'Nothing to search: that company list has no companies in it.'
      : 'Nothing to search: no companies loaded yet. Add a company list first.';
  }

  return (
    `Nothing to search: all ${inScope} companies in scope were checked within the last ` +
    `${config.checkTtlDays} days. Pass --force to re-check them anyway.`
  );
}

/** Run the searcher over pending/eligible companies with bounded concurrency. */
export async function runSearcher(opts: SearchOpts = {}): Promise<SearchRunResult> {
  requireBrightData();
  // Openings appear and close constantly, so a company is never finished — only
  // recently checked. Selecting on status alone meant a company was visited once
  // and never again, which made a fully-crawled sector look permanently done
  // while its listings moved on without us. Staleness is judged from
  // last_checked_at rather than Redis, because the Redis keys expire and the
  // question "when did we last look" has to survive that.
  const clauses = [
    opts.force
      ? '1=1'
      : `(status IN ('pending','error')
          OR last_checked_at IS NULL
          OR last_checked_at < datetime('now', '-${Number(config.checkTtlDays)} days'))`,
  ];
  const params: number[] = [];
  if (opts.listIds?.length) {
    clauses.push(
      `id IN (SELECT company_id FROM company_list_members
               WHERE list_id IN (${opts.listIds.map(() => '?').join(',')}))`,
    );
    params.push(...opts.listIds);
  }
  // `opts.limit != null`, not a truthiness check: `--limit 0` used to be falsy
  // and silently meant "no limit", i.e. crawl everything.
  const limit = opts.limit != null && Number.isFinite(opts.limit) ? `LIMIT ${Math.max(0, Number(opts.limit))}` : '';
  const companies = db()
    .prepare(
      // Never-visited first, then whatever has been waiting longest.
      `SELECT * FROM companies WHERE ${clauses.join(' AND ')}
        ORDER BY (last_checked_at IS NOT NULL), last_checked_at, id ${limit}`,
    )
    .all(...params) as CompanyRow[];

  if (companies.length === 0) {
    // Selecting nothing has several quite different causes, and telling the user
    // the wrong one sends them looking in the wrong place: "everything was
    // checked recently" is actively misleading when they asked for zero
    // companies, or when the scope is empty to begin with.
    console.log(explainEmptySelection(opts, params));
    return { processed: 0, skipped: 0 };
  }

  const n = companies.length;
  console.log(`🔎 Searching ${n} ${n === 1 ? 'company' : 'companies'} (concurrency ${config.searchConcurrency})…`);
  const queue = new PQueue({ concurrency: config.searchConcurrency });

  // An expired token fails every request identically. Without this the run would
  // walk the whole list, find nothing, and mark every company `checked` — which
  // is worse than failing, because a later run then skips them all.
  let authFailure: unknown = null;
  let processed = 0;
  let skipped = 0;

  let stopped = false;

  await queue.addAll(
    companies.map((c) => async () => {
      if (authFailure || stopped) return;
      if (opts.shouldStop && (await opts.shouldStop())) {
        stopped = true;
        queue.clear();
        return;
      }
      try {
        const line = await processCompany(c, opts.force ?? false);
        console.log('   ' + line);
        if (line.includes('skipped (checked recently)')) skipped++;
        else processed++;
        opts.onCompany?.(processed + skipped, companies.length);
      } catch (err) {
        if (isAuthError(err)) {
          authFailure = err;
          queue.clear();
          return;
        }
        throw err;
      }
    }),
  );

  if (authFailure) {
    throw new Error(
      `BrightData rejected the credentials, so nothing was searched: ` +
        `${authFailure instanceof Error ? authFailure.message : String(authFailure)}\n` +
        `Check BRIGHTDATA_API_KEY in .env — the companies were left untouched for a re-run.`,
    );
  }
  console.log('Done.');
  return { processed, skipped };
}
