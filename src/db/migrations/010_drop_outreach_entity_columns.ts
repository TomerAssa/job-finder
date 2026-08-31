/**
 * Drop the outreach columns that pointed at the old `entities` table.
 *
 * A migration, not a line of SQL, because `ALTER TABLE ... DROP COLUMN` has no
 * `IF EXISTS`: a database created after these columns left the base schema has
 * nothing to drop, and the statement would fail rather than be skipped.
 */
import type Database from 'better-sqlite3';

const LEGACY = ['connector_entity_id', 'contact_entity_id'] as const;

export function up(handle: Database.Database): void {
  const columns = new Set(
    (handle.prepare('PRAGMA table_info(outreach)').all() as { name: string }[]).map((c) => c.name),
  );

  for (const column of LEGACY) {
    if (!columns.has(column)) continue;
    handle.exec(`ALTER TABLE outreach DROP COLUMN ${column}`);
  }
}
