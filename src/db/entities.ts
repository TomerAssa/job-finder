import { db, now } from './client.js';
import { normalizeCompany, normalizeName, similarity } from '../util/normalize.js';

let _companies: Array<{ id: number; name_norm: string }> | null = null;
function companies() {
  if (!_companies) _companies = db().prepare('SELECT id, name_norm FROM companies').all() as any[];
  return _companies;
}

/** Resolve a company name to one of our 500 (fuzzy), else keep as external label. */
export function matchCompany(name: string | null | undefined): { id?: number; external?: string } {
  if (!name || !name.trim()) return {};
  const norm = normalizeCompany(name);
  if (!norm) return { external: name.trim() };
  let best: { id: number; name_norm: string } | null = null;
  let bestScore = 0;
  for (const c of companies()) {
    const s = norm === c.name_norm ? 1 : similarity(norm, c.name_norm);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  if (best && bestScore >= 0.9) return { id: best.id };
  return { external: name.trim() };
}

export interface EntityInput {
  full_name: string;
  kind?: string;
  degree?: number | null;
  company?: string | null; // resolved to works_company_id / external_company
  role?: string | null;
  linkedin_url?: string | null;
  contact_detail?: string | null;
  talked_status?: string | null;
  conclusions?: string | null;
  relevant?: string | null;
  source?: string;
  notes?: string | null;
}

/**
 * Insert or update a person by normalized name. Only fills columns that are
 * currently empty (so imports/finders/manual edits merge rather than clobber).
 */
export function upsertEntity(input: EntityInput): number {
  const nameNorm = normalizeName(input.full_name); // reuse normalizer for people names too
  const handle = db();
  const existing = handle
    .prepare('SELECT * FROM entities WHERE name_norm = ? LIMIT 1')
    .get(nameNorm) as any;

  const comp = input.company ? matchCompany(input.company) : {};

  if (existing) {
    const set: Record<string, any> = {};
    const fill = (col: string, val: any) => {
      if (val != null && val !== '' && (existing[col] == null || existing[col] === '')) set[col] = val;
    };
    fill('kind', input.kind && input.kind !== 'manual' ? input.kind : undefined);
    fill('degree', input.degree ?? undefined);
    fill('works_company_id', comp.id);
    fill('external_company', comp.external);
    fill('role', input.role);
    fill('linkedin_url', input.linkedin_url);
    fill('contact_detail', input.contact_detail);
    fill('talked_status', input.talked_status);
    fill('conclusions', input.conclusions);
    fill('relevant', input.relevant);
    fill('notes', input.notes);
    const keys = Object.keys(set);
    if (keys.length) {
      handle
        .prepare(`UPDATE entities SET ${keys.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@id`)
        .run({ ...set, id: existing.id });
    }
    return existing.id;
  }

  const info = handle
    .prepare(
      `INSERT INTO entities
        (full_name, name_norm, kind, degree, works_company_id, external_company, role, linkedin_url,
         contact_detail, talked_status, conclusions, relevant, source, notes, created_at)
       VALUES (@full_name,@name_norm,@kind,@degree,@works_company_id,@external_company,@role,@linkedin_url,
         @contact_detail,@talked_status,@conclusions,@relevant,@source,@notes,@created_at)`,
    )
    .run({
      full_name: input.full_name.trim(),
      name_norm: nameNorm,
      kind: input.kind ?? 'manual',
      degree: input.degree ?? null,
      works_company_id: comp.id ?? null,
      external_company: comp.external ?? null,
      role: input.role ?? null,
      linkedin_url: input.linkedin_url ?? null,
      contact_detail: input.contact_detail ?? null,
      talked_status: input.talked_status ?? null,
      conclusions: input.conclusions ?? null,
      relevant: input.relevant ?? null,
      source: input.source ?? 'manual',
      notes: input.notes ?? null,
      created_at: now(),
    });
  return Number(info.lastInsertRowid);
}

/** Company id for a name, matching our 500 or creating a lightweight 'tracked' company. */
export function ensureCompany(name: string | null | undefined): number | null {
  if (!name || !name.trim()) return null;
  const m = matchCompany(name);
  if (m.id) return m.id;
  const norm = normalizeCompany(name) || normalizeName(name);
  const handle = db();
  handle
    .prepare(`INSERT INTO companies (name, name_norm, status, created_at) VALUES (?,?,'tracked',?) ON CONFLICT(name_norm) DO NOTHING`)
    .run(name.trim(), norm, now());
  _companies = null; // invalidate cache
  const row = handle.prepare('SELECT id FROM companies WHERE name_norm = ?').get(norm) as any;
  return row ? row.id : null;
}

export function findEntityByName(name: string): number | null {
  const row = db()
    .prepare('SELECT id FROM entities WHERE name_norm = ? LIMIT 1')
    .get(normalizeName(name)) as any;
  return row ? row.id : null;
}

export function setEntityKind(id: number, kind: string): void {
  db().prepare('UPDATE entities SET kind = ? WHERE id = ?').run(kind, id);
}
