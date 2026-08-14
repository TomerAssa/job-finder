import 'server-only';
import { db } from '../db';
import { rolesForCompany, type RoleItem } from './jobs';
import { getPersonListItem, type PersonListItem } from './people';

export interface CompanyDetail {
  id: number;
  name: string;
  sector: string;
  stage: string;
  employees: string;
  funding: string;
  careersUrl: string;
  websiteUrl: string;
  linkedinUrl: string;
  linkedinVerified: boolean;
  isDemo: boolean;
}

export interface CandidateItem {
  id: number;
  name: string;
  role: string;
  linkedin: string;
  source: string;
  confidence: number;
  decision: string;
  foundAt: string;
}

export interface CompanyConnection {
  id: number;
  name: string;
  position: string;
  linkedin: string;
}

const meta = (json: string | null, key: string): string => {
  try {
    return (JSON.parse(json ?? '{}') as Record<string, string>)[key] ?? '';
  } catch {
    return '';
  }
};

export function getCompany(id: number): CompanyDetail | null {
  const c = db().prepare('SELECT * FROM companies WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    // `sector` is a real column now; fall back to the metadata blob for rows
    // ingested before the column existed.
    sector: c.sector || meta(c.metadata, 'Primary Sector') || '',
    stage: meta(c.metadata, 'Funding Stage'),
    employees: meta(c.metadata, 'Employees'),
    funding: meta(c.metadata, 'Total Funding'),
    careersUrl: c.careers_url ?? '',
    websiteUrl: c.website_url ?? '',
    linkedinUrl: c.linkedin_url ?? '',
    linkedinVerified: !!c.linkedin_verified,
    isDemo: !!c.is_demo,
  };
}

/** People in your list who work at this company. */
export function peopleAtCompany(companyId: number): PersonListItem[] {
  const ids = db()
    .prepare('SELECT id FROM people WHERE works_company_id = ? ORDER BY circle, full_name COLLATE NOCASE')
    .all(companyId) as { id: number }[];
  return ids.map((r) => getPersonListItem(r.id)).filter((p): p is PersonListItem => p !== null);
}

/** Unreviewed scraper hits. These are guesses, and are shown as such. */
export function candidatesForCompany(companyId: number, decision = 'pending'): CandidateItem[] {
  return (
    db()
      .prepare(
        `SELECT id, full_name, role, linkedin_url, source, confidence, decision, found_at
           FROM person_candidates WHERE company_id = ? AND decision = ?
          ORDER BY confidence DESC, id`,
      )
      .all(companyId, decision) as Record<string, any>[]
  ).map((r) => ({
    id: r.id,
    name: r.full_name,
    role: r.role ?? '',
    linkedin: r.linkedin_url ?? '',
    source: r.source,
    confidence: r.confidence,
    decision: r.decision,
    foundAt: r.found_at,
  }));
}

/** LinkedIn connections at this company who are not yet in the people list. */
export function connectionsAtCompany(companyId: number): CompanyConnection[] {
  return (
    db()
      .prepare(
        `SELECT k.id, k.full_name, k.position, k.linkedin_url
           FROM connections k
           JOIN companies c ON c.name_norm = k.company_norm
          WHERE c.id = ? AND k.person_id IS NULL
          ORDER BY k.full_name COLLATE NOCASE`,
      )
      .all(companyId) as Record<string, any>[]
  ).map((r) => ({
    id: r.id,
    name: r.full_name,
    position: r.position ?? '',
    linkedin: r.linkedin_url ?? '',
  }));
}

/** Introductions recorded into this company ("X got me into Wiz"). */
export function introductionsIntoCompany(companyId: number): Array<{ id: number; from: string; note: string }> {
  return (
    db()
      .prepare(
        `SELECT i.id, COALESCE(p.full_name, i.source_label, '—') AS from_name, COALESCE(i.note,'') AS note
           FROM introductions i LEFT JOIN people p ON p.id = i.from_person_id
          WHERE i.to_company_id = ? ORDER BY i.id`,
      )
      .all(companyId) as Record<string, any>[]
  ).map((r) => ({ id: r.id, from: r.from_name, note: r.note }));
}

export function navCounts(): { people: number; jobs: number; companies: number } {
  const handle = db();
  const one = (sql: string) => (handle.prepare(sql).get() as { c: number }).c;
  return {
    people: one('SELECT COUNT(*) c FROM people'),
    jobs: one(`SELECT COUNT(*) c FROM positions p
                 LEFT JOIN position_requirements r ON r.position_id = p.id
                WHERE p.is_product = 1 AND (r.is_israel IS NULL OR r.is_israel = 1)`),
    companies: one('SELECT COUNT(*) c FROM companies'),
  };
}
