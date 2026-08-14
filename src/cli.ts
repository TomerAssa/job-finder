#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { paths } from './config.js';
import { db, initDb } from './db/client.js';
import { closeRedis } from './redis.js';
import { ingestConnections } from './ingest/connections.js';
import { ingestCompanyList, listSectors } from './ingest/companyLists.js';
import { ingestCv } from './ingest/cv.js';
import { runSearcher, resetNoPmCompanies } from './agents/searcher/index.js';
import { reclassifyPositions } from './agents/searcher/reclassify.js';
import { runHotApproach } from './agents/hotApproach/index.js';
import { runRecruiter } from './agents/recruiter/index.js';
import { runEnrich } from './agents/enrich/index.js';
import { runImportTracker } from './agents/import/tracker.js';
import { findPeople } from './agents/people/index.js';
import { exportNewPositions } from './agents/export/newXlsx.js';
import { generateReports } from './report/generate.js';
import { runDoctor } from './doctor.js';

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

// ── doctor ──
program
  .command('doctor')
  .description('Check BrightData (SERP + Unlocker), Redis, and LLM connectivity.')
  .action(() => runDoctor());

// ── ingest ──
program
  .command('ingest')
  .description('Load companies CSV, connections CSV, and CV PDF into the database.')
  .option('--companies <path>', 'Israel Startup Finder export', paths.companiesCsv)
  .option('--connections <path>', 'LinkedIn Connections.csv', paths.connectionsCsv)
  .option('--cv <path>', 'CV PDF', paths.cvPdf)
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

    if (existsSync(o.cv)) {
      const r = await ingestCv(o.cv);
      console.log(`📄 CV: extracted ${r.chars} chars → ${r.cachePath}`);
    } else console.warn(`⚠️  CV PDF not found: ${o.cv} (needed for tailoring)`);
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
      console.log(`   ${s.name.padEnd(34)} ${String(s.companies).padStart(4)} companies · ${s.withPositions} crawled`);
    }
  });

// ── search ──
program
  .command('search')
  .description('Find open positions for each company (SERP → careers/ATS → parse).')
  .option('--limit <n>', 'process at most N companies', (v) => parseInt(v, 10))
  .option('--sector <names>', 'restrict to these company lists (comma-separated, or ids)')
  .option('--force', 'ignore freshness cache and re-check everything', false)
  .action((o) => {
    let listIds: number[] | undefined;
    if (o.sector) {
      const wanted = String(o.sector).split(',').map((s: string) => s.trim()).filter(Boolean);
      const all = listSectors();
      listIds = wanted.map((w: string) => {
        const byId = Number(w);
        const hit = all.find((l) => l.id === byId || l.name.toLowerCase() === w.toLowerCase());
        if (!hit) {
          throw new Error(`No company list called "${w}". Known: ${all.map((l) => l.name).join(', ')}`);
        }
        return hit.id;
      });
      const scope = all.filter((l) => listIds!.includes(l.id));
      console.log(`🔎 Scope: ${scope.map((l) => `${l.name} (${l.companies})`).join(', ')}`);
    }
    return runSearcher({ limit: o.limit, force: o.force, listIds });
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
  .description('Normalize PM positions into structured, filterable fields (seniority, skills, …) via Gemini.')
  .option('--limit <n>', 'enrich at most N positions', (v) => parseInt(v, 10))
  .option('--all', 'enrich ALL positions, not just Product Manager roles', false)
  .option('--force', 're-enrich positions that already have requirements', false)
  .action((o) => runEnrich({ limit: o.limit, force: o.force, all: o.all }));

// ── connect ──
program
  .command('connect')
  .description('Match your LinkedIn connections to target companies (warm intros).')
  .option('--second-degree', 'also list public employees for manual 2nd-degree review', false)
  .option('--limit <n>', '2nd-degree: companies to list', (v) => parseInt(v, 10))
  .action((o) => runHotApproach({ secondDegree: o.secondDegree, limit: o.limit }));

// ── tailor ──
program
  .command('tailor')
  .description('Tailor your CV to shortlisted positions (or all with --all).')
  .option('--all', 'tailor for every position, not just shortlisted', false)
  .option('--limit <n>', 'tailor at most N positions', (v) => parseInt(v, 10))
  .option('--force', 'overwrite existing tailored CVs', false)
  .action((o) => runRecruiter({ all: o.all, limit: o.limit, force: o.force }));

// ── report ──
program
  .command('report')
  .description('Regenerate positions.md, connections.md, run-log.md and CSV mirrors.')
  .action(() => generateReports());

// ── run-all ──
program
  .command('run-all')
  .description('ingest → search → connect → tailor → report')
  .option('--limit <n>', 'limit companies searched / positions tailored', (v) => parseInt(v, 10))
  .action(async (o) => {
    db();
    if (existsSync(paths.companiesCsv)) console.log(`🏢 Companies: +${ingestCompanyList(paths.companiesCsv).newCompanies} new`);
    if (existsSync(paths.connectionsCsv)) console.log(`👥 Connections: +${ingestConnections(paths.connectionsCsv).inserted} new`);
    if (existsSync(paths.cvPdf)) await ingestCv(paths.cvPdf);
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
