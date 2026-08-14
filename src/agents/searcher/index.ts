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

export interface SearchOpts {
  limit?: number;
  force?: boolean; // ignore Redis freshness and re-check
  /**
   * Restrict the crawl to companies in these lists (see `company_lists`).
   * Without it the searcher walks every company it knows about, which is now
   * thousands of rows across several sectors rather than one 500-row export.
   */
  listIds?: number[];
}

function upsertPositions(
  companyId: number,
  source: string,
  positions: FoundPosition[],
  dedupByTitle = false,
): { added: number; product: number } {
  const stmt = db().prepare(
    `INSERT INTO positions (company_id, title, location, url, source, description, is_product, discovered_at)
     VALUES (@company_id, @title, @location, @url, @source, @description, @is_product, @discovered_at)
     ON CONFLICT(company_id, title, url) DO NOTHING`,
  );
  const titleExists = db().prepare(
    `SELECT 1 FROM positions WHERE company_id = ? AND lower(title) = lower(?) LIMIT 1`,
  );
  let added = 0;
  let product = 0;
  const tx = db().transaction((items: FoundPosition[]) => {
    for (const p of items) {
      if (!p.title) continue;
      // Skip a role already captured from another source (cross-source de-dup).
      if (dedupByTitle && titleExists.get(companyId, p.title.trim())) continue;
      const isProduct = isProductManager(p.title) ? 1 : 0;
      const info = stmt.run({
        company_id: companyId,
        title: p.title.trim(),
        location: p.location ?? null,
        url: p.url ?? null,
        source,
        description: p.description ?? null,
        is_product: isProduct,
        discovered_at: now(),
      });
      if (info.changes > 0) {
        added++;
        if (isProduct) product++;
      }
    }
  });
  tx(positions);
  return { added, product };
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
    if (careersUrl) {
      const result = await extractPositions({ careersUrl, atsType: atsType as any, token, websiteUrl });
      found = result.positions.length;
      source = result.source;
      needsLlm = result.needsLlm;
      const up = upsertPositions(company.id, source, result.positions);
      added = up.added;
      product = up.product;
    }

    // LinkedIn Jobs safety net: PM roles in Israel — reaches companies whose own
    // careers site we couldn't scrape (SPA / cross-origin iframe ATS).
    let liProduct = 0;
    try {
      const liJobs = await linkedinPmJobs(company.name);
      if (liJobs.length) {
        const up2 = upsertPositions(company.id, 'linkedin', liJobs, true);
        liProduct = up2.product;
        product += up2.product;
        found += up2.added;
      }
    } catch {
      /* LinkedIn is optional */
    }

    db().prepare(`UPDATE companies SET needs_llm = ? WHERE id = ?`).run(needsLlm ? 1 : 0, company.id);
    await markFresh(company.id, config.checkTtlDays);
    finishLog(logId, 'ok', { careersUrl, atsType, source, found, added, product, liProduct, needsLlm });
    if (!careersUrl && found === 0) return `? ${company.name}: no careers page found`;
    const tag = product ? '★' : found ? '✓' : '·';
    return `${tag} ${company.name}: ${found} roles, ${product} PM${liProduct ? ` (${liProduct} via LinkedIn)` : ''} via ${source}${needsLlm ? ' [needs-llm]' : ''}`;
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

/** Run the searcher over pending/eligible companies with bounded concurrency. */
export async function runSearcher(opts: SearchOpts = {}): Promise<void> {
  requireBrightData();
  const clauses = [opts.force ? '1=1' : `status IN ('pending','error')`];
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
    .prepare(`SELECT * FROM companies WHERE ${clauses.join(' AND ')} ORDER BY id ${limit}`)
    .all(...params) as CompanyRow[];

  if (companies.length === 0) {
    console.log('No companies to search. Run `npm run ingest` first, or pass --force to re-check.');
    return;
  }

  console.log(`🔎 Searching ${companies.length} companies (concurrency ${config.searchConcurrency})…`);
  const queue = new PQueue({ concurrency: config.searchConcurrency });

  // An expired token fails every request identically. Without this the run would
  // walk the whole list, find nothing, and mark every company `checked` — which
  // is worse than failing, because a later run then skips them all.
  let authFailure: unknown = null;

  await queue.addAll(
    companies.map((c) => async () => {
      if (authFailure) return;
      try {
        const line = await processCompany(c, opts.force ?? false);
        console.log('   ' + line);
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
}
