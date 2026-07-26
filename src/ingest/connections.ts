import { db, now } from '../db/client.js';
import { readCsv, readText } from '../util/csv.js';
import { normalizeCompany } from '../util/normalize.js';

/**
 * LinkedIn's "Connections.csv" starts with a few "Notes:" preamble lines before
 * the real header (First Name,Last Name,URL,Email Address,Company,Position,...).
 * Find that header line so csv-parse starts there.
 */
function headerLine(path: string): number {
  const lines = readText(path).split(/\r?\n/);
  const idx = lines.findIndex((l) => /^"?First Name"?,/i.test(l));
  return idx >= 0 ? idx + 1 : 1; // 1-based for csv-parse from_line
}

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.some((want) => k.toLowerCase() === want.toLowerCase())) return row[k] ?? '';
  }
  return '';
}

/** Ingest the user's 1st-degree connections. Company is kept normalized for the join. */
export function ingestConnections(path: string): { inserted: number; total: number } {
  const rows = readCsv(path, headerLine(path));
  const handle = db();

  const insert = handle.prepare(
    `INSERT INTO connections
       (first_name, last_name, full_name, company, company_norm, position, linkedin_url, imported_at)
     VALUES (@first_name, @last_name, @full_name, @company, @company_norm, @position, @linkedin_url, @imported_at)
     ON CONFLICT(full_name, company, linkedin_url) DO NOTHING`,
  );

  const tx = handle.transaction((records: Record<string, string>[]) => {
    let inserted = 0;
    for (const r of records) {
      const first = pick(r, 'First Name');
      const last = pick(r, 'Last Name');
      const full = `${first} ${last}`.trim();
      if (!full) continue;
      const company = pick(r, 'Company');
      const info = insert.run({
        first_name: first || null,
        last_name: last || null,
        full_name: full,
        company: company || null,
        company_norm: company ? normalizeCompany(company) : null,
        position: pick(r, 'Position') || null,
        linkedin_url: pick(r, 'URL') || null,
        imported_at: now(),
      });
      if (info.changes > 0) inserted++;
    }
    return inserted;
  });

  const inserted = tx(rows);
  const total = (handle.prepare('SELECT COUNT(*) c FROM connections').get() as { c: number }).c;
  return { inserted, total };
}
