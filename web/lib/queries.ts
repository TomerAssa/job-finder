import { db } from './db';

export interface RoleRow {
  id: number;
  company: string;
  company_id: number;
  title: string;
  seniority: string | null;
  work_model: string | null;
  min_years: number | null;
  skills: string | null;
  location: string | null;
  url: string | null;
  warm: number;
  relevant: string | null;
  applied_status: string | null;
  paths: number;
}

/** Israel PM roles with their tracking + how many outreach paths exist. */
export function listRoles(opts: { onlyRelevant?: boolean; warmOnly?: boolean } = {}): RoleRow[] {
  const where = ['p.is_product = 1', '(r.is_israel IS NULL OR r.is_israel = 1)'];
  if (opts.warmOnly) where.push('EXISTS(SELECT 1 FROM warm_intros w WHERE w.company_id = c.id)');
  if (opts.onlyRelevant) where.push("(t.relevant IS NULL OR t.relevant NOT IN ('no'))");
  return db()
    .prepare(
      `SELECT p.id, c.name AS company, c.id AS company_id, p.title, r.seniority, r.work_model,
              r.min_years, r.must_have_skills AS skills, COALESCE(r.normalized_location, p.location) AS location, p.url,
              CASE WHEN EXISTS(SELECT 1 FROM warm_intros w WHERE w.company_id=c.id) THEN 1 ELSE 0 END AS warm,
              t.relevant, t.applied_status,
              (SELECT COUNT(*) FROM outreach o WHERE o.position_id = p.id) AS paths
       FROM positions p
       JOIN companies c ON c.id = p.company_id
       LEFT JOIN position_requirements r ON r.position_id = p.id
       LEFT JOIN role_tracking t ON t.position_id = p.id
       WHERE ${where.join(' AND ')}
       ORDER BY warm DESC, (t.relevant='yes') DESC, c.name COLLATE NOCASE, p.title`,
    )
    .all() as RoleRow[];
}

export interface PathRow {
  id: number;
  connector: string | null;
  connector_id: number | null;
  contact: string | null;
  contact_id: number | null;
  contact_detail: string | null;
  status: string;
  note: string | null;
}

export function pathsForRole(positionId: number): PathRow[] {
  return db()
    .prepare(
      `SELECT o.id, conn.full_name AS connector, o.connector_entity_id AS connector_id,
              ct.full_name AS contact, o.contact_entity_id AS contact_id, ct.contact_detail, o.status, o.note
       FROM outreach o
       LEFT JOIN entities conn ON conn.id = o.connector_entity_id
       LEFT JOIN entities ct ON ct.id = o.contact_entity_id
       WHERE o.position_id = ?
       ORDER BY o.id`,
    )
    .all(positionId) as PathRow[];
}

/** Per-person outreach to-do: each connector/contact with the roles to raise. */
export function outreachByPerson(): Array<{
  entity_id: number;
  name: string;
  kind: string;
  degree: number | null;
  items: Array<{ outreach_id: number; company: string; title: string; status: string; role_url: string | null; via_contact: string | null }>;
}> {
  const rows = db()
    .prepare(
      `SELECT e.id AS entity_id, e.full_name AS name, e.kind, e.degree,
              o.id AS outreach_id, c.name AS company, COALESCE(p.title,'—') AS title, o.status,
              p.url AS role_url, ct.full_name AS via_contact
       FROM outreach o
       JOIN entities e ON e.id = COALESCE(o.connector_entity_id, o.contact_entity_id)
       LEFT JOIN companies c ON c.id = o.company_id
       LEFT JOIN positions p ON p.id = o.position_id
       LEFT JOIN entities ct ON ct.id = o.contact_entity_id
       ORDER BY e.full_name COLLATE NOCASE, c.name`,
    )
    .all() as any[];
  const map = new Map<number, any>();
  for (const r of rows) {
    if (!map.has(r.entity_id))
      map.set(r.entity_id, { entity_id: r.entity_id, name: r.name, kind: r.kind, degree: r.degree, items: [] });
    map.get(r.entity_id).items.push({
      outreach_id: r.outreach_id, company: r.company, title: r.title, status: r.status,
      role_url: r.role_url, via_contact: r.connector_id ? r.via_contact : null,
    });
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length);
}

