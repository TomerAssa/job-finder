'use server';
/**
 * Mutations.
 *
 * Server actions cover simple, fast, reliable writes (a status, a note, an edge).
 * Anything that scrapes, spends credits, or can fail in a way the user needs to
 * see gets a real API route instead — see `app/api/`.
 *
 * All identity resolution goes through the shared repository, so the web app and
 * the CLI cannot disagree about who is who.
 */
import { revalidatePath } from 'next/cache';
import { db } from './db';
import { repo } from './repo';

const touch = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p);
};

// ─── People ─────────────────────────────────────────────────────────────────

export async function setPersonStatus(personId: number, status: string) {
  repo().updatePerson(personId, { status });
  touch('/people', `/people/${personId}`);
}

export async function setPersonSummary(personId: number, summary: string) {
  repo().updatePerson(personId, { summary });
  touch('/people', `/people/${personId}`);
}

export async function setPersonNotes(personId: number, notes: string) {
  repo().updatePerson(personId, { notes });
  touch('/people', `/people/${personId}`);
}

export async function setPersonCanGive(personId: number, canGive: string[]) {
  repo().updatePerson(personId, { can_give: canGive });
  touch('/people', `/people/${personId}`);
}

export async function updatePersonFields(
  personId: number,
  fields: {
    full_name?: string;
    role?: string | null;
    company?: string | null;
    linkedin_url?: string | null;
    phone?: string | null;
    email?: string | null;
    status?: string;
    relevant?: string;
  },
) {
  repo().updatePerson(personId, fields);
  touch('/people', `/people/${personId}`, '/manage');
}

export async function deletePerson(personId: number) {
  repo().deletePerson(personId);
  touch('/people', '/manage');
}

