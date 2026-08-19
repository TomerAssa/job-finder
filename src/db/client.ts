import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../config.js';
import { SCHEMA_SQL } from './schema.js';
import { pendingMigrations, runMigrations } from './migrate.js';

let _db: Database.Database | null = null;
let _migrationsChecked = false;

function open(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(paths.db), { recursive: true });
  const handle = new Database(paths.db);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.exec(SCHEMA_SQL);
  _db = handle;
  return handle;
}

/**
 * Open the database and bring the schema up to date. Async because migrations may
 * be TypeScript modules that have to be imported.
 *
 * The CLI calls this once at startup; everything else uses the synchronous `db()`.
 * Returns the migration ids applied, so callers can report them.
 */
export async function initDb(): Promise<string[]> {
  const handle = open();
  const applied = await runMigrations(handle);
  _migrationsChecked = true;
  return applied;
}

/**
 * Synchronous handle. Throws if migrations are outstanding rather than letting
 * queries fail one by one against a half-current schema.
 */
export function db(): Database.Database {
  const handle = open();
  if (!_migrationsChecked) {
    _migrationsChecked = true;
    const pending = pendingMigrations(handle);
    if (pending.length) {
      throw new Error(
        `Database schema is behind by ${pending.length} migration(s): ${pending.join(', ')}.\n` +
          `Run \`npm run job migrate\` to apply them.`,
      );
    }
  }
  return handle;
}

/** ISO-8601 timestamp helper (UTC) used for all *_at columns. */
export function now(): string {
  return new Date().toISOString();
}
