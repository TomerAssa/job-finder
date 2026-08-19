/**
 * Minimal forward-only migration runner.
 *
 * `SCHEMA_SQL` in schema.ts is `CREATE TABLE IF NOT EXISTS` only, which means a
 * column added to it later never reaches a database that already exists. Anything
 * that changes an existing database goes here instead.
 *
 * Migrations live in `src/db/migrations/` and are applied in filename order:
 *
 *   NNN_name.sql   executed as one script
 *   NNN_name.ts    dynamically imported; must export `up(handle)`
 *
 * Use `.ts` when the change needs real logic (normalization, backfills, graph
 * walks) and `.sql` when it is plain DDL. Each migration runs inside a
 * transaction and is recorded in `schema_migrations`; applying twice is a no-op.
 */
import type Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recomputeCircles } from './circles.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface TsMigration {
  up(handle: Database.Database): void;
}

function ensureTable(handle: Database.Database): void {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    );
  `);
}

/** Migration files on disk, sorted by their numeric prefix. */
function migrationFiles(): string[] {
  let names: string[];
  try {
    names = readdirSync(MIGRATIONS_DIR);
  } catch {
    return []; // no migrations directory yet
  }
  return names
    .filter((n) => /^\d+_.+\.(sql|ts)$/.test(n) && !n.endsWith('.d.ts'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function pendingMigrations(handle: Database.Database): string[] {
  ensureTable(handle);
  const applied = new Set(
    (handle.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
  );
  return migrationFiles().filter((f) => !applied.has(f));
}

/**
 * Apply every pending migration. Returns the ids applied (empty when up to date).
 *
 * better-sqlite3 is synchronous but a `.ts` migration is imported asynchronously,
 * so the file is loaded first and the transaction opened around `up()` only.
 */
export async function runMigrations(handle: Database.Database): Promise<string[]> {
  const pending = pendingMigrations(handle);
  if (!pending.length) return [];

  const record = handle.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const file of pending) {
    const path = join(MIGRATIONS_DIR, file);

    if (file.endsWith('.sql')) {
      const sql = readFileSync(path, 'utf8');
      handle.transaction(() => {
        handle.exec(sql);
        record.run(file, new Date().toISOString());
      })();
    } else {
      // The specifier is a runtime path, so bundlers cannot analyze it — and must
      // not try. Migrations only ever run from the CLI under tsx.
      const mod = (await import(/* webpackIgnore: true */ pathToFileURL(path).href)) as TsMigration;
      if (typeof mod.up !== 'function') {
        throw new Error(`Migration ${file} does not export up(handle)`);
      }
      handle.transaction(() => {
        mod.up(handle);
        record.run(file, new Date().toISOString());
      })();
    }
  }

  // Circles are derived from the introductions graph; a migration may have
  // rewritten it, so recompute once rather than making every migration remember.
  recomputeCircles(handle);
  return pending;
}
