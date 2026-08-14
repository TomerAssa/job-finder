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

export async function mergePeople(primaryId: number, duplicateIds: number[]) {
  repo().mergePeople(primaryId, duplicateIds);
  touch('/people', '/manage');
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
