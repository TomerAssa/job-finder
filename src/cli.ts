#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Command } from 'commander';
import { paths, config } from './config.js';
import { db, initDb } from './db/client.js';
import { closeRedis } from './redis.js';
import { ingestConnections } from './ingest/connections.js';
import { ingestCompanyList, listSectors } from './ingest/companyLists.js';
import {
  careersGap, listDormant, markAcquired, markLive, scanAcquisitions, scanAggregatorOnly,
  scanDeadDomains, scanForNoWebPresence, seedFromRemovalCsv, skipsCrawl, syncLifecycleLists,
} from './db/lifecycle.js';
import { fetchPage } from './brightdata/unlocker.js';
import { writeCsv } from './util/csv.js';
import { backfillDomains } from './ingest/domains.js';
import { runSearcher, resetNoPmCompanies } from './agents/searcher/index.js';
import { reclassifyPositions } from './agents/searcher/reclassify.js';
import { startRun, getRun } from './agents/searcher/crawlRun.js';
import { runHotApproach } from './agents/hotApproach/index.js';
import { runEnrich } from './agents/enrich/index.js';
import { fetchPostingDetails, selectPostingsNeedingDetail } from './agents/enrich/fetchDetails.js';
import { runImportTracker } from './agents/import/tracker.js';
import { findPeople } from './agents/people/index.js';
import { exportNewPositions } from './agents/export/newXlsx.js';
import { generateReports } from './report/generate.js';
import { runDoctor } from './doctor.js';
import { seedDemo, purgeDemo, demoStatus } from './demo/seed.js';


/**
 * Resolve `--sector` to company-list ids.
 *
 * Several list names contain a comma ("Aerospace, Defense & HLS"), so splitting
 * on commas first would tear them in half. The whole string is tried as one name
 * before it is treated as a list of them.
 */
function resolveSectors(raw: string): number[] {
  const all = listSectors();
  const byName = (w: string) =>
    all.find((l) => l.name.toLowerCase() === w.trim().toLowerCase() || String(l.id) === w.trim());

  const whole = byName(raw);
  if (whole) return [whole.id];

  return raw.split(',').map((w) => {
    const hit = byName(w);
    if (!hit) {
      throw new Error(`No company list called "${w.trim()}". Known: ${all.map((l) => l.name).join(' | ')}`);
    }
    return hit.id;
  });
}

const program = new Command();
program.name('job').description('A league of agents that finds you a job.');

// Every command needs a current schema, so migrations run before any of them.
// `db()` throws if migrations are outstanding, which keeps a stale schema from
// failing one query at a time somewhere deep in an agent.
program.hook('preAction', async () => {
  const applied = await initDb();
  if (applied.length) console.log(`🗃️  Applied ${applied.length} migration(s): ${applied.join(', ')}`);
});

// ── migrate ──
program
  .command('migrate')
  .description('Apply pending database migrations (runs automatically before every command).')
  .action(() => {
    console.log('✅ Database schema is up to date.');
  });

// ── demo ──
program
  .command('seed-demo')
  .description('Fill an empty database with clearly-invented sample data.')
  .option('--force', 'seed even though the database already holds real data', false)
  .action((o) => {
    db();
    const r = seedDemo({ force: o.force });
    console.log(`🌱 Demo data: ${r.companies} companies, ${r.positions} positions, ${r.people} people.`);
    console.log('   Every row is flagged as demo. Finish setup, or run `npm run job purge-demo`, to clear it.');
  });

program
  .command('purge-demo')
  .description('Delete every demo row. Nothing real is touched.')
  .action(() => {
    db();
    const r = purgeDemo();
    console.log(`🧹 Removed ${r.people} people, ${r.positions} positions, ${r.companies} companies.`);
  });

// ── doctor ──
program
  .command('doctor')
  .description('Check BrightData (SERP + Unlocker), Redis, and LLM connectivity.')
  .action(() => runDoctor());

