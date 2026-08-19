/**
 * Long crawls, as background jobs.
 *
 * Crawling a whole sector takes far longer than a request can stay open, so the
 * work is detached from the caller: a row records what the run is doing, the
 * loop updates it after every chunk, and the browser polls. Closing the tab
 * stops nobody.
 *
 * The loop is also where a budget can be enforced. `runSearcher` knows how to
 * process a batch; only something that watches spend between batches can stop
 * partway through a sector because the credits ran out.
 */
import { db, now } from '../../db/client.js';
import { monthlyUsage } from '../../brightdata/client.js';
import { runSearcher } from './index.js';
import { runEnrich } from '../enrich/index.js';
import { config } from '../../config.js';

export interface CrawlRunRow {
  id: number;
  sectors_json: string;
  target_companies: number | null;
  credit_limit: number | null;
  force: number;
  status: 'running' | 'done' | 'stopped' | 'error';
  /** searching | reading | finished — what it is doing right now. */
  phase: string;
  companies_done: number;
  companies_total: number;
  positions_added: number;
  roles_added: number;
  positions_closed: number;
  credits_used: number;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface StartOptions {
  sectors: number[];
  /** Stop after this many companies. Null means everything currently due. */
  targetCompanies?: number | null;
  /** Stop once this many credits have gone. Null means no ceiling of its own. */
  creditLimit?: number | null;
  force?: boolean;
}

/** How often the expensive parts of progress are recomputed, in ms. */
const STATS_EVERY_MS = 2000;
const SPEND_EVERY_MS = 5000;

const scope = (sectors: number[]) =>
  `IN (SELECT company_id FROM company_list_members WHERE list_id IN (${sectors.map(() => '?').join(',')}))`;

/** Companies a run would still visit: never checked, or stale again. */
export function dueCount(sectors: number[], force = false): number {
  const clause = force
    ? '1=1'
    : `(last_checked_at IS NULL OR last_checked_at < datetime('now','-${Number(config.checkTtlDays)} days'))`;
  return (
    db()
      .prepare(`SELECT COUNT(*) c FROM companies WHERE id ${scope(sectors)} AND ${clause}`)
      .get(...sectors) as { c: number }
  ).c;
}

function stats(sectors: number[]) {
  const one = (sql: string) => (db().prepare(sql).get(...sectors) as { c: number }).c;
  return {
    positions: one(`SELECT COUNT(*) c FROM positions WHERE company_id ${scope(sectors)}`),
    roles: one(`SELECT COUNT(*) c FROM positions WHERE company_id ${scope(sectors)} AND is_product = 1`),
    closed: one(`SELECT COUNT(*) c FROM positions WHERE company_id ${scope(sectors)} AND closed_at IS NOT NULL`),
    runs: one(
      `SELECT COUNT(*) c FROM check_log WHERE agent='searcher' AND status IN ('ok','error')
        AND company_id ${scope(sectors)}`,
    ),
  };
}

export function getRun(id: number): CrawlRunRow | null {
  return (db().prepare('SELECT * FROM crawl_runs WHERE id = ?').get(id) as CrawlRunRow) ?? null;
}

/** The run in progress, if any. At most one runs at a time. */
export function activeRun(): CrawlRunRow | null {
  return (
    (db().prepare(`SELECT * FROM crawl_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1`).get() as CrawlRunRow) ??
    null
  );
}

export function latestRun(): CrawlRunRow | null {
  return (db().prepare('SELECT * FROM crawl_runs ORDER BY id DESC LIMIT 1').get() as CrawlRunRow) ?? null;
}

/** Ask a run to stop. It finishes the chunk in flight, then ends. */
export function stopRun(id: number): void {
  db()
    .prepare(`UPDATE crawl_runs SET status='stopped', finished_at=?, updated_at=? WHERE id=? AND status='running'`)
    .run(now(), now(), id);
}

const usage = async (): Promise<number> => {
  try {
    return await monthlyUsage();
  } catch {
    return 0;
  }
};

/**
 * Begin a run and return its id immediately. The work continues after the
 * response is sent; progress is read back with `getRun`.
 */
export function startRun(opts: StartOptions): CrawlRunRow {
  const existing = activeRun();
  if (existing) throw new Error(`A crawl is already running (run ${existing.id}). Stop it first.`);
  if (!opts.sectors.length) throw new Error('Pick at least one sector to search');

  const due = dueCount(opts.sectors, opts.force);
  const total = opts.targetCompanies != null ? Math.min(opts.targetCompanies, due) : due;

  const info = db()
    .prepare(
      `INSERT INTO crawl_runs
         (sectors_json, target_companies, credit_limit, force, companies_total, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      JSON.stringify(opts.sectors),
      opts.targetCompanies ?? null,
      opts.creditLimit ?? null,
      opts.force ? 1 : 0,
      total,
      now(),
      now(),
    );

  const id = Number(info.lastInsertRowid);
  // Deliberately not awaited: the caller gets the id and polls.
  void execute(id).catch((err) => {
    db()
      .prepare(`UPDATE crawl_runs SET status='error', error=?, finished_at=?, updated_at=? WHERE id=?`)
      .run(err instanceof Error ? err.message : String(err), now(), now(), id);
  });

  return getRun(id)!;
}

async function execute(id: number): Promise<void> {
  const run = getRun(id)!;
  const sectors = JSON.parse(run.sectors_json) as number[];
  const force = run.force === 1;

  const base = stats(sectors);
  const creditsAtStart = await usage();
  let lastKnownSpend = 0;
  let lastStatsAt = 0;
  let lastSpendAt = Date.now();
  let lastCounts = { positions: 0, roles: 0, closed: 0 };

  const update = db().prepare(
    `UPDATE crawl_runs SET companies_done=?, positions_added=?, roles_added=?, positions_closed=?,
                           credits_used=?, updated_at=? WHERE id=?`,
  );

  let done = 0;

  const current = getRun(id)!;
  const target = current.companies_total;

  if (target > 0 && dueCount(sectors, force) > 0) {
    // One queue for the whole run, not a batch at a time. Companies take
    // anywhere from a few seconds to a few minutes, so draining the queue
    // between batches left most workers idle waiting on the slowest member of
    // each one — the reason a run from the browser trailed the same work from a
    // terminal, which has always used a single queue.
    await runSearcher({
      listIds: sectors,
      limit: target,
      force,
      // Both callbacks sit on the critical path of every company, so neither
      // does more work than it has to. The counter is always current; the
      // aggregate counts and the Redis spend lookup are refreshed on a timer,
      // because a progress bar does not need them to the millisecond.
      onCompany: (n) => {
        done = n;
        const fresh = Date.now() - lastStatsAt > STATS_EVERY_MS;
        if (fresh) {
          lastStatsAt = Date.now();
          const after = stats(sectors);
          lastCounts = {
            positions: after.positions - base.positions,
            roles: after.roles - base.roles,
            closed: after.closed - base.closed,
          };
        }
        update.run(
          Math.min(n, target),
          lastCounts.positions,
          lastCounts.roles,
          lastCounts.closed,
          lastKnownSpend,
          now(),
          id,
        );
      },
      shouldStop: async () => {
        const live = getRun(id);
        if (!live || live.status !== 'running') return true;

        // Refreshed on a timer whether or not there is a ceiling: the figure is
        // also what the progress panel reports, and a run showing "0 credits"
        // while it spends them is worse than a slightly stale number.
        if (Date.now() - lastSpendAt > SPEND_EVERY_MS) {
          lastSpendAt = Date.now();
          lastKnownSpend = (await usage()) - creditsAtStart;
        }
        return live.credit_limit != null && lastKnownSpend >= live.credit_limit;
      },
    });
  }

  // Reading listings for experience and location costs no scrape credits, and
  // without it the filters the user came for do nothing on anything new.
  db().prepare(`UPDATE crawl_runs SET phase='reading', updated_at=? WHERE id=?`).run(now(), id);
  try {
    await runEnrich({ limit: 200 });
  } catch {
    /* enrichment is best-effort; the roles are already saved */
  }
  db().prepare(`UPDATE crawl_runs SET phase='finished', updated_at=? WHERE id=?`).run(now(), id);

  const final = stats(sectors);
  db()
    .prepare(
      `UPDATE crawl_runs SET status = CASE WHEN status='running' THEN 'done' ELSE status END,
              companies_done=?, positions_added=?, roles_added=?, positions_closed=?, credits_used=?,
              finished_at=?, updated_at=? WHERE id=?`,
    )
    .run(
      done,
      final.positions - base.positions,
      final.roles - base.roles,
      final.closed - base.closed,
      (await usage()) - creditsAtStart,
      now(),
      now(),
      id,
    );
}