export async function mergePeople(
  primaryId: number,
  duplicateIds: number[],
): Promise<{ ok: true; merged: number; skipped: number } | { ok: false; error: string }> {
  try {
    const result = repo().mergePeople(primaryId, duplicateIds);
    touch('/people', '/manage', `/people/${primaryId}`);
    return { ok: true, ...result };
  } catch (err) {
    // Returned rather than thrown: a failed merge has to be readable in the
    // dialog the user is looking at, not only in the server log.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Add one person by hand, optionally recording who led you to them.
 * `introducerName` is free text: an existing person is reused, anything else is
 * treated as an outside source (a community, a family member, an event).
 */
export async function addPerson(input: {
  full_name: string;
  role?: string;
  company?: string;
  linkedin_url?: string;
  phone?: string;
  introducerName?: string;
  introducerIsSource?: boolean;
}): Promise<{ id: number; created: boolean }> {
  const r = repo();
  const result = r.upsertPerson({
    full_name: input.full_name,
    role: input.role || null,
    company: input.company || null,
    linkedin_url: input.linkedin_url || null,
    phone: input.phone || null,
    origin: 'manual',
  });

  const introducer = input.introducerName?.trim();
  if (introducer) {
    const introducerId = input.introducerIsSource ? null : r.findPersonByName(introducer);
    if (introducerId !== result.id) {
      r.addIntroduction({
        fromPersonId: introducerId,
        sourceLabel: introducerId == null ? introducer : null,
        toPersonId: result.id,
      });
    }
  }

  touch('/people', '/manage');
  return result;
}

// ─── The introduction graph ─────────────────────────────────────────────────

/** Record that `introducer` led you to this person. */
export async function addIntroductionToPerson(
  toPersonId: number,
  introducerName: string,
  treatAsSource = false,
) {
  const r = repo();
  const name = introducerName.trim();
  if (!name) return;
  const fromPersonId = treatAsSource ? null : r.findPersonByName(name);
  if (fromPersonId === toPersonId) return;
  r.addIntroduction({
    fromPersonId,
    sourceLabel: fromPersonId == null ? name : null,
    toPersonId,
  });
  touch('/people', `/people/${toPersonId}`);
}

/** Record that this person led you to a company ("Dana got me into Wiz"). */
export async function addIntroductionToCompany(fromPersonId: number, companyName: string, note?: string) {
  const r = repo();
  const companyId = r.ensureCompany(companyName);
  if (!companyId) return;
  r.addIntroduction({ fromPersonId, toCompanyId: companyId, note: note || null });
  touch('/people', `/people/${fromPersonId}`, `/companies/${companyId}`);
}

/** Record that this person led you to another person. */
export async function addIntroductionToNewPerson(
  fromPersonId: number,
  input: { full_name: string; company?: string; role?: string; linkedin_url?: string; phone?: string },
) {
  const r = repo();
  const { id } = r.upsertPerson({
    full_name: input.full_name,
    company: input.company || null,
    role: input.role || null,
    linkedin_url: input.linkedin_url || null,
    phone: input.phone || null,
    origin: 'manual',
  });
  if (id !== fromPersonId) r.addIntroduction({ fromPersonId, toPersonId: id });
  touch('/people', `/people/${fromPersonId}`, `/people/${id}`);
}

export async function removeIntroduction(introductionId: number, personId: number) {
  repo().removeIntroduction(introductionId);
  touch('/people', `/people/${personId}`);
}

// ─── The talk log ───────────────────────────────────────────────────────────

export async function logInteraction(input: {
  personId: number;
  channel?: string;
  occurredAt?: string;
  whatISaid?: string;
  outcome?: string;
  nextStep?: string;
  nextStepDue?: string;
}) {
  repo().logInteraction({
    personId: input.personId,
    channel: (input.channel as never) ?? 'other',
    occurredAt: input.occurredAt || undefined,
    whatISaid: input.whatISaid || null,
    outcome: input.outcome || null,
    nextStep: input.nextStep || null,
    nextStepDue: input.nextStepDue || null,
  });
  touch('/people', `/people/${input.personId}`);
}

export async function deleteInteraction(interactionId: number, personId: number) {
  repo().deleteInteraction(interactionId);
  touch(`/people/${personId}`);
}

// ─── The LinkedIn candidate pool ────────────────────────────────────────────

export async function promoteConnections(connectionIds: number[]): Promise<{ added: number }> {
  const r = repo();
  let added = 0;
  for (const id of connectionIds) {
    if (r.promoteConnection(id) != null) added++;
  }
  touch('/people', '/people/import');
  return { added };
}

// ─── Candidate review ───────────────────────────────────────────────────────

/**
 * Keep a scraped candidate: run identity resolution and create or merge a person.
 * Rejecting records the decision so the same guess is not offered again.
 */
export async function decideCandidate(candidateId: number, decision: 'kept' | 'rejected') {
  const handle = db();
  const r = repo();
  const cand = handle.prepare('SELECT * FROM person_candidates WHERE id = ?').get(candidateId) as
    | Record<string, any>
    | undefined;
  if (!cand) return;

  let personId: number | null = null;
  if (decision === 'kept') {
    const company = handle.prepare('SELECT name FROM companies WHERE id = ?').get(cand.company_id) as
      | { name: string }
      | undefined;
    personId = r.upsertPerson({
      full_name: cand.full_name,
      role: cand.role,
      company: company?.name ?? null,
      linkedin_url: cand.linkedin_url,
      origin: 'company_scan',
    }).id;
  }

  handle
    .prepare('UPDATE person_candidates SET decision = ?, person_id = ?, decided_at = ? WHERE id = ?')
    .run(decision, personId, new Date().toISOString(), candidateId);

  touch('/people', `/companies/${cand.company_id}`);
}

// ─── Roles ──────────────────────────────────────────────────────────────────

/**
 * Add a role the crawler will never find.
 *
 * Plenty of openings arrive by message, or sit on a page no extractor can read.
 * The company is created if it is new, so a job at somewhere not in any list can
 * still be tracked. Marked `manual`, which keeps a crawl from closing it: it is
 * not on the careers page by definition, so its absence proves nothing.
 */
export async function addManualRole(input: {
  company: string;
  title: string;
  url?: string;
  location?: string;
  note?: string;
}): Promise<{ ok: true; roleId: number; companyId: number } | { ok: false; error: string }> {
  const company = input.company.trim();
  const title = input.title.trim();
  if (!company || !title) return { ok: false, error: 'A company and a job title are both needed' };

  try {
    const r = repo();
    const companyId = r.ensureCompany(company);
    if (!companyId) return { ok: false, error: `Could not resolve a company called "${company}"` };

    const handle = db();
    const url = input.url?.trim() || null;

    const existing = handle
      .prepare(
        `SELECT id FROM positions
          WHERE company_id = ? AND lower(trim(title)) = lower(trim(?)) AND COALESCE(url,'') = COALESCE(?,'')`,
      )
      .get(companyId, title, url) as { id: number } | undefined;
    if (existing) {
      touch('/jobs', `/companies/${companyId}`);
      return { ok: true, roleId: existing.id, companyId };
    }

    const now = new Date().toISOString();
    const info = handle
      .prepare(
        `INSERT INTO positions
           (company_id, title, location, url, source, description, is_product, discovered_at, last_seen_at)
         VALUES (?, ?, ?, ?, 'manual', ?, 1, ?, ?)`,
      )
      .run(companyId, title, input.location?.trim() || null, url, input.note?.trim() || null, now, now);

    touch('/jobs', `/companies/${companyId}`);
    return { ok: true, roleId: Number(info.lastInsertRowid), companyId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Record who can get you into a role.
 *
 * Two distinct parts, either of which may be missing: the connector is the
 * person who opens the door, the contact is the person inside. They are usually
 * at different companies — "Tal from Claroty sent my CV to Shira from
 * SafeBreach" is a connector at one company reaching a contact at another.
 *
 * When both are present the introduction is also recorded in the people graph,
 * so it shows on each of their profiles and the chain can be reused for the next
 * role at that company rather than retyped.
 */
export async function addRolePath(input: {
  roleId: number;
  companyId: number;
  connectorName?: string;
  contactName?: string;
  contactCompany?: string;
  contactLinkedin?: string;
  contactPhone?: string;
  status?: string;
  note?: string;
}): Promise<{ ok: true; connectorId: number | null; contactId: number | null } | { ok: false; error: string }> {
  const r = repo();
  const connectorName = input.connectorName?.trim();
  const contactName = input.contactName?.trim();
  if (!connectorName && !contactName) {
    return { ok: false, error: 'Name at least one person' };
  }

  try {
    // A connector is someone already in your world, so reuse them if the name
    // matches rather than creating a second copy.
    const connectorId = connectorName
      ? (r.findPersonByName(connectorName) ??
         r.upsertPerson({ full_name: connectorName, origin: 'manual' }).id)
      : null;

    const contactId = contactName
      ? r.upsertPerson({
          full_name: contactName,
          company: input.contactCompany?.trim() || null,
          linkedin_url: input.contactLinkedin?.trim() || null,
          phone: input.contactPhone?.trim() || null,
          origin: 'manual',
        }).id
      : null;

    if (connectorId && contactId && connectorId !== contactId) {
      r.addIntroduction({ fromPersonId: connectorId, toPersonId: contactId, note: input.note?.trim() || null });
    }

    db()
      .prepare(
        `INSERT INTO outreach (position_id, company_id, connector_person_id, contact_person_id, status, note, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.roleId,
        input.companyId,
        connectorId,
        contactId,
        input.status ?? 'todo',
        input.note?.trim() || null,
        new Date().toISOString(),
      );

    touch('/jobs', `/companies/${input.companyId}`, '/people');
    return { ok: true, connectorId, contactId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setPathStatus(outreachId: number, status: string, companyId: number) {
  db().prepare('UPDATE outreach SET status = ?, contacted_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), outreachId);
  touch('/jobs', `/companies/${companyId}`);
}

export async function removeRolePath(outreachId: number, companyId: number) {
  db().prepare('DELETE FROM outreach WHERE id = ?').run(outreachId);
  touch('/jobs', `/companies/${companyId}`);
}

export async function setRoleStatus(roleId: number, status: string) {
  db()
    .prepare(
      `INSERT INTO role_tracking (position_id, status, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(position_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    )
    .run(roleId, status, new Date().toISOString());
  touch('/jobs');
}

export async function setRoleNote(roleId: number, note: string) {
  db()
    .prepare(
      `INSERT INTO role_tracking (position_id, applied_status, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(position_id) DO UPDATE SET applied_status = excluded.applied_status, updated_at = excluded.updated_at`,
    )
    .run(roleId, note, new Date().toISOString());
  touch('/jobs');
}