// ── ingest ──
program
  .command('ingest')
  .description('Load a companies CSV and your LinkedIn connections into the database.')
  .option('--companies <path>', 'Israel Startup Finder export', paths.companiesCsv)
  .option('--connections <path>', 'LinkedIn Connections.csv', paths.connectionsCsv)
  .action(async (o) => {
    db(); // ensure schema exists
    if (existsSync(o.companies)) {
      // Routed through the list ingest so every company belongs to a named list;
      // otherwise it exists but no sector search can ever reach it.
      const r = ingestCompanyList(o.companies);
      console.log(`🏢 ${r.list}: +${r.newCompanies} new companies (${r.companiesInFile} rows)`);
    } else console.warn(`⚠️  Companies CSV not found: ${o.companies}`);

    if (existsSync(o.connections)) {
      const r = ingestConnections(o.connections);
      console.log(`👥 Connections: +${r.inserted} new (${r.total} total)`);
    } else console.warn(`⚠️  Connections CSV not found: ${o.connections} (skip warm intros for now)`);
  });

// ── ingest-list ──
program
  .command('ingest-list')
  .description('Load a company-list CSV as a named, searchable sector.')
  .argument('<files...>', 'one or more "Companies List …" CSV exports')
  .option('--name <name>', 'override the list name (only valid with a single file)')
  .action((files: string[], o) => {
    db();
    if (o.name && files.length > 1) throw new Error('--name only works with a single file');
    for (const file of files) {
      if (!existsSync(file)) { console.warn(`⚠️  Not found: ${file}`); continue; }
      const r = ingestCompanyList(file, o.name);
      console.log(`📋 ${r.list}: ${r.companiesInFile} rows · +${r.newCompanies} new companies · ${r.linked} linked`);
    }
    for (const s of listSectors()) {
      console.log(
        `   ${s.name.padEnd(34)} ${String(s.companies).padStart(4)} companies · ` +
          `${String(s.visited).padStart(4)} visited · ${s.withPositions} with roles`,
      );
    }
  });

// ── search ──
program
  .command('search')
  .description('Find open positions for each company (SERP → careers/ATS → parse).')
  .option('--limit <n>', 'process at most N companies', (v) => parseInt(v, 10))
  .option('--sector <names>', 'restrict to these company lists (comma-separated, or ids)')
  .option('--force', 'ignore freshness cache and re-check everything', false)
  .option('--include-dormant', 'also visit companies parked as closed / no web presence', false)
  .action((o) => {
    let listIds: number[] | undefined;
    if (o.sector) {
      listIds = resolveSectors(String(o.sector));
      const scope = listSectors().filter((l) => listIds!.includes(l.id));
      console.log(`🔎 Scope: ${scope.map((l) => `${l.name} (${l.companies})`).join(' | ')}`);
    }
    return runSearcher({
      limit: o.limit, force: o.force, listIds, includeDormant: o.includeDormant,
    }).then(() => undefined);
  });

// ── crawl (long background-style run, also usable headless) ──
program
  .command('crawl')
  .description('Run a long search over one or more sectors, reporting progress.')
  .requiredOption('--sector <names>', 'comma-separated company lists')
  .option('--companies <n>', 'stop after this many companies', (v) => parseInt(v, 10))
  .option('--credits <n>', 'stop once this many credits are spent', (v) => parseInt(v, 10))
  .option('--force', 're-check even recently-checked companies', false)
  .option('--include-dormant', 'also visit companies parked as closed / no web presence', false)
  .action(async (o) => {
    db();
    const ids = resolveSectors(String(o.sector));
    const run = startRun({
      sectors: ids,
      targetCompanies: o.companies ?? null,
      creditLimit: o.credits ?? null,
      force: o.force,
      includeDormant: o.includeDormant,
    });
    console.log(`▶ run ${run.id}: up to ${run.companies_total} companies`);
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = getRun(run.id)!;
      console.log(
        `   ${r.status} ${r.companies_done}/${r.companies_total} · +${r.roles_added} roles · ` +
          `+${r.positions_added} positions · ${r.credits_used} credits`,
      );
      if (r.status !== 'running') break;
    }
  });

