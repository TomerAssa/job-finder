/**
 * Tests for the people layer. Runs against a throwaway database so it never
 * touches data/output/job.db.
 *
 *   npm test
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'job-agent-test-'));
process.env.JOB_DB = join(dir, 'test.db');

const { initDb, db, now } = await import('./client.js');
const {
  upsertPerson, resolvePerson, addIntroduction, introductionsFor, logInteraction,
  interactionsFor, getPerson, mergePeople, promoteConnection, findPersonByName,
} = await import('./people.js');
const { invalidateCompanyCache } = await import('./companies.js');

await initDb();

// Two companies so name+company resolution has something real to bind to.
db()
  .prepare(`INSERT INTO companies (name, name_norm, status, created_at) VALUES (?, ?, 'tracked', ?)`)
  .run('Wiz', 'wiz', now());
db()
  .prepare(`INSERT INTO companies (name, name_norm, status, created_at) VALUES (?, ?, 'tracked', ?)`)
  .run('Snyk', 'snyk', now());
invalidateCompanyCache();

after(() => rmSync(dir, { recursive: true, force: true }));

describe('identity resolution', () => {
  test('the same person via a LinkedIn URL in three different shapes is one row', () => {
    const a = upsertPerson({
      full_name: 'Dana Cohen',
      linkedin_url: 'https://www.linkedin.com/in/dana-cohen-x1/',
      origin: 'manual',
    });
    const b = upsertPerson({
      full_name: 'D. Cohen',
      linkedin_url: 'http://il.linkedin.com/in/dana-cohen-x1?originalSubdomain=il',
    });
    const c = upsertPerson({ full_name: 'Dana', linkedin_url: 'linkedin.com/pub/dana-cohen-x1' });

    assert.equal(a.created, true);
    assert.equal(b.created, false, 'trailing slash + subdomain + query is the same profile');
    assert.equal(c.created, false, '/pub/ is the same profile as /in/');
    assert.equal(b.id, a.id);
    assert.equal(c.id, a.id);
  });

  test('the same person via a phone number in three different shapes is one row', () => {
    const a = upsertPerson({ full_name: 'Yoni Levi', phone: '054-123-4599' });
    const b = upsertPerson({ full_name: 'Yoni Levi', phone: '+972 54 123 4599' });
    const c = upsertPerson({ full_name: 'Y Levi', phone: '00972541234599' });

    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(c.created, false);
    assert.equal(getPerson(a.id)!.phone, '+972541234599', 'stored in E.164');
  });

  test('name alone is NOT an identity key', () => {
    // Two different people who happen to share a name, at different companies.
    const first = upsertPerson({ full_name: 'Noa Bar', company: 'Wiz' });
    const second = upsertPerson({ full_name: 'Noa Bar', company: 'Snyk' });
    assert.equal(second.created, true, 'same name at a different company is a different person');
    assert.notEqual(second.id, first.id);

    // With no company at all there is nothing to bind to, so it must not match either.
    const third = upsertPerson({ full_name: 'Noa Bar' });
    assert.equal(third.created, true);
    assert.equal(resolvePerson({ full_name: 'Noa Bar' }), null, 'a bare name resolves to nobody');
  });

  test('name + company resolves to the existing person', () => {
    upsertPerson({ full_name: 'Tal Peled', company: 'Wiz' });
    // "Wiz, Inc." normalizes onto the same company.
    const again = upsertPerson({ full_name: 'Tal Peled', company: 'Wiz, Inc.' });
    assert.equal(again.created, false);
  });
});

describe('scraped writes never clobber user edits', () => {
  test('a fill only touches empty columns', () => {
    const { id } = upsertPerson({
      full_name: 'Maya Gold',
      linkedin_url: 'https://www.linkedin.com/in/maya-gold-1',
      role: 'Group PM',
      notes: 'met at a meetup',
    });

    // A later scrape reports a different role and its own notes.
    upsertPerson({
      full_name: 'Maya Gold',
      linkedin_url: 'https://www.linkedin.com/in/maya-gold-1',
      role: 'Product Manager',
      notes: 'scraped bio',
      company: 'Wiz',
      origin: 'company_scan',
    });

    const row = getPerson(id)!;
    assert.equal(row.role, 'Group PM', 'the role the user typed survives');
    assert.equal(row.notes, 'met at a meetup', 'the notes the user typed survive');
    assert.equal(row.works_company_id != null, true, 'but an empty column does get filled');
  });
});

describe('the introduction graph', () => {
  test('duplicate edges collapse, including when the introducer is a label', () => {
    const alon = upsertPerson({ full_name: 'Alon Root' }).id;
    const gil = upsertPerson({ full_name: 'Gil Target' }).id;

    assert.notEqual(addIntroduction({ fromPersonId: alon, toPersonId: gil }), null);
    assert.equal(
      addIntroduction({ fromPersonId: alon, toPersonId: gil }),
      null,
      'the same person-to-person edge twice is recorded once',
    );

    // The old schema's UNIQUE constraint did not dedupe these, because SQLite
    // treats each NULL as distinct. The COALESCE index is what fixes it.
    const first = addIntroduction({ sourceLabel: 'PM Community', toPersonId: alon });
    assert.notEqual(first, null);
    assert.equal(
      addIntroduction({ sourceLabel: 'PM Community', toPersonId: alon }),
      null,
      'a NULL from_person_id must still dedupe',
    );
  });

  test('an edge targets a person or a company, never both or neither', () => {
    const p = upsertPerson({ full_name: 'Edge Case' }).id;
    const companyId = db().prepare(`SELECT id FROM companies WHERE name_norm='wiz'`).get() as { id: number };

    assert.throws(() => addIntroduction({ fromPersonId: p }), /exactly one/);
    assert.throws(
      () => addIntroduction({ fromPersonId: p, toPersonId: p, toCompanyId: companyId.id }),
      /exactly one/,
    );
    assert.throws(() => addIntroduction({ fromPersonId: p, toPersonId: p }), /themselves/);
  });

  test('a profile shows who led me to them and who they led me to', () => {
    const rina = upsertPerson({ full_name: 'Rina Hub' }).id;
    const ari = upsertPerson({ full_name: 'Ari Downstream' }).id;
    const companyId = (db().prepare(`SELECT id FROM companies WHERE name_norm='snyk'`).get() as { id: number }).id;

    addIntroduction({ sourceLabel: 'Reichman alumni', toPersonId: rina });
    addIntroduction({ fromPersonId: rina, toPersonId: ari });
    addIntroduction({ fromPersonId: rina, toCompanyId: companyId });

    const { inbound, outbound } = introductionsFor(rina);
    assert.equal(inbound.length, 1);
    assert.equal(inbound[0].sourceLabel, 'Reichman alumni');
    assert.equal(outbound.length, 2, 'multiple outbound edges, people and companies together');
    assert.equal(outbound.filter((e) => e.personId != null).length, 1);
    assert.equal(outbound.filter((e) => e.companyId != null).length, 1);
    assert.equal(outbound.find((e) => e.companyId != null)!.companyName, 'Snyk');
  });

  test('circle is the hop distance from you, and shortens when a shorter path appears', () => {
    const a = upsertPerson({ full_name: 'Chain A' }).id;
    const b = upsertPerson({ full_name: 'Chain B' }).id;
    const c = upsertPerson({ full_name: 'Chain C' }).id;
    const d = upsertPerson({ full_name: 'Chain D' }).id;

    addIntroduction({ fromPersonId: a, toPersonId: b });
    addIntroduction({ fromPersonId: b, toPersonId: c });
    addIntroduction({ fromPersonId: c, toPersonId: d });

    assert.equal(getPerson(a)!.circle, 1, 'nobody introduced me to A, so I know them directly');
    assert.equal(getPerson(b)!.circle, 2);
    assert.equal(getPerson(c)!.circle, 3);
    assert.equal(getPerson(d)!.circle, 4);

    // A now introduces me to D directly: the long way round stops mattering.
    addIntroduction({ fromPersonId: a, toPersonId: d });
    assert.equal(getPerson(d)!.circle, 2, 'BFS takes the shortest chain');
    assert.equal(getPerson(c)!.circle, 3, 'unaffected people keep their distance');
  });

  test('a person reached only through an outside source is still circle 1', () => {
    const p = upsertPerson({ full_name: 'Community Contact' }).id;
    addIntroduction({ sourceLabel: 'Cyber PM Slack', toPersonId: p });
    assert.equal(getPerson(p)!.circle, 1);
  });
});

describe('the talk log', () => {
  test('logging a conversation records it and advances an untouched status', () => {
    const { id } = upsertPerson({ full_name: 'Talk Subject' });
    assert.equal(getPerson(id)!.status, 'new');

    logInteraction({ personId: id, channel: 'phone', whatISaid: 'asked about the PM opening', outcome: 'will forward my CV' });
    logInteraction({ personId: id, channel: 'linkedin', outcome: 'no reply yet' });

    const log = interactionsFor(id);
    assert.equal(log.length, 2);
    assert.equal(getPerson(id)!.status, 'talked');
  });

  test('logging does not overwrite a status the user chose deliberately', () => {
    const { id } = upsertPerson({ full_name: 'Closed Subject' });
    db().prepare(`UPDATE people SET status='dead_end' WHERE id=?`).run(id);
    logInteraction({ personId: id, outcome: 'one last try' });
    assert.equal(getPerson(id)!.status, 'dead_end');
  });
});

describe('the LinkedIn candidate pool', () => {
  test('promotion creates a person once and links the connection to them', () => {
    db()
      .prepare(
        `INSERT INTO connections (first_name, last_name, full_name, company, company_norm, position, linkedin_url, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('Omer', 'Katz', 'Omer Katz', 'Wiz', 'wiz', 'Engineer', 'https://www.linkedin.com/in/omer-katz-9', now());
    const connId = (db().prepare(`SELECT id FROM connections WHERE full_name='Omer Katz'`).get() as { id: number }).id;

    const personId = promoteConnection(connId);
    assert.notEqual(personId, null);
    assert.equal(
      (db().prepare('SELECT person_id FROM connections WHERE id=?').get(connId) as { person_id: number }).person_id,
      personId,
    );
    assert.equal(promoteConnection(connId), personId, 'promoting twice does not duplicate');
  });
});

describe('merge', () => {
  test('duplicates fold into one person, keeping edges and log', () => {
    const primary = upsertPerson({ full_name: 'Dup Primary', role: 'PM' }).id;
    const dup = upsertPerson({ full_name: 'Dup Secondary', company: 'Wiz', phone: '054-777-8888' }).id;
    const other = upsertPerson({ full_name: 'Dup Neighbour' }).id;

    addIntroduction({ fromPersonId: other, toPersonId: dup });
    logInteraction({ personId: dup, outcome: 'spoke at a conference' });

    mergePeople(primary, [dup]);

    assert.equal(getPerson(dup), null, 'the duplicate is gone');
    const merged = getPerson(primary)!;
    assert.equal(merged.role, 'PM', 'the primary keeps its own values');
    assert.equal(merged.phone, '+972547778888', 'and gains what only the duplicate had');
    assert.equal(interactionsFor(primary).length, 1, 'the log follows the person');
    assert.equal(introductionsFor(primary).inbound.length, 1, 'so do the edges');
  });
});

describe('name lookup', () => {
  test('findPersonByName is a convenience, and says so by returning one row', () => {
    upsertPerson({ full_name: 'Ambiguous Name', company: 'Wiz' });
    upsertPerson({ full_name: 'Ambiguous Name', company: 'Snyk' });
    const found = findPersonByName('ambiguous  NAME');
    assert.notEqual(found, null, 'normalizes case and whitespace');
  });

  test('Hebrew names survive normalization', () => {
    const { id } = upsertPerson({ full_name: 'יובל מונד' });
    assert.equal(findPersonByName('יובל  מונד'), id);
  });
});
