'use server';
import { revalidatePath } from 'next/cache';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { db, nowIso } from './db';

const pexec = promisify(execFile);
const pid = (s: string) => Number(String(s).replace(/^p/, ''));
const cid = (s: string) => Number(String(s).replace(/^c/, ''));
const normName = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export async function setPersonStatus(personId: string, status: string) {
  db().prepare('UPDATE entities SET status=? WHERE id=?').run(status, pid(personId));
  revalidatePath('/');
}

export async function setPersonNotes(personId: string, notes: string) {
  db().prepare('UPDATE entities SET conclusions=? WHERE id=?').run(notes, pid(personId));
  revalidatePath('/');
}

function companyIdByName(name: string): number | null {
  if (!name?.trim()) return null;
  const row = db().prepare('SELECT id FROM companies WHERE lower(name)=lower(?) LIMIT 1').get(name.trim()) as any;
  return row ? row.id : null;
}

export async function updateEntity(personId: string, f: { name?: string; kind?: string; company?: string; degree?: number | null; status?: string }) {
  const id = pid(personId);
  const sets: string[] = [], vals: any[] = [];
  if (f.name != null) { sets.push('full_name=?', 'name_norm=?'); vals.push(f.name.trim(), normName(f.name)); }
  if (f.kind != null) { sets.push('kind=?'); vals.push(f.kind); }
  if (f.degree !== undefined) { sets.push('degree=?'); vals.push(f.degree); }
  if (f.status != null) { sets.push('status=?'); vals.push(f.status); }
  if (f.company != null) { const cId = companyIdByName(f.company); sets.push('works_company_id=?', 'external_company=?'); vals.push(cId, cId ? null : (f.company.trim() || null)); }
  if (sets.length) { vals.push(id); db().prepare(`UPDATE entities SET ${sets.join(', ')} WHERE id=?`).run(...vals); }
  revalidatePath('/');
}

export async function deleteEntity(personId: string) {
  db().prepare('DELETE FROM entities WHERE id=?').run(pid(personId));
  revalidatePath('/');
}

/** Merge duplicate people into one primary entity. */
export async function mergeEntities(primaryId: string, dupIds: string[]) {
  const primary = pid(primaryId);
  const handle = db();
  const tx = handle.transaction(() => {
    for (const d of dupIds) {
      const dup = pid(d);
      if (dup === primary) continue;
      handle.prepare('UPDATE outreach SET connector_entity_id=? WHERE connector_entity_id=?').run(primary, dup);
      handle.prepare('UPDATE outreach SET contact_entity_id=? WHERE contact_entity_id=?').run(primary, dup);
      handle.prepare('UPDATE OR IGNORE relationships SET from_entity_id=? WHERE from_entity_id=?').run(primary, dup);
      handle.prepare('UPDATE OR IGNORE relationships SET to_entity_id=? WHERE to_entity_id=?').run(primary, dup);
      handle.prepare(
        `UPDATE entities SET
           works_company_id=COALESCE(works_company_id,(SELECT works_company_id FROM entities WHERE id=@d)),
           linkedin_url=COALESCE(linkedin_url,(SELECT linkedin_url FROM entities WHERE id=@d)),
           contact_detail=COALESCE(contact_detail,(SELECT contact_detail FROM entities WHERE id=@d)),
           role=COALESCE(role,(SELECT role FROM entities WHERE id=@d)),
           degree=COALESCE(degree,(SELECT degree FROM entities WHERE id=@d)),
           conclusions=COALESCE(conclusions,(SELECT conclusions FROM entities WHERE id=@d))
         WHERE id=@p`,
      ).run({ d: dup, p: primary });
      handle.prepare('DELETE FROM entities WHERE id=?').run(dup); // cascades stray rels
    }
    handle.prepare('DELETE FROM relationships WHERE from_entity_id=to_entity_id').run();
  });
  tx();
  revalidatePath('/');
}

export async function setRoleStatus(roleId: string, status: string) {
  const id = pid(roleId.replace(/^r/, 'p')); // strip 'r'
  const rid = Number(String(roleId).replace(/^r/, ''));
  db()
    .prepare(
      `INSERT INTO role_tracking (position_id, status, updated_at) VALUES (?,?,?)
       ON CONFLICT(position_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`,
    )
    .run(rid, status, nowIso());
  revalidatePath('/');
}

