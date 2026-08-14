/**
 * Demo data, so a fresh clone shows a working product instead of five empty screens.
 *
 * Every row is flagged `is_demo = 1` and every name is deliberately invented —
 * no plausible-looking real people, because a contact list is exactly the kind of
 * thing where fake data that looks real does damage. Finishing setup deletes all
 * of it in one transaction.
 */
import { db, now } from '../db/client.js';
import { createRepo } from '../db/repo.js';
import { normalizeCompany } from '../util/normalize.js';

export interface DemoStatus {
  people: number;
  companies: number;
  positions: number;
  /** True when the database holds anything the user actually owns. */
  hasRealData: boolean;
}

export function demoStatus(): DemoStatus {
  const handle = db();
  const count = (sql: string) => (handle.prepare(sql).get() as { c: number }).c;
  return {
    people: count('SELECT COUNT(*) c FROM people WHERE is_demo = 1'),
    companies: count('SELECT COUNT(*) c FROM companies WHERE is_demo = 1'),
    positions: count('SELECT COUNT(*) c FROM positions WHERE is_demo = 1'),
    hasRealData:
      count('SELECT COUNT(*) c FROM people WHERE is_demo = 0') > 0 ||
      count('SELECT COUNT(*) c FROM companies WHERE is_demo = 0') > 0,
  };
}

const DEMO_LIST = 'Demo sector';

/** Invented companies. The names are not meant to resemble anything real. */
const COMPANIES = [
  { name: 'Vantablade Security', sector: 'Cyber Security', site: 'https://example.com/vantablade' },
  { name: 'Quillstone Labs', sector: 'Cyber Security', site: 'https://example.com/quillstone' },
  { name: 'Mirrowen Data', sector: 'Data Infrastructure', site: 'https://example.com/mirrowen' },
  { name: 'Threndle Health', sector: 'Health Tech', site: 'https://example.com/threndle' },
];

const POSITIONS: Array<{ company: string; title: string; seniority: string; min: number | null; max: number | null }> = [
  { company: 'Vantablade Security', title: 'Product Manager, Detection', seniority: 'mid', min: 2, max: 4 },
  { company: 'Vantablade Security', title: 'Senior Backend Engineer', seniority: 'senior', min: 5, max: 8 },
  { company: 'Quillstone Labs', title: 'Associate Product Manager', seniority: 'junior', min: 1, max: 3 },
  { company: 'Quillstone Labs', title: 'Product Builder, Platform', seniority: 'mid', min: 2, max: 5 },
  { company: 'Mirrowen Data', title: 'Product Manager', seniority: 'mid', min: 3, max: 6 },
  { company: 'Threndle Health', title: 'Product Owner, Clinical Tools', seniority: 'mid', min: 2, max: 4 },
];

const PEOPLE = [
  { name: 'Orla Fenwick', role: 'Group Product Manager', company: 'Vantablade Security', give: ['intro', 'advice'] },
  { name: 'Dev Ashgrove', role: 'Talent Partner', company: 'Vantablade Security', give: ['referral'] },
  { name: 'Petra Lindqvist', role: 'Product Manager', company: 'Quillstone Labs', give: ['intro', 'lead'] },
  { name: 'Ilan Brackwater', role: 'Engineering Manager', company: 'Mirrowen Data', give: ['advice'] },
  { name: 'Sunniva Halloway', role: 'Founder', company: 'Threndle Health', give: ['intro', 'referral'] },
  { name: 'Marek Underhill', role: 'Product Consultant', company: null, give: ['advice'] },
];

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * Insert the demo dataset. Refuses when the database already holds real data,
 * so it can never be mixed into someone's actual job search by accident.
 */
