/**
 * Ingest company-list exports as named, filterable sectors.
 *
 * The five "Companies List …" CSVs sitting in data/input had never been loaded:
 * `paths.companiesCsv` pointed at one file, so the database held only
 * startup-finder.csv and every company in it was cyber security. Sector could
 * not be a search parameter because there was only one sector.
 *
 * A company can appear in several lists, so membership is many-to-many. Sector is
 * also lifted out of the metadata JSON blob into a real column so it can be
 * indexed and filtered.
 */
import { basename } from 'node:path';
import { db, now } from '../db/client.js';
import { readCsv, unwrapExcel } from '../util/csv.js';
import { normalizeCompany } from '../util/normalize.js';
import { invalidateCompanyCache } from '../db/companies.js';

export interface ListIngestResult {
  list: string;
  companiesInFile: number;
  newCompanies: number;
  linked: number;
}

/** Pick the column most likely to hold the company name. */
function findNameKey(headers: string[]): string {
  const lc = headers.map((h) => h.toLowerCase());
  const exact = lc.findIndex((h) => h === 'company' || h === 'company name' || h === 'name');
  if (exact >= 0) return headers[exact];
  const partial = lc.findIndex((h) => h.includes('company') || h.includes('name'));
  if (partial >= 0) return headers[partial];
  return headers[0];
}

const SECTOR_KEYS = ['Primary Sector', 'Sector', 'Industry', 'Primary Industry'];

function sectorOf(row: Record<string, string>): string | null {
  for (const k of SECTOR_KEYS) {
    const v = unwrapExcel(row[k] ?? '');
    if (v) return v;
  }
  return null;
}

/**
 * Derive a readable list name from an export filename.
 * "Companies List Energy Tech 2026-07-06 1783342580908.csv" -> "Energy Tech".
 */
export function listNameFromFile(file: string): string {
  return (
    basename(file)
      .replace(/\.csv$/i, '')
      .replace(/^Companies List\s*/i, '')
      // Startup Nation Central appends an export date and a millisecond stamp.
      .replace(/\s*\d{4}-\d{2}-\d{2}\s*\d{6,}\s*$/, '')
      .replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim() || basename(file)
  );
}

export function ingestCompanyList(path: string, listName?: string): ListIngestResult {
  const rows = readCsv(path);
  const name = listName?.trim() || listNameFromFile(path);
  if (rows.length === 0) return { list: name, companiesInFile: 0, newCompanies: 0, linked: 0 };

  const headers = Object.keys(rows[0]);
  const nameKey = findNameKey(headers);
  const handle = db();

  handle
    .prepare(
      `INSERT INTO company_lists (name, source_file, imported_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET source_file = excluded.source_file, imported_at = excluded.imported_at`,
    )
    .run(name, basename(path), now());
  const listId = (handle.prepare('SELECT id FROM company_lists WHERE name = ?').get(name) as { id: number }).id;

  // Re-running must not reset a company's search status or wipe a resolved
  // careers URL — only refresh what the export actually carries.
  const upsertCompany = handle.prepare(
    `INSERT INTO companies (name, name_norm, metadata, sector, website_url, status, created_at)
     VALUES (@name, @name_norm, @metadata, @sector, @website_url, 'pending', @created_at)
     ON CONFLICT(name_norm) DO UPDATE SET
       metadata    = excluded.metadata,
       sector      = COALESCE(excluded.sector, companies.sector),
       website_url = COALESCE(companies.website_url, excluded.website_url)`,
  );
  const link = handle.prepare(
    'INSERT INTO company_list_members (list_id, company_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );
  const findId = handle.prepare('SELECT id FROM companies WHERE name_norm = ?');

  let companiesInFile = 0;
  let newCompanies = 0;
  let linked = 0;

  const tx = handle.transaction((records: Record<string, string>[]) => {
    for (const r of records) {
      const companyName = unwrapExcel(r[nameKey] ?? '');
      if (!companyName) continue;
      const nameNorm = normalizeCompany(companyName);
      if (!nameNorm) continue;
      companiesInFile++;

      const metadata: Record<string, string> = {};
      let websiteUrl: string | null = null;
      for (const [k, v] of Object.entries(r)) {
        if (k === nameKey) continue;
        const clean = unwrapExcel(v ?? '');
        if (!clean) continue;
        metadata[k] = clean;
        if (!websiteUrl && /^(website|url|domain|homepage)$/i.test(k)) websiteUrl = clean;
      }

      const existed = findId.get(nameNorm) as { id: number } | undefined;
      upsertCompany.run({
        name: companyName,
        name_norm: nameNorm,
        metadata: JSON.stringify(metadata),
        sector: sectorOf(r),
        website_url: websiteUrl,
        created_at: now(),
      });
      if (!existed) newCompanies++;

      const row = (existed ?? findId.get(nameNorm)) as { id: number } | undefined;
      if (row) {
        const info = link.run(listId, row.id);
        if (info.changes > 0) linked++;
      }
    }
  });

  tx(rows);
  invalidateCompanyCache();
  return { list: name, companiesInFile, newCompanies, linked };
}

export interface SectorSummary {
  id: number;
  name: string;
  companies: number;
  /** Companies the searcher has actually visited. */
  visited: number;
  /** Visited companies that yielded at least one role. */
  withPositions: number;
}

/**
 * The lists available to search.
 *
 * `visited` and `withPositions` are deliberately separate numbers. Most crawled
 * companies yield nothing — no careers page resolved, or one the extractor could
 * not read — and conflating the two makes a finished sector look half-done and
 * invites paying to crawl it again.
 */
export function listSectors(): SectorSummary[] {
  return db()
    .prepare(
      `SELECT l.id, l.name,
              COUNT(m.company_id) AS companies,
              SUM(CASE WHEN c.status = 'checked' THEN 1 ELSE 0 END) AS visited,
              SUM(CASE WHEN EXISTS(SELECT 1 FROM positions p WHERE p.company_id = m.company_id)
                       THEN 1 ELSE 0 END) AS withPositions
         FROM company_lists l
         LEFT JOIN company_list_members m ON m.list_id = l.id
         LEFT JOIN companies c ON c.id = m.company_id
        GROUP BY l.id
        ORDER BY l.name COLLATE NOCASE`,
    )
    .all() as SectorSummary[];
}