export interface AddPersonInput {
  mode: 'linkedin' | 'manual';
  name: string; url?: string; phone?: string; role?: string;
  viaId?: string; viaText?: string; companyId?: string; // 'c<id>' | 'c_none'
}

export async function addPerson(input: AddPersonInput): Promise<string> {
  const handle = db();
  const name = input.name.trim() || 'New lead';
  const companyId = input.companyId && input.companyId !== 'c_none' ? cid(input.companyId) : null;

  // resolve "who knows them"
  let viaEntityId: number | null = null;
  let sourceLabel: string | null = null;
  const txt = (input.viaText ?? '').trim();
  if (txt) {
    const ex = handle.prepare('SELECT id FROM entities WHERE name_norm LIKE ? LIMIT 1').get(`%${normName(txt)}%`) as any;
    if (ex) viaEntityId = ex.id;
    else {
      const info = handle
        .prepare(`INSERT INTO entities (full_name,name_norm,kind,degree,status,can_give,source,created_at) VALUES (?,?, 'connector', 1, 'to-reach', '["intro"]', 'manual', ?)`)
        .run(txt, normName(txt), nowIso());
      viaEntityId = Number(info.lastInsertRowid);
    }
  } else if (input.viaId?.startsWith('p')) viaEntityId = pid(input.viaId);
  else if (input.viaId?.startsWith('s')) sourceLabel = null; // source pill handled below

  const info = handle
    .prepare(
      `INSERT INTO entities (full_name,name_norm,kind,degree,works_company_id,role,linkedin_url,contact_detail,status,can_give,source,notes,created_at)
       VALUES (?,?, 'found', 2, ?, ?, ?, ?, 'new', '["lead"]', 'manual', ?, ?)`,
    )
    .run(name, normName(name), companyId, input.role ?? (input.mode === 'linkedin' ? 'Product Manager' : 'Contact'),
      input.mode === 'linkedin' ? input.url ?? null : null,
      input.mode === 'manual' ? input.phone ?? null : null,
      input.mode === 'linkedin' ? 'Added from LinkedIn.' : 'Added by phone — attach LinkedIn later.', nowIso());
  const newId = Number(info.lastInsertRowid);

  if (viaEntityId || sourceLabel) {
    handle
      .prepare(`INSERT OR IGNORE INTO relationships (from_entity_id, relation, to_entity_id, source_label, created_at) VALUES (?, 'led_me_to', ?, ?, ?)`)
      .run(newId, viaEntityId, sourceLabel, nowIso());
  }
  revalidatePath('/');
  return `p${newId}`;
}

