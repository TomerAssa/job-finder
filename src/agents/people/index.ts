import { serpSearch } from '../../brightdata/serp.js';
import { db, now } from '../../db/client.js';
import { normalizeCompany } from '../../util/normalize.js';
import { normalizeLinkedinUrl } from '../../util/linkedin.js';

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

export interface Candidate {
  id: number;
  name: string;
  role: string;
  kind: string;
  linkedin: string;
  confidence: number;
}

/**
 * Find PM peers + HR/recruiters in Israel for a company via LinkedIn (SERP).
 *
 * Results land in `person_candidates` for review — they are search-result guesses,
 * not people the user knows, and nothing enters `people` without being kept.
 *
 * Throws on failure rather than returning an empty array. The previous version
 * swallowed every error, which is why this agent appeared to find nothing for
 * months instead of reporting that it was broken.
 */
export async function findPeople(companyId: number): Promise<Candidate[]> {
  const handle = db();
  const startedAt = now();

  const company = (
    handle.prepare('SELECT name FROM companies WHERE id=?').get(companyId) as
      | { name: string }
      | undefined
  )?.name;
  if (!company) throw new Error(`No company with id ${companyId}`);

  const queries: Array<[string, 'pm' | 'hr']> = [
    [`site:linkedin.com/in "${company}" product manager (israel OR "tel aviv")`, 'pm'],
    [`site:linkedin.com/in "${company}" (recruiter OR "talent acquisition" OR "human resources") (israel OR "tel aviv")`, 'hr'],
  ];

  const found: Found[] = [];
  const seen = new Set<string>();
  const failures: string[] = [];

  for (const [q, kind] of queries) {
    try {
      const res = await serpSearch(q, 10);
      for (const f of parseProfiles(res, company, kind)) {
        const url = normalizeLinkedinUrl(f.url) ?? f.url;
        if (seen.has(url)) continue;
        seen.add(url);
        found.push({ ...f, url });
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Every search failed: that is an error, not "no results".
  if (failures.length === queries.length) {
    logCheck(companyId, startedAt, 'error', { failures });
    throw new Error(`People search failed for ${company}: ${failures.join('; ')}`);
  }

  const insert = handle.prepare(
    `INSERT INTO person_candidates
       (company_id, full_name, role, linkedin_url, source, confidence, raw, found_at)
     VALUES (?, ?, ?, ?, 'serp', ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );

  const out: Candidate[] = [];
  for (const f of found) {
    // A bare SERP hit is a guess: the query matched the company name somewhere on
    // a profile page, which is weak evidence. Phase 4 raises this for companies
    // whose LinkedIn page is verified against their website.
    const confidence = 0.4;
    insert.run(companyId, f.name, f.role || null, f.url, confidence, JSON.stringify(f), now());
    const row = handle
      .prepare(
        `SELECT id FROM person_candidates
          WHERE COALESCE(company_id,0)=? AND COALESCE(linkedin_url, full_name)=?`,
      )
      .get(companyId, f.url) as { id: number } | undefined;
    if (row) {
      out.push({ id: row.id, name: f.name, role: f.role, kind: f.kind, linkedin: f.url, confidence });
    }
  }

  logCheck(companyId, startedAt, 'ok', { found: out.length, failures });
  return out;
}

/** Written on success AND failure — a missing row must mean "never ran". */
function logCheck(
  companyId: number,
  startedAt: string,
  status: 'ok' | 'error',
  stats: Record<string, unknown>,
): void {
  db()
    .prepare(
      `INSERT INTO check_log (agent, company_id, started_at, finished_at, status, stats)
       VALUES ('people', ?, ?, ?, ?, ?)`,
    )
    .run(companyId, startedAt, now(), status, JSON.stringify(stats));
}
