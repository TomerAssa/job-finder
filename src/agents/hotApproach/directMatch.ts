import { db, now } from '../../db/client.js';
import { similarity } from '../../util/normalize.js';

interface CompanyLite { id: number; name_norm: string }
interface ConnLite { id: number; company_norm: string | null }

const FUZZY_THRESHOLD = 0.9;

/**
 * Match the user's 1st-degree connections to target companies purely from the
 * connections CSV (which already carries each connection's current company).
 * Exact normalized match first, then a fuzzy fallback bucketed by first word.
 * Companies with a warm intro get their positions shortlisted.
 */
export function runDirectMatch(): { intros: number; shortlisted: number } {
  const handle = db();
  const companies = handle
    .prepare(`SELECT id, name_norm FROM companies WHERE name_norm != ''`)
    .all() as CompanyLite[];
  const connections = handle
    .prepare(`SELECT id, company_norm FROM connections WHERE company_norm IS NOT NULL AND company_norm != ''`)
    .all() as ConnLite[];

  // Index companies for O(1) exact hits and small fuzzy buckets.
  const exact = new Map<string, number[]>();
  const byFirstWord = new Map<string, CompanyLite[]>();
  for (const c of companies) {
    (exact.get(c.name_norm) ?? exact.set(c.name_norm, []).get(c.name_norm)!).push(c.id);
    const fw = c.name_norm.split(' ')[0];
    (byFirstWord.get(fw) ?? byFirstWord.set(fw, []).get(fw)!).push(c);
  }

  const insertIntro = handle.prepare(
    `INSERT INTO warm_intros (company_id, connection_id, match_type, confidence, notes, created_at)
     VALUES (?, ?, 'direct', ?, ?, ?)
     ON CONFLICT(company_id, connection_id, match_type) DO NOTHING`,
  );

  const matchedCompanyIds = new Set<number>();
  let intros = 0;

  const tx = handle.transaction(() => {
    for (const conn of connections) {
      const cn = conn.company_norm!;
      const hits: Array<{ companyId: number; conf: number }> = [];

      const exactIds = exact.get(cn);
      if (exactIds) {
        for (const id of exactIds) hits.push({ companyId: id, conf: 1 });
      } else {
        const bucket = byFirstWord.get(cn.split(' ')[0]) ?? [];
        for (const c of bucket) {
          const s = similarity(cn, c.name_norm);
          if (s >= FUZZY_THRESHOLD) hits.push({ companyId: c.id, conf: Number(s.toFixed(3)) });
        }
      }

      for (const h of hits) {
        const note = h.conf < 1 ? `fuzzy company-name match (${h.conf})` : null;
        const info = insertIntro.run(h.companyId, conn.id, h.conf, note, now());
        if (info.changes > 0) intros++;
        matchedCompanyIds.add(h.companyId);
      }
    }
  });
  tx();

  // Shortlist positions at companies where we have a warm connection.
  let shortlisted = 0;
  if (matchedCompanyIds.size > 0) {
    const mark = handle.prepare(`UPDATE positions SET is_shortlisted = 1 WHERE company_id = ?`);
    const markTx = handle.transaction((ids: number[]) => {
      for (const id of ids) shortlisted += mark.run(id).changes;
    });
    markTx([...matchedCompanyIds]);
  }

  return { intros, shortlisted };
}
