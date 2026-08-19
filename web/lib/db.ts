import Database from 'better-sqlite3';
import { resolve } from 'node:path';

let _db: Database.Database | null = null;

/**
 * Shared connection to the pipeline's SQLite DB (one level up from web/).
 *
 * The web app reads the same file as the CLI but never migrates it — migrations
 * can be TypeScript modules and belong to the CLI's runtime. It checks instead,
 * so a stale schema fails once with an instruction rather than as a pile of
 * "no such table" errors from whichever query happens to run first.
 */
export function db(): Database.Database {
  if (_db) return _db;
  const path = process.env.JOB_DB ?? resolve(process.cwd(), '../data/output/job.db');
  const handle = new Database(path);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');

  const hasPeople = handle
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='people'`)
    .get();
  if (!hasPeople) {
    throw new Error(
      `The database at ${path} predates the people graph. Run \`npm run migrate\` from the project root.`,
    );
  }

  _db = handle;
  return _db;
}

export const nowIso = () => new Date().toISOString();
