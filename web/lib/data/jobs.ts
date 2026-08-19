import 'server-only';
import { db } from '../db';

/**
 * Read models for the Jobs & Companies screens.
 *
 * The "warm path" signal is the point of the product, so it is a count of real
 * paths rather than the old company-level boolean: people you know who work
 * there, LinkedIn connections at the company, and recorded introductions into it.
 */

export interface RoleItem {
  id: number;
  companyId: number;
  companyName: string;
  title: string;
  seniority: string;
  location: string;
  url: string;
  status: string;
  note: string;
  minYears: number | null;
  maxYears: number | null;
  /** People + connections + introductions that reach this company. */
  paths: number;
}

const roleStatus = (r: Record<string, any>): string => {
  if (r.tstatus) return r.tstatus;
  if (r.relevant === 'no') return 'rejected';
  if (r.active > 0) return 'via_people';
  if (r.relevant === 'cv_sent') return 'applied';
  return 'relevant';
};

const ROLE_SQL = `
  SELECT p.id, p.company_id, c.name AS company_name, p.title, p.url,
         r.seniority, r.min_years, r.max_years,
         COALESCE(r.normalized_location, p.location) AS loc,
         t.status AS tstatus, t.relevant, t.applied_status AS note,
         (SELECT COUNT(*) FROM outreach o
           WHERE o.position_id = p.id AND o.status IN ('replied','submitted','connected')) AS active,
         (
           (SELECT COUNT(*) FROM people pe WHERE pe.works_company_id = p.company_id)
         + (SELECT COUNT(*) FROM connections k WHERE k.company_norm = c.name_norm)
         + (SELECT COUNT(*) FROM introductions i WHERE i.to_company_id = p.company_id)
         ) AS paths
    FROM positions p
    JOIN companies c ON c.id = p.company_id
    LEFT JOIN position_requirements r ON r.position_id = p.id
    LEFT JOIN role_tracking t ON t.position_id = p.id
`;

const toRole = (r: Record<string, any>): RoleItem => ({
  id: r.id,
  companyId: r.company_id,
  companyName: r.company_name,
  title: r.title,
  seniority: r.seniority ?? 'unknown',
  location: r.loc ?? '',
  url: r.url ?? '',
  status: roleStatus(r),
  note: r.note ?? '',
  minYears: r.min_years ?? null,
  maxYears: r.max_years ?? null,
  paths: r.paths ?? 0,
});

/**
 * Roles worth showing: product roles that are in Israel or unplaced.
 *
 * This filter is still the hardcoded one the pipeline has always used. Phase 5
 * replaces it with the saved search's own parameters.
 */
export function listRoles(): RoleItem[] {
  return (
    db()
      .prepare(
        `${ROLE_SQL} WHERE p.is_product = 1 AND (r.is_israel IS NULL OR r.is_israel = 1)
         ORDER BY paths DESC, c.name COLLATE NOCASE, p.id`,
      )
      .all() as Record<string, any>[]
  ).map(toRole);
}

export function rolesForCompany(companyId: number): RoleItem[] {
  return (
    db().prepare(`${ROLE_SQL} WHERE p.company_id = ? ORDER BY p.id`).all(companyId) as Record<string, any>[]
  ).map(toRole);
}
