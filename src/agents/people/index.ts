import { serpSearch, type SerpResult } from '../../brightdata/serp.js';
import { db, now } from '../../db/client.js';
import { normalizeCompany } from '../../util/normalize.js';
import { normalizeLinkedinUrl } from '../../util/linkedin.js';
import { buildQuery, customPreset, presetsFor, type RolePreset } from './roles.js';
import { verifyCompanyLinkedin, type VerificationResult } from './verifyCompany.js';

export interface Candidate {
  id: number;
  name: string;
  role: string;
  preset: string;
  linkedin: string;
  confidence: number;
}

export interface ScanOptions {
  /** Preset keys from `roles.ts`. Defaults to product + HR. */
  roleKeys?: string[];
  /** Extra job titles to search for verbatim. */
  customTitles?: string[];
  /** Region hint, e.g. "israel OR \"tel aviv\"". Optional by design. */
  location?: string | null;
  /**
   * Skip the company-identity check. Cheaper by one or two requests, at the cost
   * of not being able to tell a same-named company apart from the right one.
   */
  skipVerification?: boolean;
}

export interface ScanResult {
  candidates: Candidate[];
  verification: VerificationResult | null;
  /** Queries that failed, when at least one other succeeded. */
  partialFailures: string[];
}

interface Found {
  name: string;
  role: string;
  url: string;
  preset: string;
}

/**
 * Turn search results into candidate people.
 *
 * Every filter here exists because SERP results for a company name are noisy:
 * the company's own word must appear somewhere in the result, and a "name"
 * longer than a short phrase is a headline, not a person.
 */
export function parseProfiles(results: SerpResult[], company: string, preset: string): Found[] {
  const cnorm = normalizeCompany(company);
  const firstWord = cnorm.split(' ')[0];
  const out: Found[] = [];

  for (const r of results) {
    const url = normalizeLinkedinUrl(r.url);
    if (!url) continue;

    const parts = r.title.split(/[-|–—]/).map((s) => s.trim()).filter(Boolean);
    const name = parts[0];
    if (!name || name.length > 60) continue;

    const hay = `${r.title} ${r.description ?? ''}`;
    if (firstWord && !normalizeCompany(hay).includes(firstWord)) continue;

    out.push({ name, role: parts[1] ?? '', url, preset });
  }
  return out;
}

/**
 * Find people at a company worth talking to.
 *
 * Results are candidates, not contacts: they are search-result guesses, so they
 * land in `person_candidates` for review and only become people when kept.
 *
 * Throws when every query fails, rather than returning an empty array. The
 * previous version swallowed all errors, which is why it appeared to find
 * nothing for months instead of reporting that it was broken.
 */
export async function findPeople(companyId: number, opts: ScanOptions = {}): Promise<ScanResult> {
  const handle = db();
  const startedAt = now();

  const company = (
    handle.prepare('SELECT name FROM companies WHERE id = ?').get(companyId) as { name: string } | undefined
  )?.name;
  if (!company) throw new Error(`No company with id ${companyId}`);

  // Establish who the company is before trusting anything found in its name.
  let verification: VerificationResult | null = null;
  if (!opts.skipVerification) {
    try {
      verification = await verifyCompanyLinkedin(companyId);
    } catch (err) {
      verification = {
        verified: false,
        linkedinUrl: null,
        reason: `Identity check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const presets: RolePreset[] = [...presetsFor(opts.roleKeys)];
  const custom = customPreset(opts.customTitles ?? []);
  if (custom) presets.push(custom);
  if (!presets.length) throw new Error('No roles selected to search for');

  const found: Found[] = [];
  const seen = new Set<string>();
  const failures: string[] = [];

  for (const preset of presets) {
    const query = buildQuery(company, preset, opts.location);
    try {
      const results = await serpSearch(query, 10);
      for (const f of parseProfiles(results, company, preset.key)) {
        if (seen.has(f.url)) continue;
        seen.add(f.url);
        found.push(f);
      }
    } catch (err) {
      failures.push(`${preset.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length === presets.length) {
    logCheck(companyId, startedAt, 'error', { failures, verified: verification?.verified ?? null });
    throw new Error(`People search failed for ${company}: ${failures.join('; ')}`);
  }

  // A verified company means the search terms were anchored to the right
  // organisation. Unverified hits are still worth showing, but not worth
  // pretending to be confident about.
  const confidence = verification?.verified ? 0.8 : 0.4;

  const insert = handle.prepare(
    `INSERT INTO person_candidates
       (company_id, full_name, role, linkedin_url, source, confidence, raw, found_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );
  const lookup = handle.prepare(
    `SELECT id, decision FROM person_candidates
      WHERE COALESCE(company_id, 0) = ? AND COALESCE(linkedin_url, full_name) = ?`,
  );

  const candidates: Candidate[] = [];
  for (const f of found) {
    insert.run(
      companyId, f.name, f.role || null, f.url,
      verification?.verified ? 'linkedin_verified' : 'serp',
      confidence, JSON.stringify(f), now(),
    );
    const row = lookup.get(companyId, f.url) as { id: number; decision: string } | undefined;
    // Skip anything already reviewed — re-offering a rejected guess is noise.
    if (!row || row.decision !== 'pending') continue;
    candidates.push({ id: row.id, name: f.name, role: f.role, preset: f.preset, linkedin: f.url, confidence });
  }

  logCheck(companyId, startedAt, 'ok', {
    found: candidates.length,
    verified: verification?.verified ?? null,
    presets: presets.map((p) => p.key),
    failures,
  });

  return { candidates, verification, partialFailures: failures };
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