// ── prune ──
program
  .command('prune')
  .description('Delete stored positions that enrichment placed outside your search area.')
  .option('--dry-run', 'report what would go without deleting', false)
  .option(
    '--include-tracked',
    'also delete postings you have recorded a status or outreach against (they are kept by default)',
    false,
  )
  .action((o) => {
    const handle = db();
    // Anything you typed outranks anything a scraper found, and a status is the
    // most expensive thing in this database to recreate: it is the only record
    // that you applied. A rejected Germany role is still the fact that you were
    // rejected. So a posting carrying your own status or outreach survives the
    // prune unless you explicitly ask otherwise.
    const yours = `(id IN (SELECT position_id FROM role_tracking WHERE position_id IS NOT NULL)
                    OR id IN (SELECT position_id FROM outreach WHERE position_id IS NOT NULL))`;
    const where = `id IN (SELECT position_id FROM position_requirements WHERE is_israel = 0)`
      + (o.includeTracked ? '' : ` AND NOT ${yours}`);
    const count = (sql: string) => (handle.prepare(sql).get() as { c: number }).c;

    const total = count(`SELECT COUNT(*) c FROM positions WHERE ${where}`);
    const tracked = count(
      `SELECT COUNT(*) c FROM role_tracking WHERE position_id IN (SELECT id FROM positions WHERE ${where})`,
    );
    const reached = count(
      `SELECT COUNT(*) c FROM outreach WHERE position_id IN (SELECT id FROM positions WHERE ${where})`,
    );
    // Said even on a dry run: the whole point is that these are not going.
    const kept = o.includeTracked
      ? 0
      : count(
          `SELECT COUNT(*) c FROM positions
            WHERE id IN (SELECT position_id FROM position_requirements WHERE is_israel = 0) AND ${yours}`,
        );

    if (!config.defaultLocation) {
      console.log('No DEFAULT_LOCATION set, so nothing counts as outside your search area.');
      return;
    }
    console.log(`${o.dryRun ? '🔍 Would delete' : '🧹 Deleting'} ${total} positions outside ${config.defaultLocation}` +
      `${tracked ? `, ${tracked} carrying a status` : ''}${reached ? `, ${reached} with outreach recorded` : ''}.`);
    if (kept) {
      console.log(`   keeping ${kept} outside ${config.defaultLocation} that carry your own status or ` +
        `outreach — pass --include-tracked to delete those too.`);
    }
    if (o.dryRun) return;

    const info = handle.prepare(`DELETE FROM positions WHERE ${where}`).run();
    console.log(`   removed ${info.changes}. Re-crawls will not bring them back: postings that ` +
      `state a location outside ${config.defaultLocation} are no longer stored.`);
  });

// ── reclassify ──
program
  .command('reclassify')
  .description('Re-apply the target-role rules to positions already scraped.')
  .option('--titles <list>', 'comma-separated title keywords (default: the product-manager profile)')
  .option('--dry-run', 'report what would change without writing', false)
  .action((o) => {
    db();
    const matcher = o.titles
      ? { include: String(o.titles).split(',').map((t: string) => t.trim()).filter(Boolean) }
      : undefined;
    const r = reclassifyPositions(matcher as never, { dryRun: o.dryRun });
    console.log(`${o.dryRun ? '🔍 Would change' : '✅ Reclassified'} ${r.scanned} positions: +${r.added} / -${r.removed} → ${r.nowMatching} matching`);
    if (r.addedExamples.length) console.log(`   now matching: ${r.addedExamples.join(' · ')}`);
    if (r.removedExamples.length) console.log(`   dropped:      ${r.removedExamples.join(' · ')}`);
  });

// ── backfill-domains ──
program
  .command('backfill-domains')
  .description("Fill companies.website_url from a source CSV's real websites (free; no requests).")
  .argument('[csv]', 'CSV with Name and Website columns', 'data/input/expansion-sources.csv')
  .option('--dry-run', 'report what would change without writing', false)
  .action((csvArg, o) => {
    db();
    const path = resolve(csvArg);
    if (!existsSync(path)) throw new Error(`No CSV at ${path}.`);
    const r = backfillDomains(path, { dryRun: o.dryRun });
    console.log(
      `🌐 ${basename(path)}: ${r.rows} rows, ${r.matched} matched a known company\n` +
        `   ${o.dryRun ? 'would fill' : 'filled'} ${r.filled} empty · ` +
        `${o.dryRun ? 'would correct' : 'corrected'} ${r.replaced} that were not the company's · ` +
        `${r.kept} already right · ${r.unusable} CSV rows had no usable host · ${r.unmatched} unknown companies`,
    );
    for (const e of r.examples) console.log(`      ${e.name}: ${e.from} → ${e.to}`);
  });

