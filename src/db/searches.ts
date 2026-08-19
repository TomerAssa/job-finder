/**
 * Saved searches.
 *
 * Targeting used to be hardcoded in three places — the product-manager regex, an
 * Israel geo id, and whichever CSV happened to be loaded. A search is a stored,
 * re-runnable set of parameters instead.
 */
import { db, now } from './client.js';

export interface SearchParams {
  /** company_lists ids. Required: a search is always over a defined universe. */
  sectors: number[];
  /** Free-text title keywords. Empty falls back to the product-manager profile. */
  titleKeywords: string[];
  minYears: number | null;
  maxYears: number | null;
  /** Region hint used by sources that accept one. */
  location: string | null;
  /** Also query job boards for companies outside the selected lists. */
  includeOpenWeb: boolean;
}

export interface SavedSearch {
  id: number;
  name: string;
  params: SearchParams;
  createdAt: string;
  lastRunAt: string | null;
}

export const DEFAULT_PARAMS: SearchParams = {
  sectors: [],
  titleKeywords: [],
  minYears: null,
  maxYears: null,
  location: 'Israel',
  includeOpenWeb: false,
};

/** Tolerant of older stored shapes — a saved search must survive a schema change. */
export function parseParams(json: string): SearchParams {
  try {
    const raw = JSON.parse(json) as Partial<SearchParams>;
    return {
      ...DEFAULT_PARAMS,
      ...raw,
      sectors: Array.isArray(raw.sectors)
        ? raw.sectors.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [],
      titleKeywords: Array.isArray(raw.titleKeywords) ? raw.titleKeywords.filter(Boolean) : [],
    };
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

const toSaved = (r: Record<string, any>): SavedSearch => ({
  id: r.id,
  name: r.name,
  params: parseParams(r.params_json),
  createdAt: r.created_at,
  lastRunAt: r.last_run_at ?? null,
});

export function listSearches(): SavedSearch[] {
  return (
    db().prepare('SELECT * FROM saved_searches ORDER BY id DESC').all() as Record<string, any>[]
  ).map(toSaved);
}

export function getSearch(id: number): SavedSearch | null {
  const row = db().prepare('SELECT * FROM saved_searches WHERE id = ?').get(id) as Record<string, any> | undefined;
  return row ? toSaved(row) : null;
}

export function saveSearch(name: string, params: SearchParams): number {
  const info = db()
    .prepare('INSERT INTO saved_searches (name, params_json, created_at) VALUES (?, ?, ?)')
    .run(name.trim() || 'Untitled search', JSON.stringify(params), now());
  return Number(info.lastInsertRowid);
}

export function updateSearch(id: number, name: string, params: SearchParams): void {
  db()
    .prepare('UPDATE saved_searches SET name = ?, params_json = ? WHERE id = ?')
    .run(name.trim() || 'Untitled search', JSON.stringify(params), id);
}

export function deleteSearch(id: number): void {
  db().prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
}

export function markSearchRun(id: number): void {
  db().prepare('UPDATE saved_searches SET last_run_at = ? WHERE id = ?').run(now(), id);
}
