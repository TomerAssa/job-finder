/**
 * Move the old CRM into the people graph.
 *
 * Three jobs, in order:
 *   1. `entities` -> `people`, collapsing rows that turn out to be the same human
 *      once linkedin_url and phone are canonicalized.
 *   2. `relationships.led_me_to` -> `introductions`, FLIPPING the direction. The
 *      old table stored `from` = the person who was reached and `to` = whoever
 *      led me to them; the new one reads the natural way round, `from` introduced
 *      me to `to`.
 *   3. Link `connections` rows to the people they became, so the candidate pool
 *      doesn't offer to re-add someone who is already in the list.
 *
 * `entities`, `relationships` and `outreach` are left in place. Readers move over
 * in later phases; dropping them is a separate migration once nothing queries them.
 *
 * Deliberately NOT migrated: `outreach` rows are a plan ("ask X about company Y"),
 * not a recorded fact, and turning them into introductions would invent
 * connections that never happened.
 */
import type Database from 'better-sqlite3';
import { normalizeName, normalizeCompany } from '../../util/normalize.js';
import { normalizeLinkedinUrl } from '../../util/linkedin.js';
import { normalizePhone } from '../../util/phone.js';

interface EntityRow {
  id: number;
  full_name: string;
  name_norm: string;
  kind: string | null;
  works_company_id: number | null;
  external_company: string | null;
  role: string | null;
  linkedin_url: string | null;
  contact_detail: string | null;
  talked_status: string | null;
  conclusions: string | null;
  relevant: string | null;
  status?: string | null;
  can_give?: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
}

const ORIGIN_BY_SOURCE: Record<string, string> = {
  import: 'tracker_import',
  serp: 'company_scan',
  manual: 'manual',
};

const STATUS_MAP: Record<string, string> = {
  'new': 'new',
  'to-reach': 'to_reach',
  'to_reach': 'to_reach',
  'talked': 'talked',
  'following-up': 'following_up',
  'following_up': 'following_up',
  'done': 'done',
  'dead-end': 'dead_end',
  'dead_end': 'dead_end',
};

const RELEVANT = new Set(['yes', 'no', 'maybe', 'unknown']);