// ── dormant (the skip lists: closed / no web presence / out of scope) ──
program
  .command('dormant')
  .description('Review and maintain the companies a crawl should skip or you should check by hand.')
  .option('--scan', 'flag companies a crawl found no website or careers page for', false)
  .option('--dns', 'park companies whose own domain no longer resolves (free; no credits)', false)
  .option('--aggregators', 'flag companies known only by somebody else\'s job board', false)
  .option('--attempts <n>', 'DNS lookups per host before ruling it dead', (v) => parseInt(v, 10), 2)
  .option('--limit <n>', 'check at most N hosts (with --dns)', (v) => parseInt(v, 10))
  .option('--seed [csv]', 'import a vetting CSV of removed companies (List,Name,Reason,Evidence)')
  .option('--mark-live <name>', 'a manual check found this company alive — put it back in the queue')
  .option('--acquired', 'detect companies whose own site now serves another brand (billable)', false)
  .option('--include-closed', 'with --acquired, re-examine companies already parked as closed', false)
  .option('--mark-acquired <name>', 'record an acquisition by hand (needs --by)')
  .option('--by <acquirer>', 'who acquired it (with --mark-acquired)')
  .option('--evidence <text>', 'what the manual check saw (stored with --mark-live)')
  .option('--state <state>', 'show only one state: suspected_closed | no_web_presence | out_of_scope')
  .option('--csv <path>', 'write the list to a CSV')
  .option('--dry-run', 'report what would change without writing', false)
  .action(async (o) => {
    db();

    if (o.markLive) {
      const row = markLive(String(o.markLive), String(o.evidence ?? 'Checked by hand; the company exists.'));
      if (!row) {
        throw new Error(
          `No company called "${o.markLive}". Names are matched after normalization — ` +
            `run \`job dormant\` to see the parked ones exactly as they are stored.`,
        );
      }
      console.log(`✅ ${row.name} marked live by hand — it will be crawled again and no scan can park it.`);
    }

    if (o.markAcquired) {
      if (!o.by) throw new Error('--mark-acquired needs --by <acquirer>: the point of the flag is where the jobs went.');
      const row = markAcquired(String(o.markAcquired), String(o.by), o.evidence ? String(o.evidence) : undefined);
      if (!row) throw new Error(`No company called "${o.markAcquired}".`);
      console.log(`→ ${row.name} recorded as acquired by ${row.lifecycle_successor}. It will not be crawled or shown as closed.`);
    }

    if (o.acquired) {
      const r = await scanAcquisitions({
        fetch: (url) => fetchPage(url, { timeoutMs: config.brightData.probeTimeoutMs }),
        limit: o.limit,
        dryRun: o.dryRun,
        includeClosed: o.includeClosed,
      });
      console.log(
        `→ Checked ${r.checked} site(s): ${o.dryRun ? 'would flag' : 'flagged'} ${r.flagged} as acquired · ` +
          `${r.inconclusive} named nobody, so nothing was concluded · ` +
          `${r.skippedUnverifiedHost} skipped (stored host is not demonstrably theirs)`,
      );
      if (r.keptUserDecision) console.log(`   ${r.keptUserDecision} left alone — you had already ruled on them`);
      for (const f of r.found) console.log(`      ${f.name} → ${f.successor}`);
    }

    if (o.seed !== undefined) {
      const path = typeof o.seed === 'string' ? o.seed : resolve(paths.inputDir, 'expansion-removed.csv');
      if (!existsSync(path)) throw new Error(`No vetting CSV at ${path}.`);
      const r = seedFromRemovalCsv(path, { dryRun: o.dryRun });
      console.log(
        `${o.dryRun ? '🔍 Would park' : '🅿️  Parked'} ${r.flagged} of ${r.rows} rows from ${basename(path)} ` +
          `(${r.inserted} not previously in the database)`,
      );
      if (r.keptUserDecision) console.log(`   ${r.keptUserDecision} left alone — you had already ruled on them`);
      if (r.unmapped.length) {
        console.log(`   ⚠️  ${r.unmapped.length} row(s) with a reason this does not know, so left unparked:`);
        for (const u of r.unmapped.slice(0, 10)) console.log(`      ${u.name} — "${u.reason}"`);
      }
    }

    if (o.scan) {
      const r = scanForNoWebPresence({ dryRun: o.dryRun });
      console.log(
        `${o.dryRun ? '🔍 Would flag' : '🔖 Flagged'} ${o.dryRun ? r.candidates : r.flagged} crawled ` +
          `companies with no website and no careers page — for a manual check; they are still crawled`,
      );
      if (r.keptUserDecision) console.log(`   ${r.keptUserDecision} left alone — you had already ruled on them`);
      for (const e of r.examples) console.log(`      ${e.name}${e.checkedAt ? ` (checked ${e.checkedAt.slice(0, 10)})` : ''}`);
      if (r.candidates > r.examples.length) console.log(`      … and ${r.candidates - r.examples.length} more`);
    }

    if (o.dns) {
      const r = await scanDeadDomains({
        limit: o.limit, attempts: o.attempts, dryRun: o.dryRun,
      });
      console.log(
        `🌐 Checked ${r.checked} domain(s): ${r.alive} alive · ${r.dead} dead · ${r.unknown} inconclusive`,
      );
      console.log(
        `   ${o.dryRun ? 'Would park' : 'Parked'} ${r.dead} as suspected closed. ` +
          `Inconclusive lookups are left alone — a timeout is not a dead company.`,
      );
      if (r.keptUserDecision) console.log(`   ${r.keptUserDecision} left alone — you had already ruled on them`);
      for (const e of r.examples) console.log(`      ${e.name} — ${e.host}`);
    }

    if (o.aggregators) {
      const r = scanAggregatorOnly({ dryRun: o.dryRun });
      const n = o.dryRun ? r.candidates : r.flagged;
      console.log(
        `🧩 ${o.dryRun ? 'Would flag' : 'Flagged'} ${n} compan${n === 1 ? 'y' : 'ies'} known only by a ` +
          `job board — for a manual check; they are still crawled`,
      );
      for (const e of r.examples) console.log(`      ${e.name}`);
    }

    // The browsable lists are derived from the column every time the command
    // runs, not only when it writes: a flag set anywhere else — a hand UPDATE,
    // the web console — would otherwise leave them silently stale.
    if (!o.dryRun) {
      const lists = syncLifecycleLists();
      if (o.scan || o.dns || o.aggregators || o.seed !== undefined || o.markLive) {
        console.log(
          `📋 Lists updated: ${Object.entries(lists).map(([n, c]) => `${n} (${c})`).join(' · ') || 'none'}`,
        );
      }
    }

    const acted = !!(o.scan || o.dns || o.aggregators || o.acquired || o.seed !== undefined || o.markLive || o.markAcquired);
    const rows = listDormant({ state: o.state });
    const byState = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.lifecycle] = (acc[r.lifecycle] ?? 0) + 1;
      return acc;
    }, {});
    const skipped = rows.filter((r) => skipsCrawl(r.lifecycle)).length;
    console.log(
      `\n🅿️  ${rows.length} flagged compan${rows.length === 1 ? 'y' : 'ies'}` +
        (rows.length
          ? `: ${Object.entries(byState).map(([st, c]) => `${c} ${st.replace(/_/g, ' ')}`).join(', ')}` +
            `\n   ${skipped} skipped by future crawls · ${rows.length - skipped} still crawled, flagged for a manual check`
          : ''),
    );
    for (const r of acted ? [] : rows.slice(0, 25)) {
      console.log(
        `   ${r.lifecycle_source === 'user' ? '✋' : '  '} ${r.name} — ${r.lifecycle_reason}` +
          `${r.employees ? ` · ${r.employees}` : ''}${r.lifecycle_evidence ? ` · ${r.lifecycle_evidence.slice(0, 90)}` : ''}`,
      );
    }
    if (!acted && rows.length > 25) {
      console.log(`   … and ${rows.length - 25} more (use --csv to see them all)`);
    }

    if (o.csv) {
      const n = writeCsv(
        o.csv,
        rows.map((r) => ({
          name: r.name,
          state: r.lifecycle,
          reason: r.lifecycle_reason,
          successor: r.lifecycle_successor,
          skipped_by_crawls: skipsCrawl(r.lifecycle) ? 'yes' : 'no',
          decided_by: r.lifecycle_source,
          decided_at: r.lifecycle_at,
          employees: r.employees,
          sector: r.sector,
          website: r.website_url,
          evidence: r.lifecycle_evidence,
        })),
      );
      console.log(`📝 Wrote ${n} row(s) to ${o.csv}`);
    }
  });

