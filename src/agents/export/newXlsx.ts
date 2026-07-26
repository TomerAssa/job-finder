import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { paths } from '../../config.js';

const skills = (j: string | null): string => {
  try { return (JSON.parse(j ?? '[]') as string[]).join(', '); } catch { return ''; }
};

/** Write an .xlsx of newly-scraped Israel PM roles (discovered on/after `since`). */
export function exportNewPositions(since: string): { count: number; file: string } {
  const rows = db()
    .prepare(
      `SELECT (CASE WHEN EXISTS(SELECT 1 FROM warm_intros w WHERE w.company_id=c.id) THEN '★' ELSE '' END) AS warm,
              c.name AS company, p.title, r.seniority, r.work_model, r.min_years, r.must_have_skills AS skills,
              COALESCE(r.normalized_location, p.location) AS location, p.url, p.source,
              t.relevant, t.status, t.applied_status AS my_notes, date(p.discovered_at) AS discovered
       FROM positions p JOIN companies c ON c.id = p.company_id
       LEFT JOIN position_requirements r ON r.position_id = p.id
       LEFT JOIN role_tracking t ON t.position_id = p.id
       WHERE p.is_product = 1 AND r.is_israel = 1 AND date(p.discovered_at) >= date(?)
       ORDER BY warm DESC, c.name COLLATE NOCASE, p.title`,
    )
    .all(since) as any[];

  const data = rows.map((r) => ({
    warm: r.warm, company: r.company, title: r.title, seniority: r.seniority ?? '', work_model: r.work_model ?? '',
    min_years: r.min_years ?? '', must_have_skills: skills(r.skills), location: r.location ?? '', url: r.url ?? '',
    source: r.source ?? '', relevant: r.relevant ?? '', status: r.status ?? '', my_notes: r.my_notes ?? '', discovered: r.discovered,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 5 }, { wch: 22 }, { wch: 38 }, { wch: 10 }, { wch: 9 }, { wch: 7 }, { wch: 40 }, { wch: 18 }, { wch: 44 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 30 }, { wch: 11 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'new positions');
  const file = resolve(paths.outputDir, 'positions-new.xlsx');
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return { count: data.length, file };
}
