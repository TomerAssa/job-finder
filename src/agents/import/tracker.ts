import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { z } from 'zod';
import { db, now } from '../../db/client.js';
import { similarity } from '../../util/normalize.js';
import { extract } from '../../llm/provider.js';
import {
  upsertPerson, findPersonByName, addIntroduction, logInteraction,
} from '../../db/people.js';
import { ensureCompany } from '../../db/companies.js';

type Row = Record<string, any>;

function readSheet(path: string, sheet?: string): Row[] {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
  const name = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }) as Row[];
}

const str = (v: any): string => (v == null ? '' : String(v)).trim();

// ─── People sheet (Job hunting leads.xlsx → אנשים) ──────────────────────────
const P = {
  name: 'שם', company: 'חברה', circle: 'מעגל', ledBy: 'מי הוביל אליו',
  talked: 'דיברנו', concl: 'מסקנות', follow: 'followups', relevant: 'רלוונטי להמשך',
};

function importLeads(path: string): { people: number; edges: number } {
  const rows = readSheet(path, 'אנשים');
  let people = 0;
  const ledByPairs: Array<{ from: string; ledBy: string }> = [];

  for (const r of rows) {
    const name = str(r[P.name]);
    if (!name) continue;

    // מעגל is the user's own hop count. `people.circle` is derived from the
    // introduction graph now, so the sheet's value is kept as a note rather than
    // silently overriding what the edges say.
    const degRaw = str(r[P.circle]);
    const { id } = upsertPerson({
      full_name: name,
      company: str(r[P.company]) || null,
      summary: str(r[P.concl]) || null,          // מסקנות
      relevant: str(r[P.relevant]).toLowerCase() || null,
      origin: 'tracker_import',
      notes: [degRaw ? `circle (from tracker): ${degRaw}` : '', str(r[P.follow])]
        .filter(Boolean).join(' | ') || null,
    });
    people++;

    // דיברנו recorded that a conversation happened. That is history, so it goes
    // in the log rather than on the person.
    const talked = str(r[P.talked]);
    if (talked) logInteraction({ personId: id, channel: 'other', outcome: talked });

    const ledBy = str(r[P.ledBy]);
    if (ledBy) ledByPairs.push({ from: name, ledBy });
  }

  // Second pass, once every name in the sheet exists: "who led me to them".
  // Note the direction — the sheet's ledBy is the introducer, so it becomes
  // `from`, and the row's own person becomes `to`.
  let edges = 0;
  for (const { from, ledBy } of ledByPairs) {
    const reachedId = findPersonByName(from);
    if (!reachedId) continue;
    const introducerId = findPersonByName(ledBy);
    if (introducerId === reachedId) continue;
    const created = addIntroduction({
      fromPersonId: introducerId,
      sourceLabel: introducerId ? null : ledBy, // a community or family member
      toPersonId: reachedId,
    });
    if (created != null) edges++;
  }
  return { people, edges };
}

// ─── positions.xlsx (edited export with tracking columns) ───────────────────
const OutreachPaths = z.object({
  paths: z
    .array(
      z.object({
        connector: z.string().nullable().optional(), // my-side person who intros
        contact: z.string().nullable().optional(), // person AT the target company
        contact_detail: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        relevant: z.boolean().nullable().optional(),
      }),
    )
    .optional(),
});

function matchOrCreatePosition(companyId: number, title: string, url: string): number {
  const handle = db();
  if (url) {
    const byUrl = handle.prepare('SELECT id FROM positions WHERE url = ? LIMIT 1').get(url) as any;
    if (byUrl) return byUrl.id;
  }
  const rows = handle.prepare('SELECT id, title FROM positions WHERE company_id = ?').all(companyId) as any[];
  let best: { id: number; s: number } | null = null;
  for (const p of rows) {
    const s = similarity(title.toLowerCase(), (p.title ?? '').toLowerCase());
    if (!best || s > best.s) best = { id: p.id, s };
  }
  if (best && best.s >= 0.7) return best.id;
  const info = handle
    .prepare(
      `INSERT INTO positions (company_id, title, url, source, is_product, discovered_at)
       VALUES (?, ?, ?, 'tracker', 1, ?)`,
    )
    .run(companyId, title, url || null, now());
  return Number(info.lastInsertRowid);
}

