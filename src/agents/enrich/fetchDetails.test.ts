/**
 * Tests for the posting-detail pass. Runs against a throwaway database and a
 * fake fetcher, so it never touches data/output/job.db and never spends a
 * BrightData request.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'job-agent-details-'));
process.env.JOB_DB = join(dir, 'test.db');

const { initDb, db, now } = await import('../../db/client.js');
const { selectPostingsNeedingDetail, fetchPostingDetails } = await import('./fetchDetails.js');
const { BrightDataAuthError } = await import('../../brightdata/client.js');

await initDb();

db().prepare(`INSERT INTO companies (name, name_norm, status, created_at) VALUES (?, ?, 'tracked', ?)`)
  .run('Wiz', 'wiz', now());
const companyId = (db().prepare('SELECT id FROM companies WHERE name_norm = ?').get('wiz') as { id: number }).id;

const addPosition = (p: {
  title: string; url?: string | null; description?: string | null;
  isProduct?: number; closed?: boolean;
}): number => {
  const info = db()
    .prepare(
      `INSERT INTO positions (company_id, title, url, source, description, is_product, discovered_at, last_seen_at, closed_at)
       VALUES (?, ?, ?, 'test', ?, ?, ?, ?, ?)`,
    )
    .run(
      companyId, p.title, p.url ?? null, p.description ?? null,
      p.isProduct ?? 1, now(), now(), p.closed ? now() : null,
    );
  return Number(info.lastInsertRowid);
};

const needsDetail = addPosition({ title: 'Product Manager', url: 'https://example.com/pm' });
const alreadyHasText = addPosition({ title: 'Senior PM', url: 'https://example.com/spm', description: 'A long existing description.' });
const noLink = addPosition({ title: 'Group PM', url: null });
const notProduct = addPosition({ title: 'Backend Engineer', url: 'https://example.com/be', isProduct: 0 });
const closedRole = addPosition({ title: 'Product Lead', url: 'https://example.com/pl', closed: true });

const body = (chars: number) => `<html><body><p>${'x'.repeat(chars)}</p></body></html>`;

describe('choosing which postings to open', () => {
  test('takes only open product roles that have a link and no text yet', () => {
    const ids = selectPostingsNeedingDetail().map((p) => p.id);
    assert.deepEqual(ids, [needsDetail]);
    for (const [label, id] of [
      ['one that already has a description', alreadyHasText],
      ['one with no link to follow', noLink],
      ['a non-product role', notProduct],
      ['a role that has closed', closedRole],
    ] as const) {
      assert.equal(ids.includes(id), false, `should skip ${label}`);
    }
  });

  test('--all widens past product roles but keeps the other guards', () => {
    const ids = selectPostingsNeedingDetail({ all: true }).map((p) => p.id);
    assert.deepEqual(ids.sort(), [needsDetail, notProduct].sort());
  });
});

/**
 * Each fetching test starts from a clean slate. Without this a posting left
 * without a description by one test is still selectable by the next, and the
 * counts silently belong to two tests at once.
 */
const only = (rows: Parameters<typeof addPosition>[0][]): number[] => {
  db().prepare('DELETE FROM positions').run();
  return rows.map(addPosition);
};

describe('fetching posting text', () => {
  test('stores the body and leaves other columns alone', async () => {
    const [needsDetail] = only([{ title: 'Product Manager', url: 'https://example.com/pm' }]);
    const before = db().prepare('SELECT title FROM positions WHERE id = ?').get(needsDetail) as { title: string };
    const res = await fetchPostingDetails({ fetch: async () => body(500) });

    assert.equal(res.filled, 1);
    assert.equal(res.failed, 0);
    assert.equal(res.abortedOn, null);

    const row = db().prepare('SELECT title, description FROM positions WHERE id = ?').get(needsDetail) as
      { title: string; description: string };
    assert.equal(row.title, before.title, 'title must not be rewritten');
    assert.match(row.description, /x{400,}/);

    // Now that it has text it drops out of the selection, so a second run is free.
    assert.deepEqual(selectPostingsNeedingDetail(), []);
  });

  test('a cookie wall is counted as failed, not saved as a description', async () => {
    const [id] = only([{ title: 'PM, Platform', url: 'https://example.com/wall' }]);
    const res = await fetchPostingDetails({ fetch: async () => body(20) });

    assert.equal(res.filled, 0);
    assert.equal(res.failed, 1);
    const row = db().prepare('SELECT description FROM positions WHERE id = ?').get(id) as { description: string | null };
    assert.equal(row.description, null, 'a stub page must not become the description');
  });

  test('a transient failure is recorded without killing the pass', async () => {
    const [ok, bad] = only([
      { title: 'PM, Data', url: 'https://example.com/ok' },
      { title: 'PM, Cloud', url: 'https://example.com/bad' },
    ]);

    const res = await fetchPostingDetails({
      concurrency: 1,
      fetch: async (url) => {
        if (url.endsWith('/bad')) throw new Error('BrightData zone error: waiting for selector');
        return body(500);
      },
    });

    assert.equal(res.filled, 1, 'the healthy posting is still saved');
    assert.equal(res.failed, 1);
    assert.equal(res.abortedOn, null, 'a transient error must not abort the pass');
    const saved = db().prepare('SELECT description FROM positions WHERE id = ?').get(ok) as { description: string | null };
    assert.notEqual(saved.description, null);
    // The failed one keeps no description, so a later run retries it.
    const retried = db().prepare('SELECT description FROM positions WHERE id = ?').get(bad) as { description: string | null };
    assert.equal(retried.description, null);
  });

  test('an expired token stops the pass instead of burning every posting', async () => {
    only(['PM, Alpha', 'PM, Beta', 'PM, Gamma'].map((t) => ({ title: t, url: `https://example.com/${t}` })));

    let calls = 0;
    const res = await fetchPostingDetails({
      concurrency: 1,
      fetch: async () => {
        calls += 1;
        throw new BrightDataAuthError('BrightData 401: Token expired');
      },
    });

    assert.match(res.abortedOn ?? '', /Token expired/);
    assert.equal(calls, 1, 'must not keep calling once the token is known bad');
    assert.equal(res.failed, 0, 'an auth abort is not three failed postings');
  });
});
