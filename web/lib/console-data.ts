import { db } from './db';

export interface Source { id: string; name: string }
export interface Company { id: string; name: string; sector: string; stage: string; employees: string; funding: string; careers: string }
export interface Role { id: string; ci: string; title: string; sen: string; loc: string; warm: number; status: string; url: string; note: string }
export interface Person {
  id: string; name: string; role: string; ci: string; linkedin: string; phone: string;
  circle: number; ctype: 'connector' | 'found' | 'pm' | 'hr';
  status: string; give: string[]; ledBy: string | null; viaId: string | null;
  ask: { who: string; why: string }[]; notes: string;
  outreach: string | null; via: string | null; // contact-level status + who connects me
}
export interface ConsoleData { sources: Source[]; companies: Company[]; roles: Role[]; people: Person[] }

const meta = (json: string | null, key: string): string => {
  try { return (JSON.parse(json ?? '{}') as any)[key] ?? ''; } catch { return ''; }
};
const isPhone = (s: string | null) => !!s && /[+()\d][\d\s()+-]{6,}/.test(s) && !/linkedin|http/i.test(s);

/** Build the prototype's four arrays from the live DB. */
export function buildConsoleData(): ConsoleData {
  const handle = db();

  // ── sources: distinct communities/labels that led me to connectors ──
  const srcLabels = (handle
    .prepare(`SELECT DISTINCT source_label FROM relationships WHERE relation='led_me_to' AND source_label IS NOT NULL AND trim(source_label)!=''`)
    .all() as any[]).map((r) => r.source_label as string);
  const sources: Source[] = srcLabels.map((name, i) => ({ id: `s${i + 1}`, name }));
  const srcId = new Map(sources.map((s) => [s.name, s.id]));

  // ── companies (only those that appear in roles/entities/outreach) ──
  const companyRows = handle
    .prepare(
      `SELECT c.id, c.name, c.metadata, c.careers_url FROM companies c
       WHERE EXISTS(SELECT 1 FROM positions p WHERE p.company_id=c.id AND p.is_product=1)
          OR EXISTS(SELECT 1 FROM entities e WHERE e.works_company_id=c.id)
          OR EXISTS(SELECT 1 FROM outreach o WHERE o.company_id=c.id)
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all() as any[];
  const companies: Company[] = companyRows.map((c) => ({
    id: `c${c.id}`, name: c.name,
    sector: meta(c.metadata, 'Primary Sector') || meta(c.metadata, 'Description'),
    stage: meta(c.metadata, 'Funding Stage'), employees: meta(c.metadata, 'Employees'),
    funding: meta(c.metadata, 'Total Funding') || '—', careers: c.careers_url ?? '',
  }));

  // ── roles: Israel PM roles ──
  const roleRows = handle
    .prepare(
      `SELECT p.id, p.company_id, p.title, p.url, r.seniority, COALESCE(r.normalized_location,p.location) AS loc,
              CASE WHEN EXISTS(SELECT 1 FROM warm_intros w WHERE w.company_id=p.company_id) THEN 1 ELSE 0 END AS warm,
              t.status AS tstatus, t.relevant, t.applied_status AS note,
              (SELECT COUNT(*) FROM outreach o WHERE o.position_id=p.id) AS paths,
              (SELECT COUNT(*) FROM outreach o WHERE o.position_id=p.id AND o.status IN ('replied','submitted','connected')) AS active
       FROM positions p
       LEFT JOIN position_requirements r ON r.position_id=p.id
       LEFT JOIN role_tracking t ON t.position_id=p.id
       WHERE p.is_product=1 AND (r.is_israel IS NULL OR r.is_israel=1)
       ORDER BY warm DESC, p.id`,
    )
    .all() as any[];
  const roleStatus = (r: any): string => {
    if (r.tstatus) return r.tstatus;
    if (r.relevant === 'no') return 'rejected';
    if (r.active > 0) return 'via_people';
    if (r.relevant === 'cv_sent') return 'applied';
    return 'relevant'; // relevant but not applied yet
  };
  const roles: Role[] = roleRows.map((r) => ({
    id: `r${r.id}`, ci: `c${r.company_id}`, title: r.title, sen: r.seniority ?? 'unknown',
    loc: r.loc ?? '', warm: r.warm, status: roleStatus(r), url: r.url ?? '', note: r.note ?? '',
  }));

  // ── people: entities ──
  const entRows = handle
    .prepare(
      `SELECT e.*, COALESCE(c.name,'') AS company_name,
              (SELECT to_entity_id FROM relationships rel WHERE rel.from_entity_id=e.id AND rel.relation='led_me_to' AND rel.to_entity_id IS NOT NULL LIMIT 1) AS via_id,
              (SELECT source_label FROM relationships rel WHERE rel.from_entity_id=e.id AND rel.relation='led_me_to' AND rel.source_label IS NOT NULL LIMIT 1) AS led_src
       FROM entities e LEFT JOIN companies c ON c.id=e.works_company_id`,
    )
    .all() as any[];
  const ctypeOf = (kind: string, degree: number | null): Person['ctype'] => {
    if (kind === 'connector' || (kind === 'connection' && (degree ?? 1) <= 1)) return 'connector';
    if (kind === 'pm') return 'pm';
    if (kind === 'hr') return 'hr';
    return 'found';
  };
  // asks: for a connector, the companies/roles they can intro (from outreach)
  const askRows = handle
    .prepare(
      `SELECT o.connector_entity_id AS eid, c.name AS company, COALESCE(p.title,'intro') AS title
       FROM outreach o LEFT JOIN companies c ON c.id=o.company_id LEFT JOIN positions p ON p.id=o.position_id
       WHERE o.connector_entity_id IS NOT NULL`,
    )
    .all() as any[];
  const askMap = new Map<number, { who: string; why: string }[]>();
  for (const a of askRows) {
    if (!askMap.has(a.eid)) askMap.set(a.eid, []);
    const arr = askMap.get(a.eid)!;
    if (a.company && !arr.some((x) => x.who === a.company)) arr.push({ who: a.company, why: a.title });
  }
  // contact-level outreach status + connector (latest per contact)
  const outMap = new Map<number, { status: string; via: string | null }>();
  for (const o of handle.prepare(
    `SELECT o.contact_entity_id AS eid, o.status, conn.full_name AS connector FROM outreach o
     LEFT JOIN entities conn ON conn.id=o.connector_entity_id WHERE o.contact_entity_id IS NOT NULL ORDER BY o.id`,
  ).all() as any[]) {
    outMap.set(o.eid, { status: o.status, via: o.connector });
  }
  const people: Person[] = entRows.map((e) => ({
    id: `p${e.id}`, name: e.full_name, role: e.role ?? '',
    ci: e.works_company_id ? `c${e.works_company_id}` : 'c_none',
    linkedin: e.linkedin_url ?? '', phone: isPhone(e.contact_detail) ? e.contact_detail : '',
    circle: e.degree ?? (ctypeOf(e.kind, e.degree) === 'connector' ? 1 : 2),
    ctype: ctypeOf(e.kind, e.degree),
    status: e.status ?? 'new', give: (() => { try { return JSON.parse(e.can_give ?? '[]'); } catch { return []; } })(),
    ledBy: e.led_src ? srcId.get(e.led_src) ?? null : null,
    viaId: e.via_id ? `p${e.via_id}` : null,
    ask: askMap.get(e.id) ?? [], notes: e.conclusions ?? e.notes ?? '',
    outreach: outMap.get(e.id)?.status ?? null, via: outMap.get(e.id)?.via ?? null,
  }));

  return { sources, companies, roles, people };
}
