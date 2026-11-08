/**
 * Tests for backfilling company websites. Runs against a throwaway database.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'job-agent-domains-'));
process.env.JOB_DB = join(dir, 'test.db');

const { initDb, db, now } = await import('../db/client.js');
const { backfillDomains, usableCompanyHost, DomainBackfillError } = await import('./domains.js');
const { normalizeCompany } = await import('../util/normalize.js');

await initDb();

const add = (name: string, website: string | null) =>
  db()
    .prepare(
      `INSERT INTO companies (name, name_norm, status, website_url, created_at) VALUES (?, ?, 'pending', ?, ?)`,
    )
    // normalizeCompany, not toLowerCase: it strips corporate suffixes ("Dry Co"
    // -> "dry"), so a fixture that lowercases instead silently fails to match.
    .run(name, normalizeCompany(name), website, now());

const siteOf = (name: string) =>
  (db().prepare('SELECT website_url FROM companies WHERE name = ?').get(name) as { website_url: string | null })
    .website_url;

describe('usableCompanyHost', () => {
  test('accepts a host that belongs to the company', () => {
    assert.equal(usableCompanyHost('https://www.acsense.com', 'Acsense'), true);
    assert.equal(usableCompanyHost('https://pentera.io', 'Pentera Security'), true);
  });

  test('refuses a search artefact or an aggregator', () => {
    // Every one of these is a real stored value.
    assert.equal(usableCompanyHost('https://www.google.com', 'Aidoc'), false);
    assert.equal(usableCompanyHost('https://www.pgcareers.com', 'Alma Lasers'), false);
    assert.equal(usableCompanyHost('https://wellfound.com', 'Augury'), false);
    assert.equal(usableCompanyHost('', 'Acme'), false);
  });
});

describe('backfillDomains', () => {
  test('fills empty columns, corrects wrong ones, and leaves good ones alone', () => {
    add('Acsense', null);
    add('Aidoc', 'https://www.google.com');
    add('Pentera Security', 'https://pentera.io');
    add('Augury', 'https://wellfound.com');

    const csv = join(dir, 'sources.csv');
    writeFileSync(
      csv,
      'List,Name,Source,Website\n' +
        'cyber,Acsense,techmap,https://acsense.com\n' +
        'health,Aidoc,techmap,https://www.aidoc.com\n' +
        'cyber,Pentera Security,techmap,https://pentera.io\n' +
        'cyber,Augury,techmap,https://www.augury.com\n' +
        'cyber,Nobody We Have,techmap,https://nobody.com\n' +
        'cyber,Acsense,techmap,https://not-acsense-at-all.net\n',
      'utf8',
    );

    const r = backfillDomains(csv);
    assert.equal(r.rows, 6);
    assert.equal(r.unmatched, 1, 'the company we do not have');
    assert.equal(r.filled, 1, 'Acsense had nothing');
    assert.equal(r.replaced, 2, 'Aidoc and Augury had hosts that were not theirs');
    assert.equal(r.kept, 1, 'Pentera already had its own domain');
    assert.equal(r.unusable, 1, 'the row offering an unrelated host for Acsense');

    assert.equal(siteOf('Acsense'), 'https://acsense.com');
    assert.equal(siteOf('Aidoc'), 'https://www.aidoc.com');
    assert.equal(siteOf('Augury'), 'https://www.augury.com');
    assert.equal(siteOf('Pentera Security'), 'https://pentera.io');
  });

  test('a dry run reports without writing', () => {
    add('Dry Co', null);
    const csv = join(dir, 'dry.csv');
    writeFileSync(csv, 'Name,Website\nDry Co,https://dryco.com\n', 'utf8');
    const r = backfillDomains(csv, { dryRun: true });
    assert.equal(r.filled, 1);
    assert.equal(siteOf('Dry Co'), null, 'nothing was written');
  });

  test('a CSV without the columns it needs fails loudly', () => {
    const bad = join(dir, 'bad.csv');
    writeFileSync(bad, 'Company,Domain\nFoo,bar.com\n', 'utf8');
    assert.throws(() => backfillDomains(bad), (err: unknown) => {
      assert.ok(err instanceof DomainBackfillError);
      assert.match((err as Error).message, /no "Name" column/);
      return true;
    });
  });
});
