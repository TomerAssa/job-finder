/**
 * Tests for backing off companies with no findable careers page. Runs against a
 * throwaway database.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'job-agent-backoff-'));
process.env.JOB_DB = join(dir, 'test.db');

const { initDb, db, now } = await import('../../db/client.js');
const { unresolvedBackoffClause } = await import('./index.js');
const { dueCount } = await import('./crawlRun.js');
const { config } = await import('../../config.js');

await initDb();

db().prepare(`INSERT INTO company_lists (id, name, imported_at) VALUES (1, 'Test Sector', ?)`).run(now());

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const add = (p: { name: string; careersUrl?: string | null; checked?: string | null; unresolved?: string | null }) => {
  const info = db()
    .prepare(
      `INSERT INTO companies (name, name_norm, status, careers_url, last_checked_at, careers_unresolved_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.name, p.name.toLowerCase(), p.checked ? 'checked' : 'pending',
      p.careersUrl ?? null, p.checked ?? null, p.unresolved ?? null, now(),
    );
  const id = Number(info.lastInsertRowid);
  db().prepare(`INSERT INTO company_list_members (list_id, company_id) VALUES (1, ?)`).run(id);
  return id;
};

// Stale enough that checkTtlDays alone would select every one of these.
const stale = daysAgo(config.checkTtlDays + 30);

const resolved = add({ name: 'HasPage', careersUrl: 'https://haspage.com/careers', checked: stale });
const freshlyFailed = add({ name: 'NoPageRecent', checked: stale, unresolved: daysAgo(3) });
const longAgoFailed = add({ name: 'NoPageAncient', checked: stale, unresolved: daysAgo(config.unresolvedTtlDays + 5) });
const neverTried = add({ name: 'NeverChecked' });

const selectable = (): number[] =>
  (db()
    .prepare(`SELECT id FROM companies WHERE ${unresolvedBackoffClause()} ORDER BY id`)
    .all() as { id: number }[]).map((r) => r.id);

describe('backing off companies with no careers page', () => {
  test('skips one whose search recently came up empty', () => {
    assert.equal(selectable().includes(freshlyFailed), false);
  });

  test('still visits a company that has a careers page', () => {
    // The backoff must key on the failure stamp, not on staleness in general.
    assert.equal(selectable().includes(resolved), true);
  });

  test('retries once the backoff window has passed', () => {
    assert.equal(selectable().includes(longAgoFailed), true);
  });

  test('never holds back a company that was never tried', () => {
    assert.equal(selectable().includes(neverTried), true);
  });

  test('the progress target excludes what the run will skip', () => {
    // dueCount feeds the progress bar. If it counted the skipped company the
    // bar would stop short of its own total and look stalled.
    assert.equal(dueCount([1]), 3);
    assert.equal(dueCount([1], true), 4, '--force ignores the backoff');
  });

  test('finding a page later clears the stamp', () => {
    db()
      .prepare(
        `UPDATE companies SET careers_url = ?, careers_unresolved_at =
           CASE WHEN COALESCE(?, '') = '' THEN ? ELSE NULL END WHERE id = ?`,
      )
      .run('https://nopagerecent.com/jobs', 'https://nopagerecent.com/jobs', now(), freshlyFailed);
    assert.equal(selectable().includes(freshlyFailed), true, 'a company that just published a page must come back');
  });
});
