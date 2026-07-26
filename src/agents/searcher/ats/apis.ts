import type { FoundPosition } from '../types.js';

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Greenhouse public board API. */
export async function greenhouseJobs(token: string): Promise<FoundPosition[]> {
  const data = await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
  );
  return (data.jobs ?? []).map((j: any) => ({
    title: j.title,
    location: j.location?.name,
    url: j.absolute_url,
    description: typeof j.content === 'string' ? decodeHtml(j.content) : undefined,
  }));
}

/** Lever public postings API. */
export async function leverJobs(token: string): Promise<FoundPosition[]> {
  const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j: any) => ({
    title: j.text,
    location: j.categories?.location,
    url: j.hostedUrl,
    description: j.descriptionPlain,
  }));
}

/** Workable public jobs endpoint (best-effort; falls back to LLM on failure). */
export async function workableJobs(account: string): Promise<FoundPosition[]> {
  const data = await getJson(`https://${encodeURIComponent(account)}.workable.com/spi/v3/jobs`);
  return (data.results ?? data.jobs ?? []).map((j: any) => ({
    title: j.title,
    location: [j.location?.city, j.location?.country].filter(Boolean).join(', ') || j.location?.location_str,
    url: j.url || j.application_url || j.shortlink,
    description: j.description,
  }));
}

/** Ashby public job-board API. */
export async function ashbyJobs(token: string): Promise<FoundPosition[]> {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`);
  return (data.jobs ?? []).map((j: any) => ({
    title: j.title,
    location: j.location || j.locationName || j.address?.postalAddress?.addressLocality,
    url: j.jobUrl || j.applyUrl,
    description: typeof j.descriptionPlain === 'string' ? j.descriptionPlain : undefined,
  }));
}

/** SmartRecruiters public postings API. */
export async function smartRecruitersJobs(companyId: string): Promise<FoundPosition[]> {
  const data = await getJson(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?limit=100`,
  );
  return (data.content ?? []).map((j: any) => ({
    title: j.name,
    location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
    url: j.ref ? `https://jobs.smartrecruiters.com/${companyId}/${j.id}` : j.applyUrl,
    description: undefined,
  }));
}

/** Recruitee public offers API. */
export async function recruiteeJobs(company: string): Promise<FoundPosition[]> {
  const data = await getJson(`https://${encodeURIComponent(company)}.recruitee.com/api/offers/`);
  return (data.offers ?? []).map((j: any) => ({
    title: j.title,
    location: [j.city, j.country].filter(Boolean).join(', ') || j.location,
    url: j.careers_url || j.careers_apply_url,
    description: typeof j.description === 'string' ? decodeHtml(j.description) : undefined,
  }));
}

/** BambooHR public careers list. */
export async function bamboohrJobs(token: string): Promise<FoundPosition[]> {
  const data = await getJson(`https://${encodeURIComponent(token)}.bamboohr.com/careers/list`);
  return (data.result ?? []).map((j: any) => ({
    title: j.jobOpeningName,
    location: j.location
      ? [j.location.city, j.location.state, j.location.country].filter(Boolean).join(', ')
      : j.locationLabel,
    url: `https://${token}.bamboohr.com/careers/${j.id}`,
    description: undefined,
  }));
}

function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
