import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { paths } from '../config.js';
import { db, now } from '../db/client.js';

function mdCell(v: unknown): string {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function mdTable(headers: string[], rows: unknown[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}

/** Regenerate all Markdown + CSV reports from the DB. */
export async function generateReports(): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  const handle = db();

  // ── Product Manager positions (the only target) ──
  const positions = handle
    .prepare(
      `SELECT c.name AS company, p.title, p.location, p.url, p.discovered_at,
              CASE WHEN EXISTS(SELECT 1 FROM warm_intros w WHERE w.company_id = c.id) THEN '★' ELSE '' END AS warm,
              r.seniority, r.work_model, r.min_years, r.must_have_skills, r.normalized_location
       FROM positions p
       JOIN companies c ON c.id = p.company_id
       LEFT JOIN position_requirements r ON r.position_id = p.id
       WHERE p.is_product = 1 AND (r.is_israel IS NULL OR r.is_israel = 1)
       ORDER BY warm DESC, c.name COLLATE NOCASE, p.title`,
    )
    .all() as any[];
  const totalPositions = (handle.prepare('SELECT COUNT(*) c FROM positions').get() as { c: number }).c;
  const excludedNonIsrael = (handle
    .prepare('SELECT COUNT(*) c FROM positions p JOIN position_requirements r ON r.position_id = p.id WHERE p.is_product = 1 AND r.is_israel = 0')
    .get() as { c: number }).c;

  const skills = (json: string | null) => {
    try { return (JSON.parse(json ?? '[]') as string[]).slice(0, 6).join(', '); } catch { return ''; }
  };
  const posHeaders = ['Warm', 'Company', 'Title', 'Seniority', 'Work', 'Min yrs', 'Key skills', 'Location', 'Link'];
  const posRows = positions.map((p) => [
    p.warm, p.company, p.title, p.seniority ?? '', p.work_model ?? '',
    p.min_years ?? '', skills(p.must_have_skills), p.normalized_location ?? p.location ?? '',
    p.url ? `[open](${p.url})` : '',
  ]);
  await writeFile(
    resolve(paths.outputDir, 'positions.md'),
    `# Product Manager Positions (Israel)\n\n_Generated ${now()} — ${positions.length} Israel-based PM roles ` +
      `(${excludedNonIsrael} non-Israel PM roles excluded; ${totalPositions} total positions scraped) — ★ = warm connection_\n\n` +
      (posRows.length ? mdTable(posHeaders, posRows) : '_No PM positions yet. Run `npm run search` then `npm run enrich`._') +
      '\n',
    'utf8',
  );
  await writeFile(
    resolve(paths.outputDir, 'positions.csv'),
    toCsv(
      ['warm', 'company', 'title', 'seniority', 'work_model', 'min_years', 'must_have_skills', 'location', 'url'],
      positions.map((p) => [p.warm, p.company, p.title, p.seniority, p.work_model, p.min_years, skills(p.must_have_skills), p.normalized_location ?? p.location, p.url]),
    ),
    'utf8',
  );

  // ── Warm connections ──
  const intros = handle
    .prepare(
      `SELECT c.name AS company, conn.full_name, conn.position, conn.linkedin_url,
              w.match_type, w.confidence
       FROM warm_intros w
       JOIN companies c ON c.id = w.company_id
       JOIN connections conn ON conn.id = w.connection_id
       ORDER BY c.name COLLATE NOCASE, w.match_type, conn.full_name`,
    )
    .all() as any[];
  const connHeaders = ['Company', 'Connection', 'Their Role', 'Match', 'Confidence', 'LinkedIn'];
  const connRows = intros.map((i) => [
    i.company, i.full_name, i.position ?? '', i.match_type,
    i.confidence, i.linkedin_url ? `[profile](${i.linkedin_url})` : '',
  ]);
  await writeFile(
    resolve(paths.outputDir, 'connections.md'),
    `# Warm Connections\n\n_Generated ${now()} — ${intros.length} warm intro(s)_\n\n` +
      (connRows.length
        ? mdTable(connHeaders, connRows)
        : '_No warm connections yet. Run `npm run connect` after ingesting Connections.csv._') +
      '\n',
    'utf8',
  );
  await writeFile(
    resolve(paths.outputDir, 'connections.csv'),
    toCsv(['company', 'connection', 'role', 'match_type', 'confidence', 'linkedin_url'],
      intros.map((i) => [i.company, i.full_name, i.position, i.match_type, i.confidence, i.linkedin_url])),
    'utf8',
  );

  // ── Company coverage (what we scraped, and who had no PM roles) ──
  const coverage = handle
    .prepare(
      `SELECT c.name, c.status, c.needs_llm, c.ats_type, c.careers_url,
              (SELECT COUNT(*) FROM positions p WHERE p.company_id = c.id) AS total,
              (SELECT COUNT(*) FROM positions p WHERE p.company_id = c.id AND p.is_product = 1) AS pm,
              (SELECT COUNT(*) FROM positions p JOIN position_requirements r ON r.position_id = p.id
                 WHERE p.company_id = c.id AND p.is_product = 1 AND r.is_israel = 1) AS pm_il,
              (SELECT group_concat(DISTINCT COALESCE(r.country,'?')) FROM positions p
                 JOIN position_requirements r ON r.position_id = p.id
                 WHERE p.company_id = c.id AND p.is_product = 1 AND r.is_israel = 0) AS overseas
       FROM companies c
       WHERE c.status IN ('checked', 'error')
       ORDER BY pm_il DESC, pm DESC, total DESC, c.name COLLATE NOCASE`,
    )
    .all() as any[];
  const result = (r: any): string => {
    if (r.status === 'error') return 'error';
    if (r.pm_il > 0) return `${r.pm_il} PM role(s) in Israel`;
    if (r.pm > 0) return `disqualified — PM role(s) overseas only (${r.overseas || 'non-Israel'})`;
    if (r.total > 0) return 'scraped — no PM roles';
    if (!r.careers_url) return 'no careers page found';
    if (r.needs_llm) return 'careers page — no parseable roles';
    return 'no roles';
  };
  const covHeaders = ['Company', 'Result', 'Roles', 'PM', 'PM (IL)', 'ATS'];
  const covRows = coverage.map((r) => [r.name, result(r), r.total, r.pm, r.pm_il, r.ats_type ?? '']);
  const withIlPm = coverage.filter((r) => r.pm_il > 0).length;
  const overseasOnly = coverage.filter((r) => r.pm > 0 && r.pm_il === 0).length;
  await writeFile(
    resolve(paths.outputDir, 'companies.md'),
    `# Company Coverage\n\n_Generated ${now()} — ${coverage.length} companies checked; ` +
      `${withIlPm} with Israel PM roles, ${overseasOnly} disqualified (PM overseas only)_\n\n` +
      (covRows.length ? mdTable(covHeaders, covRows) : '_No companies checked yet._') + '\n',
    'utf8',
  );
  await writeFile(
    resolve(paths.outputDir, 'companies.csv'),
    toCsv(['company', 'result', 'total_roles', 'pm_roles', 'pm_israel', 'ats_type', 'careers_url'],
      coverage.map((r) => [r.name, result(r), r.total, r.pm, r.pm_il, r.ats_type, r.careers_url])),
    'utf8',
  );

  // ── Run log (audit: what was checked, when) ──
  const log = handle
    .prepare(
      `SELECT l.agent, c.name AS company, l.status, l.started_at, l.finished_at, l.stats
       FROM check_log l LEFT JOIN companies c ON c.id = l.company_id
       ORDER BY l.id DESC LIMIT 300`,
    )
    .all() as any[];
  const logHeaders = ['Agent', 'Company', 'Status', 'Started', 'Finished', 'Stats'];
  const logRows = log.map((l) => [
    l.agent, l.company ?? '—', l.status,
    (l.started_at ?? '').replace('T', ' ').slice(0, 19),
    (l.finished_at ?? '').replace('T', ' ').slice(0, 19),
    l.stats ?? '',
  ]);
  await writeFile(
    resolve(paths.outputDir, 'run-log.md'),
    `# Run Log\n\n_Generated ${now()} — last ${log.length} checks_\n\n` +
      (logRows.length ? mdTable(logHeaders, logRows) : '_No runs yet._') + '\n',
    'utf8',
  );

  console.log(
    `📄 Reports written to ${paths.outputDir}:\n` +
      `   positions.md (${positions.length} PM)  companies.md (${coverage.length} checked)  ` +
      `connections.md (${intros.length})  run-log.md`,
  );
}
