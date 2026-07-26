import { serpSearch } from '../../brightdata/serp.js';
import { db, now } from '../../db/client.js';
import { normalizeCompany, normalizeName, similarity } from '../../util/normalize.js';
import { upsertEntity } from '../../db/entities.js';

interface Found { name: string; role: string; url: string; kind: 'pm' | 'hr' }

function parseProfiles(results: { title: string; url: string; description?: string }[], company: string, kind: 'pm' | 'hr'): Found[] {
  const cnorm = normalizeCompany(company);
  const out: Found[] = [];
  for (const r of results) {
    if (!/linkedin\.com\/(in|pub)\//i.test(r.url)) continue;
    const parts = r.title.split(/[-|–—]/).map((s) => s.trim()).filter(Boolean);
    const name = parts[0];
    if (!name || name.length > 60) continue;
    const role = parts[1] ?? '';
    // keep results that plausibly belong to the company (name/snippet mentions it)
    const hay = `${r.title} ${r.description ?? ''}`;
    if (cnorm && !normalizeCompany(hay).includes(cnorm.split(' ')[0])) continue;
    out.push({ name, role, url: r.url.split('?')[0], kind });
  }
  return out;
}

/**
 * Find PM peers + HR/recruiters in Israel for a company via LinkedIn (SERP),
 * persist them as entities, and return them. Real employee discovery for the
 * "Expand on employees" action.
 */
export async function findPeople(companyId: number): Promise<Array<{ id: number; name: string; role: string; kind: string; linkedin: string }>> {
  const company = (db().prepare('SELECT name FROM companies WHERE id=?').get(companyId) as any)?.name as string;
  if (!company) return [];

  const queries: Array<[string, 'pm' | 'hr']> = [
    [`site:linkedin.com/in "${company}" product manager (israel OR "tel aviv")`, 'pm'],
    [`site:linkedin.com/in "${company}" (recruiter OR "talent acquisition" OR "human resources") (israel OR "tel aviv")`, 'hr'],
  ];
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const [q, kind] of queries) {
    let res: any[] = [];
    try { res = await serpSearch(q, 10); } catch { continue; }
    for (const f of parseProfiles(res, company, kind)) {
      if (seen.has(f.url)) continue;
      seen.add(f.url);
      found.push(f);
    }
  }

  const out: Array<{ id: number; name: string; role: string; kind: string; linkedin: string }> = [];
  for (const f of found) {
    const id = upsertEntity({
      full_name: f.name, kind: f.kind, company, role: f.role || null,
      linkedin_url: f.url, source: 'serp', degree: 2,
    });
    out.push({ id, name: f.name, role: f.role, kind: f.kind, linkedin: f.url });
  }
  db().prepare(`INSERT INTO check_log (agent, company_id, started_at, finished_at, status, stats) VALUES ('people', ?, ?, ?, 'ok', ?)`)
    .run(companyId, now(), now(), JSON.stringify({ found: out.length }));
  return out;
}
