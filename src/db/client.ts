import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

let _db: Database.Database | null = null;

/** Returns a singleton SQLite handle, creating tables on first use. */
export function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(paths.db), { recursive: true });
  const handle = new Database(paths.db);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.exec(SCHEMA_SQL);
  _db = handle;
  return _db;
}

/** ISO-8601 timestamp helper (UTC) used for all *_at columns. */
export function now(): string {
  return new Date().toISOString();
}