// ── careers-gap (real companies whose openings we cannot see) ──
program
  .command('careers-gap')
  .description('Companies that exist but whose careers page was never found — the manual-dive queue.')
  .option('--sector <names>', 'restrict to these company lists (comma-separated, or ids)')
  .option('--big', 'only companies of 51+ employees', false)
  .option('--csv <path>', 'write the list to a CSV')
  .action((o) => {
    db();
    const listIds = o.sector ? resolveSectors(String(o.sector)) : undefined;
    const rows = careersGap({ listIds, minEmployees: o.big });
    console.log(
      `🔎 ${rows.length} compan${rows.length === 1 ? 'y' : 'ies'} with a website but no careers page` +
        `${o.big ? ' (51+ employees)' : ''}`,
    );
    const bySize = rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.employees ?? 'unknown';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`   by size: ${Object.entries(bySize).map(([k, v]) => `${k}: ${v}`).join(' · ')}`);
    const own = rows.filter((r) => r.own_site).length;
    console.log(
      `   ${own} have a host that matches their name — start there. The other ${rows.length - own} ` +
        `only ever returned somebody else's host, so the URL below is a lead, not their site.`,
    );
    for (const r of rows.slice(0, 25)) {
      console.log(
        `   ${r.own_site ? '✓' : '?'} ${r.name}${r.employees ? ` · ${r.employees}` : ''} · ${r.website_url}` +
          `${r.needs_llm ? ' [needs-llm]' : ''}${r.positions ? ` · ${r.positions} position(s) already known` : ''}`,
      );
    }
    if (rows.length > 25) console.log(`   … and ${rows.length - 25} more (use --csv to see them all)`);
    if (o.csv) {
      const n = writeCsv(
        o.csv,
        rows.map((r) => ({
          name: r.name,
          employees: r.employees,
          sector: r.sector,
          website: r.website_url,
          website_matches_name: r.own_site ? 'yes' : 'no',
          last_checked: r.last_checked_at,
          positions_known: r.positions,
          needs_llm: r.needs_llm,
        })),
      );
      console.log(`📝 Wrote ${n} row(s) to ${o.csv}`);
    }
  });

