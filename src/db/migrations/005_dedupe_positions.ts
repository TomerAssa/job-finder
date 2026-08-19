/**
 * Collapse duplicate positions and make the duplicate impossible.
 *
 * `UNIQUE(company_id, title, url)` cannot fire when url is NULL, because SQLite
 * treats every NULL as distinct — the same hole that let duplicate introduction
 * edges through. Roles extracted by the LLM have no URL, so each re-crawl
 * inserted another copy of every one of them.
 *
 * Rows that differ only by URL are left alone: two Greenhouse postings with the
 * same title are usually two real openings, and merging them would lose one.
 */
import type Database from 'better-sqlite3';

interface Row {
  id: number;
  company_id: number;
  title: string;
  url: string | null;
  discovered_at: string;
  last_seen_at: string | null;
  closed_at: string | null;
  description: string | null;
  is_shortlisted: number;
}

export function up(handle: Database.Database): void {
  const groups = handle
    .prepare(
      `SELECT company_id, lower(trim(title)) AS key_title, COALESCE(url,'') AS key_url, COUNT(*) AS n
         FROM positions
        GROUP BY company_id, lower(trim(title)), COALESCE(url,'')
       HAVING COUNT(*) > 1`,
    )
    .all() as { company_id: number; key_title: string; key_url: string; n: number }[];

  const rowsOf = handle.prepare(
    `SELECT id, company_id, title, url, discovered_at, last_seen_at, closed_at, description, is_shortlisted
       FROM positions
      WHERE company_id = ? AND lower(trim(title)) = ? AND COALESCE(url,'') = ?
      ORDER BY id`,
  );
  const hasTracking = handle.prepare('SELECT 1 FROM role_tracking WHERE position_id = ?');

  let removed = 0;

  for (const g of groups) {
    const rows = rowsOf.all(g.company_id, g.key_title, g.key_url) as Row[];
    if (rows.length < 2) continue;

    // Keep whichever row the user has already acted on; otherwise the oldest,
    // so anything referencing it by id keeps working.
    const keeper = rows.find((r) => hasTracking.get(r.id)) ?? rows[0];
    const dups = rows.filter((r) => r.id !== keeper.id);

    for (const d of dups) {
      // Tracking and outreach move across, unless the keeper already has its own.
      if (!hasTracking.get(keeper.id)) {
        handle.prepare('UPDATE OR IGNORE role_tracking SET position_id = ? WHERE position_id = ?').run(keeper.id, d.id);
      }
      handle.prepare('UPDATE OR IGNORE outreach SET position_id = ? WHERE position_id = ?').run(keeper.id, d.id);
      handle.prepare('UPDATE OR IGNORE position_requirements SET position_id = ? WHERE position_id = ?').run(keeper.id, d.id);
    }

    // The surviving row should describe the union of what we knew.
    const earliest = rows.reduce((a, b) => (a.discovered_at <= b.discovered_at ? a : b)).discovered_at;
    const latestSeen = rows
      .map((r) => r.last_seen_at)
      .filter((v): v is string => !!v)
      .sort()
      .pop() ?? null;
    const anyOpen = rows.some((r) => r.closed_at == null);
    const description = keeper.description ?? rows.find((r) => r.description)?.description ?? null;
    const url = keeper.url ?? rows.find((r) => r.url)?.url ?? null;
    const shortlisted = rows.some((r) => r.is_shortlisted) ? 1 : 0;

    handle
      .prepare(
        `UPDATE positions SET discovered_at=?, last_seen_at=?, closed_at=?, description=?, url=?, is_shortlisted=?
          WHERE id=?`,
      )
      .run(earliest, latestSeen, anyOpen ? null : rows[0].closed_at, description, url, shortlisted, keeper.id);

    const ids = dups.map((d) => d.id);
    handle.prepare(`DELETE FROM positions WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    removed += ids.length;
  }

  // Now that the table is clean, close the hole. COALESCE on the nullable column
  // is what makes this actually enforce anything.
  handle.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_dedupe
       ON positions(company_id, lower(trim(title)), COALESCE(url,''))`,
  );

  console.log(`   removed ${removed} duplicate positions`);
}
