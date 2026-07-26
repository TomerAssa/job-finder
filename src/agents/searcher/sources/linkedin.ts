import { fetchPage } from '../../../brightdata/unlocker.js';
import { normalizeCompany, similarity } from '../../../util/normalize.js';
import { isProductManager } from '../../../util/roles.js';
import type { FoundPosition } from '../types.js';

// LinkedIn's public "guest" job-search endpoint (no auth). geoId 101620260 = Israel.
const ISRAEL_GEO = '101620260';

interface LiJob {
  title: string;
  company: string;
  location: string;
  url: string;
}

function strip(s: string | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const grab = (b: string, re: RegExp): string => strip((b.match(re) ?? [])[1]);

/** Parse job cards from the LinkedIn guest job-search HTML fragment. */
export function parseLinkedInJobs(html: string): LiJob[] {
  const out: LiJob[] = [];
  for (const b of html.split(/<li[\s>]/).slice(1)) {
    const title = grab(b, /base-search-card__title[^>]*>([\s\S]*?)<\/h3>/);
    const company = grab(b, /base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/);
    const location = grab(b, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/);
    const url = (b.match(/base-card__full-link[^>]*href="([^"?]+)/) ||
      b.match(/href="(https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/[^"?]+)/) || [])[1];
    if (title && url) out.push({ title, company, location, url });
  }
  return out;
}

/** True if a LinkedIn card's company plausibly IS the target company. */
function companyMatches(target: string, cardCompany: string): boolean {
  const a = normalizeCompany(target);
  const b = normalizeCompany(cardCompany);
  if (!a || !b) return false;
  if (a === b || similarity(a, b) >= 0.85) return true;
  if (a.includes(b) || b.includes(a)) return true; // "Pentera" ⊂ "Pentera Security"
  return a.split(' ')[0] === b.split(' ')[0]; // same distinctive first word
}

/**
 * Find Product Manager roles for a company via LinkedIn Jobs, restricted to Israel.
 * Because we query with location=Israel, results are Israel-based by construction —
 * this reaches companies whose own careers site we couldn't scrape (SPA/iframe ATS).
 */
export async function linkedinPmJobs(company: string): Promise<FoundPosition[]> {
  const url =
    `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` +
    `?keywords=${encodeURIComponent(`${company} product manager`)}` +
    `&location=Israel&geoId=${ISRAEL_GEO}`;
  // Paginate: LinkedIn returns 25 cards/page — grab two pages for big employers.
  const seen = new Map<string, LiJob>();
  for (const start of [0, 25]) {
    let html: string;
    try {
      html = await fetchPage(`${url}&start=${start}`);
    } catch {
      break;
    }
    const cards = parseLinkedInJobs(html);
    for (const c of cards) if (!seen.has(c.url)) seen.set(c.url, c);
    if (cards.length < 25) break; // no more pages
  }
  return [...seen.values()]
    .filter((j) => isProductManager(j.title) && companyMatches(company, j.company))
    .map((j) => ({ title: j.title, location: j.location || 'Israel', url: j.url }));
}