// ── export-new (xlsx of newly scraped Israel PM roles) ──
program
  .command('export-new')
  .description('Write data/output/positions-new.xlsx of newly-scraped Israel PM roles.')
  .option('--since <date>', 'discovered on/after (YYYY-MM-DD)', '2026-07-15')
  .action((o) => {
    db();
    const r = exportNewPositions(o.since);
    console.log(`📊 Wrote ${r.count} new Israel PM roles → ${r.file}`);
  });

// ── people (finder for a single company; used by the web "Expand on employees") ──
program
  .command('people')
  .description('Find people worth talking to at a company (product, HR, engineering, founders).')
  .requiredOption('--company <id>', 'company id', (v) => parseInt(v, 10))
  .option('--roles <keys>', 'comma-separated presets: product,hr,engineering,founders', 'product,hr')
  .option('--titles <list>', 'comma-separated extra job titles to search for')
  .option('--location <hint>', 'region hint, e.g. \'israel OR "tel aviv"\'')
  .option('--skip-verification', 'do not check the company LinkedIn page first', false)
  .option('--json', 'print result as JSON', false)
  .action(async (o) => {
    db();
    const result = await findPeople(o.company, {
      roleKeys: String(o.roles).split(',').map((s: string) => s.trim()).filter(Boolean),
      customTitles: o.titles ? String(o.titles).split(',') : [],
      location: o.location ?? null,
      skipVerification: o.skipVerification,
    });
    if (o.json) {
      process.stdout.write(JSON.stringify(result));
      return;
    }
    if (result.verification) {
      console.log(`${result.verification.verified ? '✅' : '⚠️ '} ${result.verification.reason}`);
    }
    for (const f of result.partialFailures) console.warn(`⚠️  ${f}`);
    console.log(`Found ${result.candidates.length} candidates to review for company ${o.company}`);
  });