/** Connectors ranked by how many distinct companies/roles they can reach. */
export function connectorLeaderboard() {
  return db()
    .prepare(
      `SELECT e.id, e.full_name AS name, e.degree,
              COUNT(DISTINCT o.company_id) AS companies, COUNT(*) AS paths,
              SUM(CASE WHEN o.status IN ('replied','submitted') THEN 1 ELSE 0 END) AS active
       FROM outreach o JOIN entities e ON e.id = o.connector_entity_id
       GROUP BY e.id ORDER BY companies DESC, paths DESC LIMIT 25`,
    )
    .all() as any[];
}

/** Lead companies (Israel PM) with NO outreach path yet — the gaps. */
export function gapCompanies() {
  return db()
    .prepare(
      `SELECT c.id, c.name,
              CASE WHEN EXISTS(SELECT 1 FROM warm_intros w WHERE w.company_id=c.id) THEN 1 ELSE 0 END AS warm,
              COUNT(DISTINCT p.id) AS pm_roles
       FROM companies c
       JOIN positions p ON p.company_id = c.id AND p.is_product = 1
       LEFT JOIN position_requirements r ON r.position_id = p.id
       WHERE (r.is_israel IS NULL OR r.is_israel = 1)
         AND NOT EXISTS(SELECT 1 FROM outreach o WHERE o.company_id = c.id)
       GROUP BY c.id ORDER BY warm DESC, pm_roles DESC, c.name COLLATE NOCASE`,
    )
    .all() as any[];
}

/** Relevant roles with no contact path — the solo queue. */
export function soloRoles(): RoleRow[] {
  return listRoles({ onlyRelevant: true }).filter((r) => r.paths === 0);
}

export interface EntityRow {
  id: number; full_name: string; kind: string; degree: number | null;
  company: string | null; role: string | null; linkedin_url: string | null;
  contact_detail: string | null; talked_status: string | null; conclusions: string | null;
  relevant: string | null; led_by: string | null;
}

export function listEntities(): EntityRow[] {
  return db()
    .prepare(
      `SELECT e.id, e.full_name, e.kind, e.degree,
              COALESCE(c.name, e.external_company) AS company, e.role, e.linkedin_url,
              e.contact_detail, e.talked_status, e.conclusions, e.relevant,
              (SELECT COALESCE(v.full_name, rel.source_label) FROM relationships rel
                 LEFT JOIN entities v ON v.id = rel.to_entity_id
                 WHERE rel.from_entity_id = e.id AND rel.relation='led_me_to' LIMIT 1) AS led_by
       FROM entities e
       LEFT JOIN companies c ON c.id = e.works_company_id
       ORDER BY (e.kind='connector') DESC, e.full_name COLLATE NOCASE`,
    )
    .all() as EntityRow[];
}

export function stats() {
  const one = (sql: string) => (db().prepare(sql).get() as any).n as number;
  return {
    roles: one("SELECT COUNT(*) n FROM positions p LEFT JOIN position_requirements r ON r.position_id=p.id WHERE p.is_product=1 AND (r.is_israel IS NULL OR r.is_israel=1)"),
    entities: one('SELECT COUNT(*) n FROM entities'),
    connectors: one("SELECT COUNT(*) n FROM entities WHERE kind='connector'"),
    paths: one('SELECT COUNT(*) n FROM outreach'),
    gaps: one(`SELECT COUNT(*) n FROM companies c JOIN positions p ON p.company_id=c.id AND p.is_product=1 LEFT JOIN position_requirements r ON r.position_id=p.id WHERE (r.is_israel IS NULL OR r.is_israel=1) AND NOT EXISTS(SELECT 1 FROM outreach o WHERE o.company_id=c.id)`),
  };
}

export function companyOptions() {
  return db().prepare('SELECT id, name FROM companies ORDER BY name COLLATE NOCASE').all() as Array<{ id: number; name: string }>;
}
export function entityOptions() {
  return db().prepare('SELECT id, full_name FROM entities ORDER BY full_name COLLATE NOCASE').all() as Array<{ id: number; full_name: string }>;
}
