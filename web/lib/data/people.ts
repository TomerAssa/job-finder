import 'server-only';
import { db } from '../db';

/**
 * Read models for the People screens.
 *
 * Ids are plain numbers. The old console prefixed everything (`p3`, `c1`, `r7`)
 * to match the design prototype's seed data and then stripped the prefixes back
 * off in every mutation; real routes make that pointless.
 */

export interface PersonListItem {
  id: number;
  name: string;
  role: string;
  companyId: number | null;
  companyName: string;
  linkedin: string;
  phone: string;
  circle: number | null;
  status: string;
  relevant: string;
  give: string[];
  summary: string;
  notes: string;
  /** Who led me to them — a person's name, or an outside source label. */
  introducedBy: string | null;
  /** How many people and companies they have led me to. */
  ledMeToCount: number;
  lastInteractionAt: string | null;
  interactionCount: number;
  isDemo: boolean;
}

const parseGive = (raw: string | null): string[] => {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const LIST_SQL = `
  SELECT p.id, p.full_name, p.role, p.works_company_id, p.external_company,
         p.linkedin_url, p.phone, p.circle, p.status, p.relevant, p.can_give,
         p.summary, p.notes, p.is_demo,
         COALESCE(c.name, p.external_company, '') AS company_name,
         (SELECT COALESCE(pf.full_name, i.source_label)
            FROM introductions i LEFT JOIN people pf ON pf.id = i.from_person_id
           WHERE i.to_person_id = p.id ORDER BY i.id LIMIT 1) AS introduced_by,
         (SELECT COUNT(*) FROM introductions i WHERE i.from_person_id = p.id) AS led_me_to_count,
         (SELECT MAX(occurred_at) FROM interactions x WHERE x.person_id = p.id) AS last_interaction_at,
         (SELECT COUNT(*) FROM interactions x WHERE x.person_id = p.id) AS interaction_count
    FROM people p
    LEFT JOIN companies c ON c.id = p.works_company_id
`;

const toItem = (r: Record<string, any>): PersonListItem => ({
  id: r.id,
  name: r.full_name,
  role: r.role ?? '',
  companyId: r.works_company_id ?? null,
  companyName: r.company_name ?? '',
  linkedin: r.linkedin_url ?? '',
  phone: r.phone ?? '',
  circle: r.circle ?? null,
  status: r.status,
  relevant: r.relevant,
  give: parseGive(r.can_give),
  summary: r.summary ?? '',
  notes: r.notes ?? '',
  introducedBy: r.introduced_by ?? null,
  ledMeToCount: r.led_me_to_count ?? 0,
  lastInteractionAt: r.last_interaction_at ?? null,
  interactionCount: r.interaction_count ?? 0,
  isDemo: !!r.is_demo,
});

export function listPeople(): PersonListItem[] {
  return (db().prepare(`${LIST_SQL} ORDER BY p.circle, p.full_name COLLATE NOCASE`).all() as Record<string, any>[]).map(toItem);
}

export function getPersonListItem(id: number): PersonListItem | null {
  const row = db().prepare(`${LIST_SQL} WHERE p.id = ?`).get(id) as Record<string, any> | undefined;
  return row ? toItem(row) : null;
}

/** Names of people who can plausibly make an introduction, for datalists. */
export function connectorNames(): string[] {
  return (
    db()
      .prepare(
        `SELECT DISTINCT p.full_name FROM people p
           WHERE EXISTS (SELECT 1 FROM introductions i WHERE i.from_person_id = p.id)
              OR p.circle = 1
           ORDER BY p.full_name COLLATE NOCASE`,
      )
      .all() as { full_name: string }[]
  ).map((r) => r.full_name);
}

export function allPersonNames(): string[] {
  return (
    db().prepare('SELECT full_name FROM people ORDER BY full_name COLLATE NOCASE').all() as {
      full_name: string;
    }[]
  ).map((r) => r.full_name);
}

export interface CompanyOption {
  id: number;
  name: string;
}

export function companyOptions(): CompanyOption[] {
  return db()
    .prepare(
      `SELECT id, name FROM companies
        WHERE EXISTS(SELECT 1 FROM positions x WHERE x.company_id = companies.id)
           OR EXISTS(SELECT 1 FROM people   x WHERE x.works_company_id = companies.id)
        ORDER BY name COLLATE NOCASE`,
    )
    .all() as CompanyOption[];
}

// ─── The LinkedIn candidate pool ────────────────────────────────────────────

export interface PoolItem {
  id: number;
  name: string;
  company: string;
  position: string;
  linkedin: string;
  companyId: number | null;
  openPositions: number;
  /** An existing person with the same name — a suggestion to confirm, not a match. */
  possibleDuplicate: string | null;
}

/**
 * The raw LinkedIn CSV, minus anyone already promoted.
 *
 * `openPositions` is the reason the pool is worth keeping: it surfaces the
 * connections who work somewhere that is currently hiring.
 */
export function listPool(opts: { hiringOnly?: boolean; query?: string; limit?: number } = {}): PoolItem[] {
  const rows = db()
    .prepare(
      `SELECT k.id, k.full_name, k.company, k.position, k.linkedin_url,
              c.id AS company_id,
              (SELECT COUNT(*) FROM positions p WHERE p.company_id = c.id) AS open_positions,
              (SELECT pe.full_name FROM people pe WHERE pe.name_norm = lower(trim(k.full_name)) LIMIT 1) AS possible_duplicate
         FROM connections k
         LEFT JOIN companies c ON c.name_norm = k.company_norm
        WHERE k.person_id IS NULL
        ORDER BY open_positions DESC, k.full_name COLLATE NOCASE`,
    )
    .all() as Record<string, any>[];

  const q = opts.query?.trim().toLowerCase();
  let out = rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    company: r.company ?? '',
    position: r.position ?? '',
    linkedin: r.linkedin_url ?? '',
    companyId: r.company_id ?? null,
    openPositions: r.open_positions ?? 0,
    possibleDuplicate: r.possible_duplicate ?? null,
  }));

  if (opts.hiringOnly) out = out.filter((r) => r.openPositions > 0);
  if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q));
  return out.slice(0, opts.limit ?? 500);
}

export function poolStats(): { total: number; hiring: number; promoted: number } {
  const handle = db();
  const total = (handle.prepare('SELECT COUNT(*) c FROM connections WHERE person_id IS NULL').get() as { c: number }).c;
  const promoted = (handle.prepare('SELECT COUNT(*) c FROM connections WHERE person_id IS NOT NULL').get() as { c: number }).c;
  const hiring = (
    handle
      .prepare(
        `SELECT COUNT(*) c FROM connections k
           JOIN companies c2 ON c2.name_norm = k.company_norm
          WHERE k.person_id IS NULL
            AND EXISTS(SELECT 1 FROM positions p WHERE p.company_id = c2.id)`,
      )
      .get() as { c: number }
  ).c;
  return { total, hiring, promoted };
}
