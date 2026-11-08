/**
 * Tests for the company lifecycle: what gets parked, what the searcher then
 * skips, and what a hand decision protects. Runs against a throwaway database.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'job-agent-lifecycle-'));
process.env.JOB_DB = join(dir, 'test.db');

const { initDb, db, now } = await import('./client.js');
const {
  lifecycleFromRemovalReason, flagCompany, scanForNoWebPresence, seedFromRemovalCsv,
  listDormant, markLive, careersGap, syncLifecycleLists, dormantCounts, LifecycleError,
  domainVerdict, scanDeadDomains, scanAggregatorOnly, skipsCrawl, scanAcquisitions, markAcquired,
} = await import('./lifecycle.js');
const { dueCount } = await import('../agents/searcher/crawlRun.js');

await initDb();

db().prepare(`INSERT INTO company_lists (id, name, imported_at) VALUES (1, 'Test Sector', ?)`).run(now());

interface Add {
  name: string;
  website?: string | null;
  careers?: string | null;
  checked?: string | null;
  employees?: string;
}
const add = (p: Add): number => {
  const info = db()
    .prepare(
      `INSERT INTO companies (name, name_norm, metadata, status, website_url, careers_url,
                              last_checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.name,
      p.name.toLowerCase(),
      JSON.stringify({ Employees: p.employees ?? '11-50' }),
      p.checked ? 'checked' : 'pending',
      p.website ?? null,
      p.careers ?? null,
      p.checked ?? null,
      now(),
    );
  const id = Number(info.lastInsertRowid);
  db().prepare('INSERT INTO company_list_members (list_id, company_id) VALUES (1, ?)').run(id);
  return id;
};

describe('lifecycleFromRemovalReason', () => {
  test('maps the vetting reasons onto states', () => {
    assert.deepEqual(lifecycleFromRemovalReason('dead-domain'), {
      lifecycle: 'suspected_closed',
      reason: 'dead-domain',
    });
    assert.equal(lifecycleFromRemovalReason('closed')?.lifecycle, 'suspected_closed');
    assert.equal(lifecycleFromRemovalReason('likely-closed')?.lifecycle, 'suspected_closed');
  });

  test('a company that is not Israeli is out of scope, not closed', () => {
    // Filing "wrong country" under "closed" would make the skip list unauditable:
    // the two want opposite treatment if the search area ever changes.
    assert.equal(lifecycleFromRemovalReason('not-israeli/wrong-data')?.lifecycle, 'out_of_scope');
  });

  test('an unknown reason returns null rather than the nearest guess', () => {
    assert.equal(lifecycleFromRemovalReason('acquired by someone'), null);
    assert.equal(lifecycleFromRemovalReason(''), null);
  });
});

describe('scanForNoWebPresence', () => {
  test('parks a checked company with no website and no careers page', () => {
    const id = add({ name: 'Ghost Co', checked: now() });
    const r = scanForNoWebPresence();
    assert.equal(r.flagged, 1);
    const row = listDormant()[0];
    assert.equal(row.id, id);
    assert.equal(row.lifecycle, 'no_web_presence');
    assert.equal(row.lifecycle_reason, 'no-website-found');
    assert.match(String(row.lifecycle_evidence), /two SERP queries/);
  });

  test('leaves alone a company that has a website, or was never checked', () => {
    add({ name: 'Has Site', website: 'https://hassite.com', checked: now() });
    add({ name: 'Never Checked' });
    const r = scanForNoWebPresence();
    assert.equal(r.flagged, 0, 'nothing new should be parked');
    assert.deepEqual(listDormant().map((d) => d.name), ['Ghost Co']);
  });

  test('a hand decision outranks a later scan', () => {
    const id = add({ name: 'Stealth Mode', checked: now() });
    flagCompany({
      companyId: id,
      lifecycle: 'live',
      reason: 'manual',
      evidence: 'Spoke to the founder; they are hiring.',
      source: 'user',
    });
    // A company already ruled on is not even a candidate, so the scan has
    // nothing to decline — the protection is in the selection, not a retry.
    const r = scanForNoWebPresence();
    assert.equal(r.flagged, 0);
    assert.equal(r.candidates, 0);
    const row = db().prepare('SELECT lifecycle FROM companies WHERE id = ?').get(id) as { lifecycle: string };
    assert.equal(row.lifecycle, 'live', 'the scan must not overwrite what the user decided');
  });

  test('flagCompany itself refuses to overwrite a user decision', () => {
    const id = add({ name: 'User Ruled', checked: now() });
    flagCompany({ companyId: id, lifecycle: 'live', reason: 'manual', evidence: 'Verified.', source: 'user' });

    const accepted = flagCompany({
      companyId: id, lifecycle: 'suspected_closed', reason: 'dead-domain', evidence: 'NXDOMAIN',
    });
    assert.equal(accepted, false, 'an automatic write loses to a hand decision');
    const after = db().prepare('SELECT lifecycle FROM companies WHERE id = ?').get(id) as { lifecycle: string };
    assert.equal(after.lifecycle, 'live');

    // The user can still change their own mind.
    assert.equal(
      flagCompany({
        companyId: id, lifecycle: 'suspected_closed', reason: 'closed', evidence: 'Shut down.', source: 'user',
      }),
      true,
    );
  });

  test('flagging a company that does not exist is an error, not a silent no-op', () => {
    assert.throws(
      () => flagCompany({ companyId: 999_999, lifecycle: 'suspected_closed', reason: 'closed', evidence: 'x' }),
      LifecycleError,
    );
  });
});

describe('the searcher skips parked companies', () => {
  // A company is only "due" if it is also stale, so parking has to be tested
  // against one that would otherwise be picked up — a freshly-checked company
  // is excluded by the freshness window whatever its lifecycle says.
  //
  // Created inside the tests, not in the describe body: every describe body in
  // a file runs before the first test does, so a fixture declared out here
  // would already exist while the earlier suites were still asserting.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();

  test('dueCount excludes a parked company, and --include-dormant brings it back', () => {
    const staleParked = add({ name: 'Stale And Dead', website: 'https://dead.com', checked: sixtyDaysAgo });
    const before = dueCount([1], false, false);
    flagCompany({
      companyId: staleParked, lifecycle: 'suspected_closed', reason: 'dead-domain', evidence: 'NXDOMAIN',
    });
    const after = dueCount([1], false, false);
    assert.equal(after, before - 1, 'parking a due company takes it out of the queue');
    assert.equal(dueCount([1], false, true), before, '--include-dormant puts it back');
  });

  test('a company confirmed live is still crawled', () => {
    const staleLive = add({ name: 'Stale And Fine', website: 'https://fine.com', checked: sixtyDaysAgo });
    flagCompany({
      companyId: staleLive, lifecycle: 'live', reason: 'manual', evidence: 'Verified by hand.', source: 'user',
    });
    const rows = db()
      .prepare(
        `SELECT COUNT(*) c FROM companies
          WHERE (lifecycle IS NULL OR lifecycle = 'live') AND id = ?`,
      )
      .get(staleLive) as { c: number };
    assert.equal(rows.c, 1, "'live' is a flag that does not skip");
  });

  test('a company flagged for review is still crawled', () => {
    // The distinction this protects cost real money once: flagging every state
    // as a skip took Augury — hundreds of employees, visibly hiring — out of
    // the crawl because the only host ever returned for it was a job board.
    // "We could not find their site" is a claim about our search, not the company.
    const id = add({ name: 'Opaque But Alive', website: 'https://wellfound.com', checked: sixtyDaysAgo });
    const before = dueCount([1], false, false);
    flagCompany({
      companyId: id, lifecycle: 'no_web_presence', reason: 'aggregator-only',
      evidence: 'Only host on file is a job board.',
    });
    assert.equal(dueCount([1], false, false), before, 'a review flag must not change the queue');
    assert.equal(skipsCrawl('no_web_presence'), false);
    assert.equal(skipsCrawl('suspected_closed'), true);
    assert.equal(skipsCrawl('out_of_scope'), true);
    assert.equal(skipsCrawl(null), false);
  });

  test('force does not imply spending on dead companies', () => {
    assert.ok(
      dueCount([1], true, false) < dueCount([1], true, true),
      'ignoring the freshness window is not the same as paying for dead domains',
    );
  });
});

describe('seedFromRemovalCsv', () => {
  test('inserts companies that were never imported, and reports unknown reasons', () => {
    const csv = join(dir, 'removed.csv');
    writeFileSync(
      csv,
      'List,Name,Reason,Evidence\n' +
        'Energy Tech,Defunct Energy,dead-domain,NXDOMAIN since 2024\n' +
        'Energy Tech,Foreign Co,not-israeli/wrong-data,HQ in Berlin\n' +
        'Energy Tech,Mystery Co,who-knows,\n',
      'utf8',
    );
    const before = dormantCounts();
    const r = seedFromRemovalCsv(csv);
    assert.equal(r.rows, 3);
    assert.equal(r.flagged, 2);
    assert.equal(r.inserted, 2, 'both mapped companies were new to the database');
    assert.deepEqual(r.unmapped, [{ name: 'Mystery Co', reason: 'who-knows' }]);

    // Deltas, not absolutes: this suite shares one database with the others.
    const after = dormantCounts();
    assert.equal((after.suspected_closed ?? 0) - (before.suspected_closed ?? 0), 1);
    assert.equal((after.out_of_scope ?? 0) - (before.out_of_scope ?? 0), 1);

    const mystery = db().prepare(`SELECT lifecycle FROM companies WHERE name = 'Mystery Co'`).get();
    assert.equal(mystery, undefined, 'a row with an unmapped reason is not invented');
  });

  test('a CSV without the columns it needs fails loudly', () => {
    const bad = join(dir, 'bad.csv');
    writeFileSync(bad, 'Company,Note\nFoo,bar\n', 'utf8');
    assert.throws(() => seedFromRemovalCsv(bad), (err: unknown) => {
      assert.ok(err instanceof LifecycleError);
      assert.match((err as Error).message, /no "Name" column/);
      return true;
    });
  });
});

describe('domainVerdict', () => {
  test('one resolving lookup beats any number of failures', () => {
    assert.equal(domainVerdict([null]), 'alive');
    assert.equal(domainVerdict(['ETIMEOUT', null]), 'alive');
  });

  test('unanimous NXDOMAIN is the only way to be ruled dead', () => {
    assert.equal(domainVerdict(['ENOTFOUND', 'ENOTFOUND']), 'dead');
    assert.equal(domainVerdict(['NXDOMAIN', 'ENODATA']), 'dead');
  });

  test('a flaky resolver is inconclusive, never dead', () => {
    // Parking a live company on a timeout is silent and expensive: it stops
    // being crawled and nothing on the row explains why.
    assert.equal(domainVerdict(['ETIMEOUT', 'ETIMEOUT']), 'unknown');
    assert.equal(domainVerdict(['ESERVFAIL', 'ENOTFOUND']), 'unknown');
    assert.equal(domainVerdict([]), 'unknown');
  });
});

describe('scanDeadDomains', () => {
  test('parks only the hosts that consistently do not resolve', async () => {
    add({ name: 'Dead Domain Co', website: 'https://gone.example', checked: now() });
    add({ name: 'Live Domain Co', website: 'https://here.example', checked: now() });
    add({ name: 'Flaky Domain Co', website: 'https://flaky.example', checked: now() });

    const lookup = async (host: string) => {
      if (host === 'gone.example') return 'ENOTFOUND';
      if (host === 'flaky.example') return 'ETIMEOUT';
      return null;
    };
    const r = await scanDeadDomains({ lookup, attempts: 2 });
    assert.equal(r.dead, 1);
    assert.equal(r.unknown, 1);
    assert.ok(r.alive >= 1);

    const state = (name: string) =>
      (db().prepare('SELECT lifecycle FROM companies WHERE name = ?').get(name) as { lifecycle: string | null })
        .lifecycle;
    assert.equal(state('Dead Domain Co'), 'suspected_closed');
    assert.equal(state('Flaky Domain Co'), null, 'a timeout must not park a company');
    assert.equal(state('Live Domain Co'), null);
  });

  test("an aggregator host is not evidence about the company's own domain", async () => {
    const id = add({ name: 'Wellfound Only Co', website: 'https://wellfound.com', checked: now() });
    const asked: string[] = [];
    await scanDeadDomains({
      lookup: async (host) => {
        asked.push(host);
        return 'ENOTFOUND';
      },
    });
    assert.ok(asked.length > 0, 'other candidates were still checked');
    assert.ok(
      !asked.includes('wellfound.com'),
      'a job-board host is skipped before any lookup, so its DNS answer can never park a company',
    );
    const row = db().prepare('SELECT lifecycle FROM companies WHERE id = ?').get(id) as { lifecycle: string | null };
    assert.equal(row.lifecycle, null);
  });
});

describe('scanAggregatorOnly', () => {
  test('parks a company known only by somebody else’s job board, as needing a check', () => {
    const r = scanAggregatorOnly();
    assert.equal(r.flagged, 1);
    const row = db()
      .prepare(`SELECT lifecycle, lifecycle_reason, lifecycle_evidence FROM companies WHERE name = 'Wellfound Only Co'`)
      .get() as { lifecycle: string; lifecycle_reason: string; lifecycle_evidence: string };
    assert.equal(row.lifecycle, 'no_web_presence', 'not found is not the same as closed');
    assert.equal(row.lifecycle_reason, 'aggregator-only');
    assert.match(row.lifecycle_evidence, /wellfound\.com/);
  });

  test('such a company is not offered as a careers page to go and read', () => {
    assert.ok(!careersGap().some((r) => r.name === 'Wellfound Only Co'));
  });
});

describe('markLive', () => {
  test('puts a parked company back in the queue and clears the careers backoff', () => {
    const id = add({ name: 'Back From The Dead', checked: now() });
    db()
      .prepare('UPDATE companies SET careers_unresolved_at = ? WHERE id = ?')
      .run(now(), id);
    flagCompany({ companyId: id, lifecycle: 'suspected_closed', reason: 'dead-domain', evidence: 'NXDOMAIN' });

    const row = markLive('Back From The Dead', 'Site is up again; new domain.');
    assert.ok(row, 'the company is found by normalized name');
    const after = db()
      .prepare('SELECT lifecycle, lifecycle_source, careers_unresolved_at FROM companies WHERE id = ?')
      .get(id) as { lifecycle: string; lifecycle_source: string; careers_unresolved_at: string | null };
    assert.equal(after.lifecycle, 'live');
    assert.equal(after.lifecycle_source, 'user');
    assert.equal(after.careers_unresolved_at, null, 'checking by hand must re-queue it');
  });

  test('returns null for a company nobody has heard of', () => {
    assert.equal(markLive('No Such Company At All', 'n/a'), null);
  });
});

describe('careersGap', () => {
  test('lists real companies whose careers page was never found, biggest first', () => {
    add({ name: 'Big Opaque', website: 'https://bigopaque.com', checked: now(), employees: '500+' });
    add({ name: 'Small Opaque', website: 'https://smallopaque.com', checked: now(), employees: '1-10' });
    add({ name: 'Resolved Co', website: 'https://resolved.com', careers: 'https://resolved.com/careers', checked: now() });

    const rows = careersGap();
    const names = rows.map((r) => r.name);
    assert.ok(names.includes('Big Opaque'));
    assert.ok(names.includes('Small Opaque'));
    assert.ok(!names.includes('Resolved Co'), 'a company with a careers page is not a gap');
    assert.ok(!names.includes('Ghost Co'), 'a parked company is not a manual-dive candidate');
    assert.equal(names[0], 'Big Opaque', 'ordered by headcount');

    const big = careersGap({ minEmployees: true }).map((r) => r.name);
    assert.ok(big.includes('Big Opaque'));
    assert.ok(!big.includes('Small Opaque'));
  });
});

describe('syncLifecycleLists', () => {
  test('derives a browsable list per state, matching the column it is built from', () => {
    const lists = syncLifecycleLists();
    const counts = dormantCounts();
    assert.equal(lists['⚠ Suspected closed'], counts.suspected_closed);
    assert.equal(lists['⚠ No website found'], counts.no_web_presence);
    assert.equal(lists['⚠ Out of scope (not Israeli)'], counts.out_of_scope);
    assert.ok(counts.suspected_closed > 0, 'the fixtures did park something');
  });

  test('a revived company leaves the list on the next sync', () => {
    // Otherwise a stale member sits in the skip list forever and the user
    // trips over a company they already cleared.
    const before = syncLifecycleLists()['⚠ Suspected closed'];
    markLive('Defunct Energy', 'Confirmed trading again.');
    assert.equal(syncLifecycleLists()['⚠ Suspected closed'], before - 1);
  });
});

describe('acquired companies', () => {
  const page = (title: string) => `<html><head><title>${title}</title></head><body><p>Content here, enough of it.</p></body></html>`;

  test('an acquired company is skipped but not called closed', async () => {
    const id = add({ name: 'Votiro Cybersec', website: 'https://votiro.example', checked: now() });
    // URL-aware: other fixtures in this file are also unflagged candidates, and
    // a stub that served the same page to all of them would flag the lot.
    const r = await scanAcquisitions({
      fetch: async (url) =>
        url.includes('votiro') ? page('Life at Menlo - Careers | Menlo Security') : page('Careers'),
    });
    assert.equal(r.flagged, 1);
    const row = db()
      .prepare('SELECT lifecycle, lifecycle_reason, lifecycle_successor FROM companies WHERE id = ?')
      .get(id) as { lifecycle: string; lifecycle_reason: string; lifecycle_successor: string };
    assert.equal(row.lifecycle, 'acquired', 'its own state, not suspected_closed');
    assert.equal(row.lifecycle_reason, 'brand-mismatch');
    assert.equal(row.lifecycle_successor, 'Menlo Security', 'it records where the jobs went');
    assert.equal(skipsCrawl('acquired'), true, 'crawling it would file the buyer’s roles under this name');
  });

  test('a page that names nobody is left alone', async () => {
    add({ name: 'Ambiguous Co', website: 'https://ambiguous.example', checked: now() });
    const r = await scanAcquisitions({ fetch: async () => page('Careers') });
    // Nothing is claimed from a page that names no organisation at all.
    assert.equal(r.flagged, 0);
    assert.ok(r.inconclusive >= 1, 'reported as inconclusive rather than guessed at');
  });

  test('a failed fetch is not evidence of anything', async () => {
    add({ name: 'Unreachable Co', website: 'https://unreachable.example', checked: now() });
    const r = await scanAcquisitions({
      fetch: async (url) => {
        if (url.includes('unreachable')) throw new Error('timeout');
        return page('Careers');
      },
    });
    assert.equal(r.flagged, 0);
    const row = db()
      .prepare(`SELECT lifecycle FROM companies WHERE name = 'Unreachable Co'`)
      .get() as { lifecycle: string | null };
    assert.equal(row.lifecycle, null);
  });

  test('markAcquired records the buyer and resists later scans', () => {
    const id = add({ name: 'Laminar Labs', website: 'https://laminar.example', checked: now() });
    const row = markAcquired('Laminar Labs', 'Rubrik');
    assert.ok(row);
    assert.equal(row!.lifecycle_successor, 'Rubrik');
    assert.equal(row!.lifecycle_source, 'user');
    // An automatic write must lose to it.
    assert.equal(
      flagCompany({ companyId: id, lifecycle: 'suspected_closed', reason: 'dead-domain', evidence: 'x' }),
      false,
    );
  });

  test('a vetting CSV can say "acquired" directly', () => {
    assert.deepEqual(lifecycleFromRemovalReason('acquired'), { lifecycle: 'acquired', reason: 'acquired' });
    assert.equal(lifecycleFromRemovalReason('merged')?.lifecycle, 'acquired');
  });

  test('it gets its own browsable list', () => {
    const lists = syncLifecycleLists();
    assert.ok((lists['→ Acquired (jobs moved to the buyer)'] ?? 0) >= 2);
  });
});
