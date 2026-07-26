import type { AtsType } from '../types.js';

export interface AtsMatch {
  atsType: AtsType;
  token?: string;
}

// Subdomains that are the ATS's own site, not a company board.
const GENERIC_SUBS = new Set(['', 'www', 'jobs', 'apply', 'careers', 'boards', 'app', 'help', 'support']);

/**
 * Detect a known ATS and its board token/slug from a URL.
 * Requires a real company token — generic ATS homepages (jobs.workable.com,
 * bare greenhouse.io, …) return 'generic'/'unknown', never a tokenless board.
 */
export function detectAts(rawUrl: string): AtsMatch {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { atsType: 'unknown' };
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  const first = parts[0];
  const ok = (t?: string) => t && !GENERIC_SUBS.has(t.toLowerCase());

  // Greenhouse: only real job boards (boards./job-boards., optional .eu), or ?for= embed.
  if (host.endsWith('greenhouse.io')) {
    if (host.startsWith('boards.') || host.startsWith('job-boards.')) {
      if (ok(first)) return { atsType: 'greenhouse', token: first };
    }
    const forTok = u.searchParams.get('for');
    if (ok(forTok ?? undefined)) return { atsType: 'greenhouse', token: forTok! };
    return { atsType: 'unknown' }; // support./www. etc. are not boards
  }
  // Lever: only jobs.lever.co/{company} (not www.lever.co marketing pages)
  if (host === 'jobs.lever.co') {
    if (ok(first)) return { atsType: 'lever', token: first };
    return { atsType: 'unknown' };
  }
  // Workable: apply.workable.com/{company} or {company}.workable.com (not jobs./www.)
  if (host.endsWith('workable.com')) {
    const sub = host.split('.')[0];
    const token = host.startsWith('apply.') ? first : sub;
    if (ok(token)) return { atsType: 'workable', token: token! };
    return { atsType: 'unknown' };
  }
  // Ashby: jobs.ashbyhq.com/{token}
  if (host === 'jobs.ashbyhq.com') {
    if (ok(first)) return { atsType: 'ashby', token: first };
    return { atsType: 'unknown' };
  }
  // SmartRecruiters: careers./jobs.smartrecruiters.com/{CompanyId}
  if (host.endsWith('smartrecruiters.com') && (host.startsWith('careers.') || host.startsWith('jobs.'))) {
    if (ok(first)) return { atsType: 'smartrecruiters', token: first };
    return { atsType: 'unknown' };
  }
  // Recruitee: {company}.recruitee.com
  if (host.endsWith('recruitee.com')) {
    const sub = host.split('.')[0];
    if (ok(sub)) return { atsType: 'recruitee', token: sub };
    return { atsType: 'unknown' };
  }
  // BambooHR: {company}.bamboohr.com
  if (host.endsWith('bamboohr.com')) {
    const sub = host.split('.')[0];
    if (ok(sub)) return { atsType: 'bamboohr', token: sub };
    return { atsType: 'unknown' };
  }
  // Comeet: comeet.com/jobs/... (token resolved from page content later)
  if (host.includes('comeet.co')) return { atsType: 'comeet' };

  // A plausible careers/jobs page on a company domain -> generic (fetch + parse)
  if (/careers|jobs|join-?us|positions|vacanc/i.test(u.pathname)) return { atsType: 'generic' };
  return { atsType: 'unknown' };
}

/**
 * Detect an ATS **embedded** in a company careers page's HTML (company sites often
 * host their careers on their own domain but embed/link a real ATS board).
 * Returns the first tokened ATS found.
 */
export function detectAtsInHtml(html: string): AtsMatch {
  const patterns: Array<[AtsType, RegExp]> = [
    ['greenhouse', /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_]+)/i],
    ['greenhouse', /greenhouse\.io\/embed\/job_board\?for=([a-z0-9_]+)/i],
    ['lever', /jobs\.lever\.co\/([a-z0-9_-]+)/i],
    ['workable', /apply\.workable\.com\/([a-z0-9_-]+)/i],
    ['ashby', /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i],
    ['smartrecruiters', /careers\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i],
    ['recruitee', /([a-z0-9-]+)\.recruitee\.com/i],
    ['bamboohr', /([a-z0-9-]+)\.bamboohr\.com/i],
  ];
  for (const [atsType, re] of patterns) {
    const m = html.match(re);
    if (m && m[1] && !GENERIC_SUBS.has(m[1].toLowerCase())) return { atsType, token: m[1] };
  }
  if (/comeet\.co/i.test(html)) return { atsType: 'comeet' };
  return { atsType: 'unknown' };
}
