/**
 * The people layer, as a repository bound to a database handle.
 *
 * The handle is injected rather than imported so the Next.js app and the CLI can
 * share one implementation. They open the same SQLite file through different
 * modules — the CLI via `db/client.ts` (which also runs migrations), the web app
 * via `web/lib/db.ts` — and identity resolution is far too important to exist
 * twice and drift.
 *
 * Nothing here imports config, dotenv, or the migration runner, so it is safe to
 * bundle into the web app.
 */
import type Database from 'better-sqlite3';
import { recomputeCircles } from './circles.js';
import { normalizeName, normalizeCompany, similarity } from '../util/normalize.js';
import { normalizeLinkedinUrl } from '../util/linkedin.js';
import { normalizePhone } from '../util/phone.js';

const COMPANY_MATCH_THRESHOLD = 0.9;

export type PersonStatus = 'new' | 'to_reach' | 'talked' | 'following_up' | 'done' | 'dead_end';
export type PersonOrigin =
  | 'manual'
  | 'bulk_paste'
  | 'linkedin_import'
  | 'company_scan'
  | 'tracker_import';
export type Channel = 'linkedin' | 'phone' | 'whatsapp' | 'email' | 'in_person' | 'other';

export interface PersonRow {
  id: number;
  full_name: string;
  name_norm: string;
  role: string | null;
  works_company_id: number | null;
  external_company: string | null;
  linkedin_url: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  relevant: string;
  can_give: string;
  summary: string | null;
  notes: string | null;
  circle: number | null;
  origin: string;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface PersonInput {
  full_name: string;
  role?: string | null;
  /** Free-text company name; resolved to works_company_id or kept as a label. */
  company?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: PersonStatus;
  relevant?: string | null;
  can_give?: string[] | null;
  summary?: string | null;
  notes?: string | null;
  origin?: PersonOrigin;
  is_demo?: boolean;
}

export interface IntroductionInput {
  /** Who did the introducing. Null when it came from outside the graph. */
  fromPersonId?: number | null;
  /** Names the outside source (a community, a family member, an event). */
  sourceLabel?: string | null;
  toPersonId?: number | null;
  toCompanyId?: number | null;
  occurredAt?: string | null;
  note?: string | null;
}

export interface IntroductionEdge {
  id: number;
  personId: number | null;
  personName: string | null;
  sourceLabel: string | null;
  companyId: number | null;
  companyName: string | null;
  occurredAt: string | null;
  note: string | null;
}

export interface InteractionInput {
  personId: number;
  occurredAt?: string;
  channel?: Channel;
  whatISaid?: string | null;
  outcome?: string | null;
  nextStep?: string | null;
  nextStepDue?: string | null;
}

export interface InteractionRow {
  id: number;
  person_id: number;
  occurred_at: string;
  channel: string;
  what_i_said: string | null;
  outcome: string | null;
  next_step: string | null;
  next_step_due: string | null;
  created_at: string;
}

/** Columns a scraped or imported write may fill when they are empty. */
const FILLABLE = [
  'role',
  'works_company_id',
  'external_company',
  'linkedin_url',
  'phone',
  'email',
  'summary',
  'notes',
] as const;

const nowIso = (): string => new Date().toISOString();

export function createRepo(handle: Database.Database) {
  // Per-repo, not module-level: two handles must not share a cache.
  let companyCache: Array<{ id: number; name_norm: string }> | null = null;

  const companies = () => {
    if (!companyCache) {
      companyCache = handle.prepare('SELECT id, name_norm FROM companies').all() as Array<{
        id: number;
        name_norm: string;
      }>;
    }
    return companyCache;
  };

  /**
   * Drop the company cache. Anything inserting a company outside `ensureCompany`
   * must call this or later lookups miss rows that exist.
   */
  const invalidateCompanyCache = (): void => {
    companyCache = null;
  };

  /** Resolve a company name to a tracked company (fuzzy), else keep it as a label. */
  const matchCompany = (name: string | null | undefined): { id?: number; external?: string } => {
    if (!name || !name.trim()) return {};
    const norm = normalizeCompany(name);
    if (!norm) return { external: name.trim() };

    let best: { id: number; name_norm: string } | null = null;
    let bestScore = 0;
    for (const c of companies()) {
      const s = norm === c.name_norm ? 1 : similarity(norm, c.name_norm);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best && bestScore >= COMPANY_MATCH_THRESHOLD) return { id: best.id };
    return { external: name.trim() };
  };

  /** Company id for a name, matching an existing row or creating a lightweight one. */
  const ensureCompany = (name: string | null | undefined): number | null => {
    if (!name || !name.trim()) return null;
    const m = matchCompany(name);
    if (m.id) return m.id;

    const norm = normalizeCompany(name) || normalizeName(name);
    if (!norm) return null;

    handle
      .prepare(
        `INSERT INTO companies (name, name_norm, status, created_at)
         VALUES (?, ?, 'tracked', ?) ON CONFLICT(name_norm) DO NOTHING`,
      )
      .run(name.trim(), norm, nowIso());
    invalidateCompanyCache();

    const row = handle.prepare('SELECT id FROM companies WHERE name_norm = ?').get(norm) as
      | { id: number }
      | undefined;
    return row ? row.id : null;
  };

  const getPerson = (id: number): PersonRow | null =>
    (handle.prepare('SELECT * FROM people WHERE id = ?').get(id) as PersonRow) ?? null;

  /**
   * Find an existing person, strongest key first. Returns null when nothing
   * matches confidently — the caller inserts rather than guessing.
   */
  const resolvePerson = (input: {
    full_name?: string | null;
    company?: string | null;
    linkedin_url?: string | null;
    phone?: string | null;
  }): number | null => {
    const linkedin = normalizeLinkedinUrl(input.linkedin_url);
    if (linkedin) {
      const row = handle.prepare('SELECT id FROM people WHERE linkedin_url = ?').get(linkedin) as
        | { id: number }
        | undefined;
      if (row) return row.id;
    }

    const phone = normalizePhone(input.phone);
    if (phone) {
      const row = handle.prepare('SELECT id FROM people WHERE phone = ?').get(phone) as
        | { id: number }
        | undefined;
      if (row) return row.id;
    }

    // A name only counts alongside a company. Without one it is a suggestion for
    // the dedupe UI, not a match.
    const nameNorm = normalizeName(input.full_name);
    if (!nameNorm || !input.company) return null;

    const comp = matchCompany(input.company);
    const row = comp.id
      ? (handle
          .prepare('SELECT id FROM people WHERE name_norm = ? AND works_company_id = ?')
          .get(nameNorm, comp.id) as { id: number } | undefined)
      : (handle
          .prepare(
            `SELECT id FROM people
              WHERE name_norm = ? AND external_company IS NOT NULL AND lower(external_company) = ?`,
          )
          .get(nameNorm, (comp.external ?? '').toLowerCase()) as { id: number } | undefined);

    return row ? row.id : null;
  };

  /**
   * First person with this normalized name, or null.
   *
   * NOT identity resolution — a name is not an identity key, and this returns an
   * arbitrary row when two people share one. It exists for sources that only ever
   * had names (the Hebrew trackers, free-text "who knows them" fields) where the
   * alternative is creating a duplicate on every mention.
   */
  const findPersonByName = (name: string): number | null => {
    const norm = normalizeName(name);
    if (!norm) return null;
    const row = handle
      .prepare('SELECT id FROM people WHERE name_norm = ? ORDER BY id LIMIT 1')
      .get(norm) as { id: number } | undefined;
    return row ? row.id : null;
  };

  /**
   * People sharing a normalized name who were not confidently matched. Feeds the
   * dedupe UI; never merged automatically.
   */
  const similarPeople = (personId: number): PersonRow[] => {
    const person = getPerson(personId);
    if (!person) return [];
    return handle
      .prepare('SELECT * FROM people WHERE name_norm = ? AND id != ?')
      .all(person.name_norm, personId) as PersonRow[];
  };

  /**
   * Insert a person, or fill gaps on the one they already are.
   *
   * `created` lets bulk imports honestly report "N added, M already existed"
   * instead of claiming everything was new.
   */
  const upsertPerson = (input: PersonInput): { id: number; created: boolean } => {
    const existingId = resolvePerson(input);
    const comp = input.company ? matchCompany(input.company) : {};
    const linkedin = normalizeLinkedinUrl(input.linkedin_url);
    const phone = normalizePhone(input.phone);
    const timestamp = nowIso();

    if (existingId != null) {
      const current = getPerson(existingId)!;
      const candidate: Record<string, string | number | null> = {
        role: input.role ?? null,
        works_company_id: comp.id ?? null,
        external_company: comp.external ?? null,
        linkedin_url: linkedin,
        phone,
        email: input.email ?? null,
        summary: input.summary ?? null,
        notes: input.notes ?? null,
      };

      const set: Record<string, string | number | null> = {};
      for (const col of FILLABLE) {
        const val = candidate[col];
        if (val == null || val === '') continue;
        const held = (current as unknown as Record<string, unknown>)[col];
        if (held == null || held === '') set[col] = val;
      }

      const keys = Object.keys(set);
      if (keys.length) {
        handle
          .prepare(
            `UPDATE people SET ${keys.map((k) => `${k}=@${k}`).join(', ')}, updated_at=@updated_at
              WHERE id=@id`,
          )
          .run({ ...set, updated_at: timestamp, id: existingId });
      }
      return { id: existingId, created: false };
    }

    const info = handle
      .prepare(
        `INSERT INTO people
           (full_name, name_norm, role, works_company_id, external_company, linkedin_url, phone, email,
            status, relevant, can_give, summary, notes, origin, is_demo, created_at, updated_at)
         VALUES
           (@full_name, @name_norm, @role, @works_company_id, @external_company, @linkedin_url, @phone,
            @email, @status, @relevant, @can_give, @summary, @notes, @origin, @is_demo,
            @created_at, @updated_at)`,
      )
      .run({
        full_name: input.full_name.trim(),
        name_norm: normalizeName(input.full_name),
        role: input.role ?? null,
        works_company_id: comp.id ?? null,
        external_company: comp.external ?? null,
        linkedin_url: linkedin,
        phone,
        email: input.email ?? null,
        status: input.status ?? 'new',
        relevant: input.relevant ?? 'unknown',
        can_give: JSON.stringify(input.can_give ?? []),
        summary: input.summary ?? null,
        notes: input.notes ?? null,
        origin: input.origin ?? 'manual',
        is_demo: input.is_demo ? 1 : 0,
        created_at: timestamp,
        updated_at: timestamp,
      });

    return { id: Number(info.lastInsertRowid), created: true };
  };

  /** Patch columns the user edited directly. Unlike upsert, this DOES overwrite. */
  const updatePerson = (
    id: number,
    fields: Partial<{
      full_name: string;
      role: string | null;
      company: string | null;
      linkedin_url: string | null;
      phone: string | null;
      email: string | null;
      status: string;
      relevant: string;
      can_give: string[];
      summary: string | null;
      notes: string | null;
    }>,
  ): void => {
    const set: Record<string, string | number | null> = {};

    if (fields.full_name != null) {
      set.full_name = fields.full_name.trim();
      set.name_norm = normalizeName(fields.full_name);
    }
    if (fields.company !== undefined) {
      const comp = matchCompany(fields.company);
      set.works_company_id = comp.id ?? null;
      set.external_company = comp.external ?? null;
    }
    if (fields.linkedin_url !== undefined) set.linkedin_url = normalizeLinkedinUrl(fields.linkedin_url);
    if (fields.phone !== undefined) set.phone = normalizePhone(fields.phone);
    if (fields.role !== undefined) set.role = fields.role;
    if (fields.email !== undefined) set.email = fields.email;
    if (fields.status !== undefined) set.status = fields.status;
    if (fields.relevant !== undefined) set.relevant = fields.relevant;
    if (fields.can_give !== undefined) set.can_give = JSON.stringify(fields.can_give);
    if (fields.summary !== undefined) set.summary = fields.summary;
    if (fields.notes !== undefined) set.notes = fields.notes;

    const keys = Object.keys(set);
    if (!keys.length) return;
    handle
      .prepare(
        `UPDATE people SET ${keys.map((k) => `${k}=@${k}`).join(', ')}, updated_at=@updated_at WHERE id=@id`,
      )
      .run({ ...set, updated_at: nowIso(), id });
  };

  const deletePerson = (id: number): void => {
    handle.prepare('DELETE FROM people WHERE id = ?').run(id);
    recomputeCircles(handle);
  };

  // ─── The introduction graph ────────────────────────────────────────────────

  /**
   * Record that someone led you to a person or a company.
   *
   * Exactly one of `toPersonId` / `toCompanyId` must be set — "Dana introduced me
   * to Yoni" and "Dana got me into Wiz" are the same fact with different targets.
   * Recomputes circles, since a new edge can shorten someone's path to you.
   * Returns null when the edge was already recorded.
   */
  const addIntroduction = (input: IntroductionInput): number | null => {
    const { toPersonId = null, toCompanyId = null } = input;
    if ((toPersonId == null) === (toCompanyId == null)) {
      throw new Error('addIntroduction: set exactly one of toPersonId or toCompanyId');
    }

    const fromPersonId = input.fromPersonId ?? null;
    const sourceLabel = fromPersonId == null ? input.sourceLabel?.trim() || null : null;
    if (fromPersonId != null && toPersonId != null && fromPersonId === toPersonId) {
      throw new Error('addIntroduction: a person cannot introduce you to themselves');
    }

    const info = handle
      .prepare(
        `INSERT OR IGNORE INTO introductions
           (from_person_id, source_label, to_person_id, to_company_id, occurred_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fromPersonId,
        sourceLabel,
        toPersonId,
        toCompanyId,
        input.occurredAt ?? null,
        input.note ?? null,
        nowIso(),
      );

    if (info.changes === 0) return null;
    recomputeCircles(handle);
    return Number(info.lastInsertRowid);
  };

  const removeIntroduction = (id: number): void => {
    handle.prepare('DELETE FROM introductions WHERE id = ?').run(id);
    recomputeCircles(handle);
  };

  /**
   * The two lists a profile shows: who led me to this person, and who or what
   * this person led me to. Outbound includes both people and companies.
   */
  const introductionsFor = (
    personId: number,
  ): { inbound: IntroductionEdge[]; outbound: IntroductionEdge[] } => {
    const inbound = handle
      .prepare(
        `SELECT i.id, i.from_person_id AS personId, p.full_name AS personName, i.source_label AS sourceLabel,
                NULL AS companyId, NULL AS companyName, i.occurred_at AS occurredAt, i.note
           FROM introductions i
           LEFT JOIN people p ON p.id = i.from_person_id
          WHERE i.to_person_id = ?
          ORDER BY i.id`,
      )
      .all(personId) as IntroductionEdge[];

    const outbound = handle
      .prepare(
        `SELECT i.id, i.to_person_id AS personId, p.full_name AS personName, NULL AS sourceLabel,
                i.to_company_id AS companyId, c.name AS companyName, i.occurred_at AS occurredAt, i.note
           FROM introductions i
           LEFT JOIN people p    ON p.id = i.to_person_id
           LEFT JOIN companies c ON c.id = i.to_company_id
          WHERE i.from_person_id = ?
          ORDER BY i.id`,
      )
      .all(personId) as IntroductionEdge[];

    return { inbound, outbound };
  };

  /** Distinct outside sources (communities, family, events) that start a chain. */
  const introductionSources = (): string[] =>
    (
      handle
        .prepare(
          `SELECT DISTINCT source_label FROM introductions
            WHERE source_label IS NOT NULL AND trim(source_label) != ''
            ORDER BY source_label COLLATE NOCASE`,
        )
        .all() as { source_label: string }[]
    ).map((r) => r.source_label);

  // ─── The talk log ──────────────────────────────────────────────────────────

  const logInteraction = (input: InteractionInput): number => {
    const timestamp = nowIso();
    const info = handle
      .prepare(
        `INSERT INTO interactions
           (person_id, occurred_at, channel, what_i_said, outcome, next_step, next_step_due, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.personId,
        input.occurredAt ?? timestamp,
        input.channel ?? 'other',
        input.whatISaid ?? null,
        input.outcome ?? null,
        input.nextStep ?? null,
        input.nextStepDue ?? null,
        timestamp,
      );

    // Talking to someone is the point of the tool, so reflect it — but only when
    // the user has not already moved them somewhere more specific.
    handle
      .prepare(
        `UPDATE people SET status = 'talked', updated_at = ?
          WHERE id = ? AND status IN ('new','to_reach')`,
      )
      .run(timestamp, input.personId);

    return Number(info.lastInsertRowid);
  };

  const interactionsFor = (personId: number): InteractionRow[] =>
    handle
      .prepare('SELECT * FROM interactions WHERE person_id = ? ORDER BY occurred_at DESC, id DESC')
      .all(personId) as InteractionRow[];

  const deleteInteraction = (id: number): void => {
    handle.prepare('DELETE FROM interactions WHERE id = ?').run(id);
  };

  // ─── The LinkedIn candidate pool ───────────────────────────────────────────

  /**
   * Promote a row from the raw LinkedIn CSV into the people list. This is the
   * only way a connection crosses over — the pool holds hundreds of people you
   * will never talk to, so nothing moves without the user choosing it.
   */
  const promoteConnection = (
    connectionId: number,
    origin: PersonOrigin = 'linkedin_import',
  ): number | null => {
    const conn = handle.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as
      | {
          id: number;
          full_name: string;
          company: string | null;
          position: string | null;
          linkedin_url: string | null;
          person_id: number | null;
        }
      | undefined;
    if (!conn) return null;
    if (conn.person_id != null) return conn.person_id;

    const { id } = upsertPerson({
      full_name: conn.full_name,
      company: conn.company,
      role: conn.position,
      linkedin_url: conn.linkedin_url,
      origin,
    });

    handle.prepare('UPDATE connections SET person_id = ? WHERE id = ?').run(id, connectionId);
    return id;
  };

  // ─── Merge ─────────────────────────────────────────────────────────────────

  /**
   * Fold duplicates into one person: repoint every edge, fill the primary's empty
   * columns from the duplicates, then delete them.
   *
   * Both ends are checked first. A list open in the browser goes stale the moment
   * anything is merged, so it is entirely normal for a second merge to name a row
   * that no longer exists — and repointing records onto a deleted person fails
   * deep inside the transaction with a bare "FOREIGN KEY constraint failed",
   * which tells the user nothing.
   */
  const mergePeople = (primaryId: number, duplicateIds: number[]): { merged: number; skipped: number } => {
    if (!getPerson(primaryId)) {
      throw new Error(
        `Cannot merge into person ${primaryId}: they are no longer in your list. ` +
          `They were probably merged or deleted already — reload and try again.`,
      );
    }

    const dups = duplicateIds.filter((id) => id !== primaryId && getPerson(id) != null);
    const skipped = duplicateIds.filter((id) => id !== primaryId).length - dups.length;
    if (!dups.length) return { merged: 0, skipped };

    const tx = handle.transaction(() => {
      for (const dupId of dups) {
        const dup = getPerson(dupId);
        if (!dup) continue;

        // OR IGNORE so an edge colliding with one the primary already has is
        // dropped rather than aborting the merge.
        handle.prepare('UPDATE OR IGNORE introductions SET from_person_id = ? WHERE from_person_id = ?').run(primaryId, dupId);
        handle.prepare('UPDATE OR IGNORE introductions SET to_person_id = ? WHERE to_person_id = ?').run(primaryId, dupId);
        handle.prepare('UPDATE interactions SET person_id = ? WHERE person_id = ?').run(primaryId, dupId);
        handle.prepare('UPDATE connections SET person_id = ? WHERE person_id = ?').run(primaryId, dupId);
        handle.prepare('UPDATE person_candidates SET person_id = ? WHERE person_id = ?').run(primaryId, dupId);
        handle.prepare('UPDATE outreach SET connector_person_id = ? WHERE connector_person_id = ?').run(primaryId, dupId);
        handle.prepare('UPDATE outreach SET contact_person_id = ? WHERE contact_person_id = ?').run(primaryId, dupId);

        const primary = getPerson(primaryId)!;
        const set: Record<string, string | number | null> = {};
        for (const col of FILLABLE) {
          const held = (primary as unknown as Record<string, unknown>)[col];
          const from = (dup as unknown as Record<string, unknown>)[col];
          if ((held == null || held === '') && from != null && from !== '') {
            set[col] = from as string | number;
          }
        }

        // The duplicate goes first: linkedin_url and phone are uniquely indexed,
        // so copying them across while it still holds them would collide.
        handle.prepare('DELETE FROM people WHERE id = ?').run(dupId);

        if (Object.keys(set).length) {
          handle
            .prepare(
              `UPDATE people SET ${Object.keys(set).map((k) => `${k}=@${k}`).join(', ')}, updated_at=@updated_at
                WHERE id=@id`,
            )
            .run({ ...set, updated_at: nowIso(), id: primaryId });
        }
      }

      // A merge can leave an edge pointing at itself.
      handle.prepare('DELETE FROM introductions WHERE from_person_id = to_person_id').run();
    });

    tx();
    recomputeCircles(handle);
    return { merged: dups.length, skipped };
  };

  return {
    handle,
    // companies
    matchCompany,
    ensureCompany,
    invalidateCompanyCache,
    // people
    getPerson,
    resolvePerson,
    findPersonByName,
    similarPeople,
    upsertPerson,
    updatePerson,
    deletePerson,
    // graph
    addIntroduction,
    removeIntroduction,
    introductionsFor,
    introductionSources,
    // log
    logInteraction,
    interactionsFor,
    deleteInteraction,
    // pool
    promoteConnection,
    // merge
    mergePeople,
    recomputeCircles: () => recomputeCircles(handle),
  };
}

export type Repo = ReturnType<typeof createRepo>;
