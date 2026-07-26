import { complete } from '../../llm/provider.js';

export interface JobContext {
  company: string;
  title: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

const SYSTEM =
  'You are an expert technical recruiter and resume writer. You tailor a candidate\'s ' +
  'existing CV to a specific job. You NEVER invent experience, employers, degrees, or ' +
  'skills the candidate does not already have — you only re-order, re-emphasize, and ' +
  'rephrase real content to match the role. Output clean Markdown only.';

/** Produce a tailored CV (Markdown) for one job from the candidate's real CV text. */
export async function tailorCv(cvText: string, job: JobContext): Promise<string> {
  const prompt =
    `Tailor the CV below for this position. Keep it truthful and grounded in the CV.\n\n` +
    `POSITION\n` +
    `- Company: ${job.company}\n` +
    `- Title: ${job.title}\n` +
    (job.location ? `- Location: ${job.location}\n` : '') +
    (job.url ? `- Link: ${job.url}\n` : '') +
    `\nJOB DESCRIPTION\n${(job.description ?? '(no description captured — infer from the title)').slice(0, 6000)}\n\n` +
    `CANDIDATE CV (source of truth — do not add anything not supported here)\n${cvText.slice(0, 12000)}\n\n` +
    `Return a complete tailored CV in Markdown. Start with a short 2–3 line summary ` +
    `positioning the candidate for THIS role, then reorder skills/experience to lead with ` +
    `the most relevant items. Do not fabricate.`;

  return complete(prompt, { system: SYSTEM, temperature: 0.3 });
}
