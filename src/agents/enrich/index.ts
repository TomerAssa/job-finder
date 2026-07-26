import PQueue from 'p-queue';
import { z } from 'zod';
import { db, now } from '../../db/client.js';
import { startLog, finishLog } from '../../db/checkLog.js';
import { extract } from '../../llm/provider.js';
import { normalizeCountry } from '../../util/country.js';

const ENRICH_CONCURRENCY = 6;

const Enrichment = z.object({
  seniority: z.string().nullable().optional(),
  min_years: z.number().nullable().optional(),
  max_years: z.number().nullable().optional(),
  must_have_skills: z.array(z.string()).optional(),
  nice_to_have_skills: z.array(z.string()).optional(),
  tech_stack: z.array(z.string()).optional(),
  domain: z.string().nullable().optional(),
  employment_type: z.string().nullable().optional(),
  work_model: z.string().nullable().optional(),
  normalized_location: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  is_israel: z.boolean().nullable().optional(),
  languages: z.array(z.string()).optional(),
  summary: z.string().nullable().optional(),
});
type Enrichment = z.infer<typeof Enrichment>;

interface JobRow {
  id: number;
  company: string;
  title: string;
  location: string | null;
  description: string | null;
}

async function enrichOne(job: JobRow): Promise<Enrichment> {
  return extract(
    `Normalize this job posting into structured fields for filtering. Infer values from the ` +
      `text; do not invent specifics. Skills/tech must be short lowercase tokens (e.g. "python", ` +
      `"kubernetes", "incident response"). seniority ∈ junior|mid|senior|lead|principal|manager|` +
      `intern|unknown. work_model ∈ remote|hybrid|onsite|unknown. employment_type ∈ full-time|` +
      `part-time|contract|internship|unknown. min_years/max_years are integers or null.\n\n` +
      `For location: "country" is the role's country; "is_israel" is true if the role is ` +
      `located in Israel (Tel Aviv, Herzliya, Haifa, Ramat Gan, Petah Tikva, etc.) OR the ` +
      `location is unspecified/remote at this (Israeli) company — and false ONLY if it clearly ` +
      `states another country (US, UK, EU, India, etc.).\n\n` +
      `Return JSON with keys: seniority, min_years, max_years, must_have_skills[], ` +
      `nice_to_have_skills[], tech_stack[], domain, employment_type, work_model, ` +
      `normalized_location, country, is_israel, languages[], summary (one line).\n\n` +
      `COMPANY: ${job.company} (an Israeli company)\nTITLE: ${job.title}\nLOCATION: ${job.location ?? ''}\n` +
      `DESCRIPTION:\n${(job.description ?? '').slice(0, 6000)}`,
    Enrichment,
    { temperature: 0 },
  );
}

/** Normalize positions into the position_requirements table via Gemini (structured). */
export async function runEnrich(opts: { limit?: number; force?: boolean; all?: boolean } = {}): Promise<void> {
  // By default only enrich Product Manager positions (the user's sole target).
  const clauses: string[] = [];
  if (!opts.all) clauses.push('p.is_product = 1');
  if (!opts.force) clauses.push('r.position_id IS NULL');
  const where = clauses.length ? clauses.join(' AND ') : '1=1';
  const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : '';
  const jobs = db()
    .prepare(
      `SELECT p.id, c.name AS company, p.title, p.location, p.description
       FROM positions p
       JOIN companies c ON c.id = p.company_id
       LEFT JOIN position_requirements r ON r.position_id = p.id
       WHERE ${where} ORDER BY p.id ${limit}`,
    )
    .all() as JobRow[];

  if (jobs.length === 0) {
    console.log('Nothing to enrich. Run `npm run search` first (or pass --force to re-enrich).');
    return;
  }

  console.log(`🧠 Enriching ${jobs.length} positions via Gemini (concurrency ${ENRICH_CONCURRENCY})…`);
  const logId = startLog('enrich', null);
  const upsert = db().prepare(
    `INSERT INTO position_requirements
       (position_id, seniority, min_years, max_years, must_have_skills, nice_to_have_skills,
        tech_stack, domain, employment_type, work_model, normalized_location, country, is_israel,
        languages, summary, enriched_at)
     VALUES (@position_id,@seniority,@min_years,@max_years,@must_have_skills,@nice_to_have_skills,
        @tech_stack,@domain,@employment_type,@work_model,@normalized_location,@country,@is_israel,
        @languages,@summary,@enriched_at)
     ON CONFLICT(position_id) DO UPDATE SET
       seniority=excluded.seniority, min_years=excluded.min_years, max_years=excluded.max_years,
       must_have_skills=excluded.must_have_skills, nice_to_have_skills=excluded.nice_to_have_skills,
       tech_stack=excluded.tech_stack, domain=excluded.domain, employment_type=excluded.employment_type,
       work_model=excluded.work_model, normalized_location=excluded.normalized_location,
       country=excluded.country, is_israel=excluded.is_israel,
       languages=excluded.languages, summary=excluded.summary, enriched_at=excluded.enriched_at`,
  );

  const queue = new PQueue({ concurrency: ENRICH_CONCURRENCY });
  let done = 0;
  let failed = 0;
  await queue.addAll(
    jobs.map((job) => async () => {
      try {
        const e = await enrichOne(job);
        upsert.run({
          position_id: job.id,
          seniority: e.seniority ?? null,
          min_years: e.min_years ?? null,
          max_years: e.max_years ?? null,
          must_have_skills: JSON.stringify(e.must_have_skills ?? []),
          nice_to_have_skills: JSON.stringify(e.nice_to_have_skills ?? []),
          tech_stack: JSON.stringify(e.tech_stack ?? []),
          domain: e.domain ?? null,
          employment_type: e.employment_type ?? null,
          work_model: e.work_model ?? null,
          normalized_location: e.normalized_location ?? null,
          country: normalizeCountry(e.country),
          is_israel: e.is_israel === null || e.is_israel === undefined ? null : e.is_israel ? 1 : 0,
          languages: JSON.stringify(e.languages ?? []),
          summary: e.summary ?? null,
          enriched_at: now(),
        });
        done++;
      } catch (err) {
        failed++;
        if (failed <= 3) console.log(`   ✗ ${job.company} — ${job.title}: ${(err as Error).message}`);
      }
    }),
  );

  finishLog(logId, 'ok', { enriched: done, failed });
  console.log(`Enriched ${done}/${jobs.length} positions${failed ? ` (${failed} failed)` : ''}.`);
}