function hasColumn(handle: Database.Database, table: string, column: string): boolean {
  const cols = handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function tableExists(handle: Database.Database, table: string): boolean {
  return !!handle
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
}

export function up(handle: Database.Database): void {
  if (!tableExists(handle, 'entities')) return; // fresh database, nothing to move

  // Older databases predate `status` / `can_give` being added to the DDL — the
  // exact failure mode the migration runner exists to prevent from recurring.
  const hasStatus = hasColumn(handle, 'entities', 'status');
  const hasCanGive = hasColumn(handle, 'entities', 'can_give');

  const entities = handle
    .prepare(`SELECT * FROM entities ORDER BY id`)
    .all() as EntityRow[];

  // Both sides of the name+company key have to describe a company the same way,
  // or they never match: entities carry a company id, connections carry a
  // normalized company name. Resolve everything to one canonical token.
  const companyIdByNorm = new Map<string, number>();
  for (const c of handle.prepare('SELECT id, name_norm FROM companies').all() as {
    id: number;
    name_norm: string;
  }[]) {
    companyIdByNorm.set(c.name_norm, c.id);
  }
  const companyKeyOf = (companyId: number | null, companyName: string | null): string => {
    if (companyId != null) return `c${companyId}`;
    const norm = normalizeCompany(companyName);
    if (!norm) return '';
    const id = companyIdByNorm.get(norm);
    return id != null ? `c${id}` : norm;
  };

  const insertPerson = handle.prepare(
    `INSERT INTO people
       (full_name, name_norm, role, works_company_id, external_company, linkedin_url, phone,
        status, relevant, can_give, summary, notes, origin, created_at, updated_at)
     VALUES
       (@full_name, @name_norm, @role, @works_company_id, @external_company, @linkedin_url, @phone,
        @status, @relevant, @can_give, @summary, @notes, @origin, @created_at, @updated_at)`,
  );

  // entity id -> person id, so the edge pass can repoint the graph
  const personIdOf = new Map<number, number>();
  // identity key -> person id, so two entity rows for one human collapse
  const byLinkedin = new Map<string, number>();
  const byPhone = new Map<string, number>();
  const byNameCompany = new Map<string, number>();

  for (const e of entities) {
    const linkedin =
      normalizeLinkedinUrl(e.linkedin_url) ?? normalizeLinkedinUrl(e.contact_detail);
    // contact_detail held either a phone or a profile URL depending on the importer
    const phone = normalizePhone(e.contact_detail);
    const nameNorm = e.name_norm || normalizeName(e.full_name);
    const companyKey = companyKeyOf(e.works_company_id, e.external_company);
    const nameCompanyKey = `${nameNorm}|${companyKey}`;

    const existing =
      (linkedin ? byLinkedin.get(linkedin) : undefined) ??
      (phone ? byPhone.get(phone) : undefined) ??
      // name alone is not an identity key — two people share a name. Only treat a
      // name match as the same person when the company agrees too.
      (nameNorm && companyKey ? byNameCompany.get(nameCompanyKey) : undefined);

    if (existing != null) {
      fillPerson(handle, existing, {
        role: e.role,
        works_company_id: e.works_company_id,
        external_company: e.external_company,
        linkedin_url: linkedin,
        phone,
        summary: e.conclusions,
        notes: e.notes,
      });
      personIdOf.set(e.id, existing);
      if (linkedin && !byLinkedin.has(linkedin)) byLinkedin.set(linkedin, existing);
      if (phone && !byPhone.has(phone)) byPhone.set(phone, existing);
      continue;
    }

    const rawStatus = hasStatus ? (e.status ?? '') : '';
    const rawRelevant = (e.relevant ?? '').toLowerCase().trim();

    const info = insertPerson.run({
      full_name: e.full_name.trim(),
      name_norm: nameNorm,
      role: e.role || null,
      works_company_id: e.works_company_id,
      external_company: e.external_company || null,
      linkedin_url: linkedin,
      phone,
      status: STATUS_MAP[(rawStatus || '').toLowerCase().trim()] ?? 'new',
      relevant: RELEVANT.has(rawRelevant) ? rawRelevant : 'unknown',
      can_give: hasCanGive ? (e.can_give ?? '[]') : '[]',
      summary: e.conclusions || null,
      notes: e.notes || null,
      origin: ORIGIN_BY_SOURCE[e.source ?? 'manual'] ?? 'manual',
      created_at: e.created_at,
      updated_at: e.created_at,
    });

    const pid = Number(info.lastInsertRowid);
    personIdOf.set(e.id, pid);
    if (linkedin) byLinkedin.set(linkedin, pid);
    if (phone) byPhone.set(phone, pid);
    if (nameNorm && companyKey) byNameCompany.set(nameCompanyKey, pid);

    // "דיברנו" was a free-text record of having spoken. It is history, so it
    // belongs in the log rather than on the person.
    if (e.talked_status && e.talked_status.trim()) {
      handle
        .prepare(
          `INSERT INTO interactions (person_id, occurred_at, channel, outcome, created_at)
           VALUES (?, ?, 'other', ?, ?)`,
        )
        .run(pid, e.created_at, e.talked_status.trim(), e.created_at);
    }
  }

  // ── 2. Edges, flipped ──────────────────────────────────────────────────────
  if (tableExists(handle, 'relationships')) {
    const edges = handle
      .prepare(
        `SELECT from_entity_id, to_entity_id, source_label, note, created_at
           FROM relationships WHERE relation = 'led_me_to'`,
      )
      .all() as {
      from_entity_id: number;
      to_entity_id: number | null;
      source_label: string | null;
      note: string | null;
      created_at: string;
    }[];

    // OR IGNORE leans on idx_intro_dedupe to collapse the duplicates the old
    // NULL-permissive UNIQUE constraint allowed through.
    const insertIntro = handle.prepare(
      `INSERT OR IGNORE INTO introductions
         (from_person_id, source_label, to_person_id, to_company_id, note, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    );

    for (const r of edges) {
      const reached = personIdOf.get(r.from_entity_id); // old `from` = person reached
      if (reached == null) continue;
      const introducer = r.to_entity_id != null ? personIdOf.get(r.to_entity_id) ?? null : null;
      const label = introducer == null ? (r.source_label?.trim() || null) : null;
      if (introducer == null && !label) continue; // no information to record
      if (introducer === reached) continue; // self-loop
      insertIntro.run(introducer, label, reached, r.note, r.created_at);
    }
  }

  // ── 2b. Repoint outreach at people ─────────────────────────────────────────
  // The entity-shaped columns stay put (see 001); these are the ones that will
  // be read from here on.
  if (tableExists(handle, 'outreach')) {
    const rows = handle
      .prepare(`SELECT id, connector_entity_id, contact_entity_id FROM outreach`)
      .all() as { id: number; connector_entity_id: number | null; contact_entity_id: number | null }[];
    const repoint = handle.prepare(
      `UPDATE outreach SET connector_person_id = ?, contact_person_id = ? WHERE id = ?`,
    );
    for (const o of rows) {
      const connector = o.connector_entity_id != null ? personIdOf.get(o.connector_entity_id) ?? null : null;
      const contact = o.contact_entity_id != null ? personIdOf.get(o.contact_entity_id) ?? null : null;
      if (connector == null && contact == null) continue;
      repoint.run(connector, contact, o.id);
    }
  }

  // ── 3. Link the LinkedIn pool to the people it produced ────────────────────
  if (tableExists(handle, 'connections')) {
    const conns = handle
      .prepare(`SELECT id, full_name, company, company_norm, linkedin_url FROM connections`)
      .all() as {
      id: number;
      full_name: string;
      company: string | null;
      company_norm: string | null;
      linkedin_url: string | null;
    }[];

    const link = handle.prepare(`UPDATE connections SET person_id = ? WHERE id = ?`);
    for (const c of conns) {
      const linkedin = normalizeLinkedinUrl(c.linkedin_url);
      let pid = linkedin ? byLinkedin.get(linkedin) : undefined;
      if (pid == null) {
        const companyId = c.company_norm ? companyIdByNorm.get(c.company_norm) ?? null : null;
        const key = `${normalizeName(c.full_name)}|${companyKeyOf(companyId, c.company)}`;
        pid = byNameCompany.get(key);
      }
      if (pid != null) link.run(pid, c.id);
    }
  }
}

/** Fill only the columns that are still empty; never overwrite what is there. */
function fillPerson(
  handle: Database.Database,
  personId: number,
  values: Record<string, string | number | null | undefined>,
): void {
  const current = handle.prepare(`SELECT * FROM people WHERE id = ?`).get(personId) as
    | Record<string, unknown>
    | undefined;
  if (!current) return;

  const set: Record<string, string | number | null> = {};
  for (const [col, val] of Object.entries(values)) {
    if (val == null || val === '') continue;
    const existing = current[col];
    if (existing == null || existing === '') set[col] = val;
  }

  const keys = Object.keys(set);
  if (!keys.length) return;
  handle
    .prepare(`UPDATE people SET ${keys.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@id`)
    .run({ ...set, id: personId });
}