// ── import-tracker ──
program
  .command('import-tracker')
  .description("Import the user's Hebrew trackers (leads.xlsx + positions.xlsx) into the entity/outreach graph.")
  .option('--leads <path>', 'Job hunting leads.xlsx', paths.leadsXlsx)
  .option('--positions <path>', 'positions.xlsx', paths.positionsXlsx)
  .action(async (o) => {
    db();
    await runImportTracker(o.leads, o.positions);
  });

// ── rescan ──
program
  .command('rescan')
  .description('Re-scan companies with no Israel PM role (LinkedIn + render), then enrich/connect/report.')
  .option('--limit <n>', 'process at most N companies', (v) => parseInt(v, 10))
  .action(async (o) => {
    const n = await resetNoPmCompanies();
    console.log(`♻️  Re-scanning ${n} companies without an Israel PM role…`);
    await runSearcher({ limit: o.limit });
    await runEnrich({});
    await runHotApproach({});
    await generateReports();
  });

// ── enrich ──
program
  .command('enrich')
  .description('Normalize PM positions into structured, filterable fields (seniority, skills, …) via the configured LLM.')
  .option('--limit <n>', 'enrich at most N positions', (v) => parseInt(v, 10))
  .option('--all', 'enrich ALL positions, not just Product Manager roles', false)
  .option('--force', 're-enrich positions that already have requirements', false)
  .action((o) => runEnrich({ limit: o.limit, force: o.force, all: o.all }));

// ── details ──
program
  .command('details')
  .description('Open the job postings themselves, so enrichment has text to read years and location out of.')
  .option('--limit <n>', 'read at most N postings (each one is a billable request)', (v) => parseInt(v, 10))
  .option('--all', 'read ALL postings, not just Product Manager roles', false)
  .option('--dry-run', 'list what would be read without spending anything', false)
  .action(async (o) => {
    if (o.dryRun) {
      const pending = selectPostingsNeedingDetail({ limit: o.limit, all: o.all });
      console.log(`${pending.length} posting(s) would be read:`);
      for (const p of pending.slice(0, 20)) console.log(`  ${p.title} — ${p.url}`);
      if (pending.length > 20) console.log(`  … and ${pending.length - 20} more`);
      return;
    }
    await fetchPostingDetails({ limit: o.limit, all: o.all });
  });

// ── connect ──
program
  .command('connect')
  .description('Match your LinkedIn connections to target companies (warm intros).')
  .option('--second-degree', 'also list public employees for manual 2nd-degree review', false)
  .option('--limit <n>', '2nd-degree: companies to list', (v) => parseInt(v, 10))
  .action((o) => runHotApproach({ secondDegree: o.secondDegree, limit: o.limit }));

// ── report ──
program
  .command('report')
  .description('Regenerate positions.md, connections.md, run-log.md and CSV mirrors.')
  .action(() => generateReports());

// ── run-all ──
program
  .command('run-all')
  .description('ingest → search → enrich → connect → report')
  .option('--limit <n>', 'limit companies searched', (v) => parseInt(v, 10))
  .action(async (o) => {
    db();
    if (existsSync(paths.companiesCsv)) console.log(`🏢 Companies: +${ingestCompanyList(paths.companiesCsv).newCompanies} new`);
    if (existsSync(paths.connectionsCsv)) console.log(`👥 Connections: +${ingestConnections(paths.connectionsCsv).inserted} new`);
    await runSearcher({ limit: o.limit });
    await runEnrich({ limit: o.limit });
    await runHotApproach({});
    await generateReports();
  });

program
  .parseAsync()
  .catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => closeRedis());
