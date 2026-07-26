import { db, now } from '../db/client.js';
import { readCsv, unwrapExcel } from '../util/csv.js';
import { normalizeCompany } from '../util/normalize.js';

/** Pick the column most likely to hold the company name. */
function findNameKey(headers: string[]): string {
  const lc = headers.map((h) => h.toLowerCase());
  const exact = lc.findIndex((h) => h === 'company' || h === 'company name' || h === 'name');
  if (exact >= 0) return headers[exact];
  const partial = lc.findIndex((h) => h.includes('company') || h.includes('name'));
  if (partial >= 0) return headers[partial];
  return headers[0];
}

/**
 * Ingest the Israel Startup Finder export. The export is name + metadata only,
 * so we store the name and keep every other column as JSON metadata. Idempotent:
 * re-running updates metadata but never resets a company's search status.
 */
export function ingestCompanies(path: string): { inserted: number; total: number } {
  const rows = readCsv(path);
  if (rows.length === 0) return { inserted: 0, total: 0 };

  const headers = Object.keys(rows[0]);
  const nameKey = findNameKey(headers);
  const handle = db();

  const insert = handle.prepare(
    `INSERT INTO companies (name, name_norm, metadata, status, created_at)
     VALUES (@name, @name_norm, @metadata, 'pending', @created_at)
     ON CONFLICT(name_norm) DO UPDATE SET metadata = excluded.metadata`,
  );

  const tx = handle.transaction((records: Record<string, string>[]) => {
    let inserted = 0;
    for (const r of records) {
      const name = unwrapExcel(r[nameKey] ?? '');
      if (!name) continue;
      const nameNorm = normalizeCompany(name);
      if (!nameNorm) continue;
      const metadata: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === nameKey) continue;
        const clean = unwrapExcel(v ?? '');
        if (clean) metadata[k] = clean;
      }
      const info = insert.run({
        name,
        name_norm: nameNorm,
        metadata: JSON.stringify(metadata),
        created_at: now(),
      });
      if (info.changes > 0 && info.lastInsertRowid) inserted++;
    }
    return inserted;
  });

  const inserted = tx(rows);
  const total = (handle.prepare('SELECT COUNT(*) c FROM companies').get() as { c: number }).c;
  return { inserted, total };
}
