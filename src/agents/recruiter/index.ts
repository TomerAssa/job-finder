import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { paths, config } from '../../config.js';
import { db } from '../../db/client.js';
import { startLog, finishLog } from '../../db/checkLog.js';
import { getCvText } from '../../ingest/cv.js';
import { tailorCv, type JobContext } from './tailorCv.js';

export interface RecruiterOpts {
  all?: boolean; // tailor for every position, not just shortlisted
  limit?: number;
  force?: boolean; // overwrite existing tailored files
}

interface JobRow extends JobContext {
  id: number;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Tailor the CV for shortlisted (or all) positions and write Markdown files. */
export async function runRecruiter(opts: RecruiterOpts = {}): Promise<void> {
  const cvText = await getCvText();
  await mkdir(paths.tailoredDir, { recursive: true });

  const where = opts.all ? '1=1' : 'p.is_shortlisted = 1';
  const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : '';
  const jobs = db()
    .prepare(
      `SELECT p.id, c.name AS company, p.title, p.location, p.description, p.url
       FROM positions p JOIN companies c ON c.id = p.company_id
       WHERE ${where} ORDER BY p.id ${limit}`,
    )
    .all() as JobRow[];

  if (jobs.length === 0) {
    console.log(
      opts.all
        ? 'No positions found. Run `npm run search` first.'
        : 'No shortlisted positions. Run `npm run connect` first, or pass --all.',
    );
    return;
  }

  console.log(`📝 Tailoring CV for ${jobs.length} position(s) via ${config.llm.provider}…`);
  const logId = startLog('recruiter', null);
  let written = 0;
  let skipped = 0;

  for (const job of jobs) {
    const file = resolve(paths.tailoredDir, `${slug(job.company)}__${slug(job.title)}__${job.id}.md`);
    if (existsSync(file) && !opts.force) {
      skipped++;
      continue;
    }
    try {
      const md = await tailorCv(cvText, job);
      const header = `<!-- Tailored for ${job.company} — ${job.title}${job.url ? ` — ${job.url}` : ''} -->\n\n`;
      await writeFile(file, header + md, 'utf8');
      written++;
      console.log(`   ✓ ${job.company} — ${job.title}`);
    } catch (err) {
      console.log(`   ✗ ${job.company} — ${job.title}: ${err instanceof Error ? err.message : err}`);
    }
  }

  finishLog(logId, 'ok', { written, skipped, total: jobs.length });
  console.log(`Wrote ${written} tailored CV(s) to ${paths.tailoredDir}${skipped ? ` (${skipped} already existed)` : ''}.`);
}