async function parsePaths(row: Row): Promise<z.infer<typeof OutreachPaths>['paths']> {
  const fields = {
    company_employee: str(row['company employee']),
    company_employee_detail: str(row['company employee contact detail']),
    indirect_contact: str(row['indirect contact']),
    indirect_detail: str(row['indirect contact detail']),
    messaged: str(row['שלחתי הודעה']),
    status: str(row['סטטוס']),
  };
  if (!fields.company_employee && !fields.indirect_contact && !fields.messaged && !fields.status) return [];
  const { paths } = await extract(
    `These are Hebrew job-application tracking fields for one role. Extract the outreach PATHS.\n` +
      `- "indirect contact" is formatted "<connector> - <person at company>", possibly several ` +
      `separated by "/". The connector is someone in MY network; the person is AT the company.\n` +
      `- "company employee" is a DIRECT contact at the company (but may be a note like "ask in the ` +
      `unit" → then connector=null, contact=null).\n` +
      `- Parentheticals like "(לא רלוונטי)" mean that path is NOT relevant → set relevant=false.\n` +
      `- Use "sent message"/"status" for a short status string per path (or overall).\n` +
      `Only output real person names for connector/contact; put notes/instructions into status.\n\n` +
      `Return JSON {"paths":[{"connector","contact","contact_detail","status","relevant"}]}\n\n` +
      `company employee: ${fields.company_employee}\ncompany employee detail: ${fields.company_employee_detail}\n` +
      `indirect contact: ${fields.indirect_contact}\nindirect detail: ${fields.indirect_detail}\n` +
      `sent message: ${fields.messaged}\nstatus: ${fields.status}`,
    OutreachPaths,
    { temperature: 0 },
  );
  return paths ?? [];
}

async function importPositions(path: string): Promise<{ tracked: number; paths: number }> {
  const rows = readSheet(path, 'positions');
  const handle = db();
  const trackStmt = handle.prepare(
    `INSERT INTO role_tracking (position_id, relevant, applied_status, messaged, updated_at)
     VALUES (@position_id,@relevant,@applied_status,@messaged,@updated_at)
     ON CONFLICT(position_id) DO UPDATE SET relevant=excluded.relevant,
       applied_status=excluded.applied_status, messaged=excluded.messaged, updated_at=excluded.updated_at`,
  );
  const outStmt = handle.prepare(
    `INSERT INTO outreach (position_id, company_id, connector_person_id, contact_person_id, channel, status, note, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let tracked = 0;
  let pathCount = 0;
  for (const r of rows) {
    const company = str(r['company']);
    const title = str(r['title']);
    if (!company || !title) continue;
    const companyId = ensureCompany(company);
    if (!companyId) continue;
    const url = str(r['url']).split(/\s*\/\s*/)[0];
    const positionId = matchOrCreatePosition(companyId, title, url);

    trackStmt.run({
      position_id: positionId,
      relevant: str(r['relevant']).toLowerCase() || null,
      applied_status: str(r['סטטוס']) || null,
      messaged: str(r['שלחתי הודעה']) || null,
      updated_at: now(),
    });
    tracked++;

    const paths = await parsePaths(r);
    for (const p of paths ?? []) {
      const connectorId = p.connector
        ? upsertPerson({ full_name: p.connector, origin: 'tracker_import' }).id
        : null;
      // contact_detail is either a phone or a profile URL depending on the row;
      // upsertPerson normalizes each and ignores the one that doesn't apply.
      const contactId = p.contact
        ? upsertPerson({
            full_name: p.contact,
            company,
            phone: p.contact_detail ?? null,
            linkedin_url: p.contact_detail ?? null,
            origin: 'tracker_import',
          }).id
        : null;
      if (!connectorId && !contactId && !p.status) continue;
      outStmt.run(
        positionId, companyId, connectorId, contactId, null,
        p.relevant === false ? 'not_relevant' : 'contacted', p.status ?? null, now(),
      );
      pathCount++;

      // A connector who got you to a contact at a company is an introduction —
      // that pairing was the only thing the old import recovered, and it was
      // dropped on the floor.
      if (connectorId && contactId && connectorId !== contactId) {
        addIntroduction({ fromPersonId: connectorId, toPersonId: contactId });
      }
    }
  }
  return { tracked, paths: pathCount };
}

/** Import both trackers: people graph first, then per-role tracking + outreach paths. */
export async function runImportTracker(leadsPath: string, positionsPath: string): Promise<void> {
  const { existsSync } = await import('node:fs');
  if (existsSync(leadsPath)) {
    const r = importLeads(leadsPath);
    console.log(`👥 Leads: ${r.people} people, ${r.edges} "led-me-to" edges`);
  } else console.warn(`⚠️  Leads file not found: ${leadsPath}`);

  if (existsSync(positionsPath)) {
    console.log('🧩 Parsing per-role contact paths via Gemini…');
    const r = await importPositions(positionsPath);
    console.log(`📌 Roles tracked: ${r.tracked}; outreach paths: ${r.paths}`);
  } else console.warn(`⚠️  Positions file not found: ${positionsPath}`);
}
