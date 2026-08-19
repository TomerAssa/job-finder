/**
 * Blank position URLs that are really just the careers page.
 *
 * A careers page read as text has no per-role links, and the extractor
 * sometimes returned the page's own URL for every role on it. That makes "job ↗"
 * open an index instead of the posting, and it splits one role into two rows
 * when one run captured the page URL and the next captured nothing.
 *
 * Clearing them can create exact duplicates, so those are collapsed here too —
 * the unique index would otherwise reject the update.
 */
import type Database from 'better-sqlite3';

const strip = (u: string): string => u.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();

export function up(handle: Database.Database): void {
  const rows = handle
    .prepare(
      `SELECT p.id, p.url, p.company_id, lower(trim(p.title)) AS t, c.careers_url
         FROM positions p JOIN companies c ON c.id = p.company_id
        WHERE p.url IS NOT NULL AND c.careers_url IS NOT NULL`,
    )
    .all() as { id: number; url: string; company_id: number; t: string; careers_url: string }[];

  const offenders = rows.filter((r) => strip(r.url) === strip(r.careers_url));

  const urlless = handle.prepare(
    `SELECT id FROM positions WHERE company_id = ? AND lower(trim(title)) = ? AND url IS NULL AND id != ?`,
  );
  const hasTracking = handle.prepare('SELECT 1 FROM role_tracking WHERE position_id = ?');

  let cleared = 0;
  let merged = 0;

  for (const r of offenders) {
    const twin = urlless.get(r.company_id, r.t, r.id) as { id: number } | undefined;

    if (!twin) {
      handle.prepare('UPDATE positions SET url = NULL WHERE id = ?').run(r.id);
      cleared++;
      continue;
    }

    // The same role already exists without a URL. Keep whichever the user has
    // acted on and drop the other, since after clearing they would be identical.
    const keeper = hasTracking.get(r.id) ? r.id : hasTracking.get(twin.id) ? twin.id : twin.id;
    const drop = keeper === r.id ? twin.id : r.id;

    handle.prepare('UPDATE OR IGNORE role_tracking SET position_id=? WHERE position_id=?').run(keeper, drop);
    handle.prepare('UPDATE OR IGNORE outreach SET position_id=? WHERE position_id=?').run(keeper, drop);
    handle.prepare('UPDATE OR IGNORE position_requirements SET position_id=? WHERE position_id=?').run(keeper, drop);
    handle.prepare('DELETE FROM positions WHERE id = ?').run(drop);
    handle.prepare('UPDATE positions SET url = NULL WHERE id = ?').run(keeper);
    merged++;
  }

  console.log(`   cleared ${cleared} careers-page URLs, merged ${merged} rows they had split`);
}
