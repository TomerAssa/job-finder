import Database from 'better-sqlite3';
import { resolve } from 'node:path';

let _db: Database.Database | null = null;

/** Shared connection to the pipeline's SQLite DB (one level up from web/). */
export function db(): Database.Database {
  if (_db) return _db;
  const path = process.env.JOB_DB ?? resolve(process.cwd(), '../data/output/job.db');
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export const nowIso = () => new Date().toISOString();