/** Real LinkedIn PM/HR scrape for a company (shells out to the pipeline CLI). */
export async function expandEmployees(companyId: string): Promise<Array<{ id: string; name: string; role: string; ctype: string; linkedin: string }>> {
  const root = resolve(process.cwd(), '..');
  try {
    const { stdout } = await pexec('npx', ['tsx', 'src/cli.ts', 'people', '--company', String(cid(companyId)), '--json'], {
      cwd: root, timeout: 90_000, env: { ...process.env, GEMINI_RPM: '300' },
    });
    const found = JSON.parse(stdout.trim() || '[]') as any[];
    revalidatePath('/');
    return found.map((f) => ({ id: `p${f.id}`, name: f.name, role: f.role, ctype: f.kind, linkedin: f.linkedin }));
  } catch {
    return [];
  }
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function parseSlugName(url: string): string {
  const slug = (String(url).split('/in/')[1] || '').split(/[/?#]/)[0];
  const t = slug.split('-').filter((x) => /^[a-z]+$/i.test(x) && x.length > 1);
  return t.slice(0, 2).map((x) => cap(x.toLowerCase())).join(' ');
}
function findOrCreateEntity(name: string, kind: string, companyId?: number | null, extra: any = {}): number {
  const nn = normName(name);
  const ex = db().prepare('SELECT id FROM entities WHERE name_norm=? LIMIT 1').get(nn) as any;
  if (ex) return ex.id;
  const info = db().prepare(
    `INSERT INTO entities (full_name,name_norm,kind,degree,works_company_id,role,linkedin_url,status,can_give,source,created_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?)`,
  ).run(name.trim(), nn, kind, extra.degree ?? (kind === 'connector' ? 1 : 2), companyId ?? null, extra.role ?? null, extra.linkedin ?? null, extra.status ?? 'new', kind === 'connector' ? '["intro"]' : '["lead"]', nowIso());
  return Number(info.lastInsertRowid);
}

/** Editable per-job description (the Excel "status" slot → role_tracking.applied_status). */
export async function setRoleNote(roleId: string, note: string) {
  const rid = Number(String(roleId).replace(/^r/, ''));
  db().prepare(
    `INSERT INTO role_tracking (position_id, applied_status, updated_at) VALUES (?,?,?)
     ON CONFLICT(position_id) DO UPDATE SET applied_status=excluded.applied_status, updated_at=excluded.updated_at`,
  ).run(rid, note, nowIso());
  revalidatePath('/');
}

export interface AddLeadInput { mode: 'linkedin' | 'manual'; url?: string; name?: string; role?: string; connector?: string; cold?: boolean; status?: string }
/** Add a lead/contact at a company: paste LinkedIn (autofills name), tag a connector or cold, set status. */
export async function addLead(companyId: string, input: AddLeadInput): Promise<any> {
  const cId = cid(companyId);
  let name = (input.name ?? '').trim();
  if (input.mode === 'linkedin' && input.url) name = parseSlugName(input.url) || name;
  if (!name) name = 'New lead';
  const role = input.role ?? 'Product Manager';
  const contactId = findOrCreateEntity(name, 'found', cId, { role, linkedin: input.mode === 'linkedin' ? input.url : null });
  // if we matched an EXISTING person (e.g. a connection you know there), attach them to this company
  db().prepare('UPDATE entities SET works_company_id=COALESCE(works_company_id, ?) WHERE id=?').run(cId, contactId);
  let connectorId: number | null = null;
  let connectorName: string | null = null;
  if (!input.cold && input.connector?.trim()) {
    connectorName = input.connector.trim();
    connectorId = findOrCreateEntity(connectorName, 'connector', null);
    db().prepare(`INSERT OR IGNORE INTO relationships (from_entity_id, relation, to_entity_id, created_at) VALUES (?, 'led_me_to', ?, ?)`).run(contactId, connectorId, nowIso());
  }
  const status = input.status ?? (input.cold ? 'cold' : 'none');
  db().prepare(`INSERT INTO outreach (company_id, contact_entity_id, connector_entity_id, status, added_at) VALUES (?,?,?,?,?)`)
    .run(cId, contactId, connectorId, status, nowIso());
  revalidatePath('/');
  return {
    id: `p${contactId}`, name, role, ci: companyId, linkedin: input.mode === 'linkedin' ? (input.url ?? '') : '', phone: '',
    circle: 2, ctype: 'found', status: 'new', give: ['lead'], ledBy: null, viaId: connectorId ? `p${connectorId}` : null,
    ask: [], notes: '', outreach: status, via: connectorName,
  };
}

/** Update a lead's connector (who connects me / cold). */
export async function setContactVia(contactId: string, companyId: string, connector: string | null) {
  const connectorId = connector?.trim() ? findOrCreateEntity(connector.trim(), 'connector', null) : null;
  const cId = cid(companyId), ct = pid(contactId);
  const row = db().prepare('SELECT id FROM outreach WHERE contact_entity_id=? AND company_id=? LIMIT 1').get(ct, cId) as any;
  if (row) db().prepare('UPDATE outreach SET connector_entity_id=? WHERE id=?').run(connectorId, row.id);
  else db().prepare(`INSERT INTO outreach (company_id, contact_entity_id, connector_entity_id, status, added_at) VALUES (?,?,?, 'none', ?)`).run(cId, ct, connectorId, nowIso());
  if (connectorId) db().prepare(`INSERT OR IGNORE INTO relationships (from_entity_id, relation, to_entity_id, created_at) VALUES (?, 'led_me_to', ?, ?)`).run(ct, connectorId, nowIso());
  revalidatePath('/');
}

export async function logOutreach(contactId: string, companyId: string, status: string) {
  const handle = db();
  const existing = handle.prepare('SELECT id FROM outreach WHERE contact_entity_id=? AND company_id=? LIMIT 1').get(pid(contactId), cid(companyId)) as any;
  if (existing) handle.prepare('UPDATE outreach SET status=? WHERE id=?').run(status, existing.id);
  else handle.prepare(`INSERT INTO outreach (company_id, contact_entity_id, status, added_at) VALUES (?,?,?,?)`).run(cid(companyId), pid(contactId), status, nowIso());
  revalidatePath('/');
}