export function seedDemo(opts: { force?: boolean } = {}): DemoStatus {
  const handle = db();
  const repo = createRepo(handle);
  const status = demoStatus();

  if (status.hasRealData && !opts.force) {
    throw new Error(
      'This database already holds real data. Seeding demo rows into it would mix ' +
        'invented contacts with your own. Use --force only if you are sure.',
    );
  }
  if (status.people > 0 || status.companies > 0) purgeDemo();

  const timestamp = now();

  handle
    .prepare(
      `INSERT INTO company_lists (name, source_file, imported_at) VALUES (?, 'demo', ?)
       ON CONFLICT(name) DO UPDATE SET imported_at = excluded.imported_at`,
    )
    .run(DEMO_LIST, timestamp);
  const listId = (handle.prepare('SELECT id FROM company_lists WHERE name = ?').get(DEMO_LIST) as { id: number }).id;

  const companyIds = new Map<string, number>();
  for (const c of COMPANIES) {
    handle
      .prepare(
        `INSERT INTO companies (name, name_norm, sector, website_url, careers_url, status, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, 'checked', 1, ?)
         ON CONFLICT(name_norm) DO NOTHING`,
      )
      .run(c.name, normalizeCompany(c.name), c.sector, c.site, `${c.site}/careers`, timestamp);
    const row = handle.prepare('SELECT id FROM companies WHERE name_norm = ?').get(normalizeCompany(c.name)) as { id: number };
    companyIds.set(c.name, row.id);
    handle
      .prepare('INSERT INTO company_list_members (list_id, company_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(listId, row.id);
  }
  repo.invalidateCompanyCache();

  for (const p of POSITIONS) {
    const companyId = companyIds.get(p.company)!;
    const info = handle
      .prepare(
        `INSERT INTO positions (company_id, title, location, url, source, is_product, is_demo, discovered_at)
         VALUES (?, ?, 'Tel Aviv', ?, 'demo', ?, 1, ?)
         ON CONFLICT(company_id, title, url) DO NOTHING`,
      )
      .run(companyId, p.title, `https://example.com/jobs/${encodeURIComponent(p.title)}`,
           /product/i.test(p.title) && !/engineer/i.test(p.title) ? 1 : 0, timestamp);
    if (info.changes > 0) {
      handle
        .prepare(
          `INSERT INTO position_requirements (position_id, seniority, min_years, max_years, is_israel, enriched_at)
           VALUES (?, ?, ?, ?, 1, ?)`,
        )
        .run(Number(info.lastInsertRowid), p.seniority, p.min, p.max, timestamp);
    }
  }

  const peopleIds = new Map<string, number>();
  for (const p of PEOPLE) {
    const { id } = repo.upsertPerson({
      full_name: p.name,
      role: p.role,
      company: p.company,
      can_give: p.give,
      origin: 'manual',
      is_demo: true,
    });
    peopleIds.set(p.name, id);
  }

  // A chain, so the graph shows what it is for: a community led you to Orla,
  // Orla led you to Petra, Petra got you into Quillstone.
  repo.addIntroduction({ sourceLabel: 'Product Managers meetup', toPersonId: peopleIds.get('Orla Fenwick')! });
  repo.addIntroduction({ fromPersonId: peopleIds.get('Orla Fenwick')!, toPersonId: peopleIds.get('Petra Lindqvist')! });
  repo.addIntroduction({ fromPersonId: peopleIds.get('Orla Fenwick')!, toPersonId: peopleIds.get('Dev Ashgrove')! });
  repo.addIntroduction({
    fromPersonId: peopleIds.get('Petra Lindqvist')!,
    toCompanyId: companyIds.get('Quillstone Labs')!,
    note: 'Forwarded my CV internally',
  });
  repo.addIntroduction({ sourceLabel: 'Former colleague', toPersonId: peopleIds.get('Marek Underhill')! });

  repo.logInteraction({
    personId: peopleIds.get('Orla Fenwick')!,
    occurredAt: daysAgo(21),
    channel: 'in_person',
    whatISaid: 'Asked what the detection team is actually like day to day.',
    outcome: 'Said the role is real and offered to introduce me to Petra.',
    nextStep: 'Thank her once Petra replies',
  });
  repo.logInteraction({
    personId: peopleIds.get('Petra Lindqvist')!,
    occurredAt: daysAgo(9),
    channel: 'linkedin',
    whatISaid: 'Mentioned Orla, asked about the APM opening.',
    outcome: 'Forwarded my CV to their hiring manager.',
    nextStep: 'Follow up if no reply',
    nextStepDue: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
  });

  handle
    .prepare(`UPDATE people SET summary = ? WHERE id = ?`)
    .run('Warmest path in. Introduced me to Petra; worth keeping posted.', peopleIds.get('Orla Fenwick')!);

  return demoStatus();
}

/** Delete every demo row in one transaction. Nothing real is touched. */
export function purgeDemo(): { people: number; companies: number; positions: number } {
  const handle = db();
  let people = 0;
  let companies = 0;
  let positions = 0;

  handle.transaction(() => {
    // Cascades take the introductions and interactions with them.
    people = handle.prepare('DELETE FROM people WHERE is_demo = 1').run().changes;
    positions = handle.prepare('DELETE FROM positions WHERE is_demo = 1').run().changes;
    companies = handle.prepare('DELETE FROM companies WHERE is_demo = 1').run().changes;
    handle.prepare('DELETE FROM company_lists WHERE source_file = ?').run('demo');
  })();

  return { people, companies, positions };
}
