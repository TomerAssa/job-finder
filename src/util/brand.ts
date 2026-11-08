/**
 * Whose brand is this page?
 *
 * An acquired company's domain keeps resolving; it just stops being theirs.
 * `cyberark.com/careers` serves "Idira | The Identity Security Platform - Palo
 * Alto Networks", and `votiro.com/careers` serves "Life at Menlo - Careers |
 * Menlo Security". A crawler that cannot see that difference either records the
 * company as having no careers page, or — worse — scrapes the acquirer's
 * openings and files them under the acquired company's name.
 *
 * So: does this page still carry the company's own name, and if not, whose name
 * does it carry? Deliberately a detector of *mismatch*, not of acquisition. A
 * mismatch can also mean a rebrand, which is why the caller needs a successor
 * name before it will act, and why the result is evidence a human can read
 * rather than a verdict.
 */
import { normalizeCompany, similarity } from './normalize.js';
import { hostLooksLikeCompany } from './hosts.js';

/** Site-wide names that identify a page type, not an organisation. */
const GENERIC_BRANDS = new Set([
  'careers', 'career', 'jobs', 'job', 'home', 'homepage', 'welcome', 'about', 'about us',
  'not found', 'page not found', '404', 'error', 'untitled', 'index', 'login', 'sign in',
  'open positions', 'join us', 'work with us', 'current openings', 'we are hiring',
  'coming soon', 'under construction', 'default web site page',
]);

function text(html: string, re: RegExp): string | null {
  const m = html.match(re);
  if (!m) return null;
  const v = (m[1] ?? '').replace(/\s+/g, ' ').trim();
  return v || null;
}

/**
 * The name a site declares for itself in metadata — authoritative when present,
 * because it names the organisation rather than the page.
 */
export function siteNameOf(html: string): string | null {
  const head = html.slice(0, 20_000);
  return (
    text(head, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ??
    text(head, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i) ??
    text(head, /<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)
  );
}

/** The page title, which names the page first and the organisation last. */
export function titleOf(html: string): string | null {
  return text(html.slice(0, 20_000), /<title[^>]*>([\s\S]*?)<\/title>/i);
}

/** The brand strings a page declares about itself, most authoritative first. */
export function brandCandidates(html: string): string[] {
  return [...new Set([siteNameOf(html), titleOf(html)].filter((v): v is string => !!v))];
}

/**
 * Split a title into its parts. Site titles name the page first and the
 * organisation last — "Life at Menlo - Careers | Menlo Security" — so the
 * trailing segment is the one worth reading as a brand.
 */
export function titleSegments(title: string): string[] {
  return title
    .split(/\s[|–—·•]\s|\s-\s/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export interface BrandCheck {
  /** True when nothing on the page names this company. */
  mismatch: boolean;
  /** The organisation the page does name, when one can be read off it. */
  successor: string | null;
  /** What the decision was made from, for the evidence column. */
  sawBrand: string | null;
}

/**
 * Is this string a company name rather than a tagline?
 *
 * A dry run offered "Secure. At The Core." as an acquirer, read off a title
 * segment that was marketing copy. An organisation name is short and is not a
 * sentence, and accepting one that is would put a confident falsehood in the
 * evidence column.
 */
export function looksLikeBrandName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 40) return false;
  if (t.split(/\s+/).length > 4) return false;
  // Sentence punctuation: a full stop followed by a space, or a trailing one.
  if (/\.\s/.test(t) || /[.!?]$/.test(t)) return false;
  if (/[,;:]/.test(t)) return false;
  // Must contain a letter; "2026" or "—" is not a brand.
  return /[a-z\u0590-\u05ff]/i.test(t);
}

function mentionsCompany(haystack: string, name: string): boolean {
  const hay = normalizeCompany(haystack);
  const norm = normalizeCompany(name);
  if (!hay || !norm) return false;
  if (hay.includes(norm)) return true;
  // The distinctive first word is enough: "Votiro Cybersec" on a page titled
  // just "Votiro" is still their page.
  const first = norm.split(' ').filter((w) => w.length >= 3)[0];
  if (first && new RegExp(`\\b${first}\\b`).test(hay)) return true;
  return similarity(hay, norm) >= 0.8;
}

/**
 * Does this page belong to someone else now?
 *
 * `mismatch` is true only when none of the page's own brand strings name the
 * company. `successor` is filled only when a non-generic organisation name can
 * be read off the page, because "this page does not say your name" is far
 * weaker evidence than "this page says somebody else's".
 */
export function checkBrand(html: string, companyName: string): BrandCheck {
  const candidates = brandCandidates(html);
  if (candidates.length === 0) return { mismatch: false, successor: null, sawBrand: null };

  for (const c of candidates) {
    if (mentionsCompany(c, companyName)) return { mismatch: false, successor: null, sawBrand: c };
  }

  // Nobody named the company. Try to read off who the page does belong to:
  // the declared site name, or failing that the trailing title segment. The
  // whole title is never a brand — "Life at Menlo - Careers | Menlo Security"
  // names the page, the section and only then the company.
  const siteName = siteNameOf(html);
  const title = titleOf(html);
  const fromTitle = title ? titleSegments(title).pop() ?? null : null;
  for (const guess of [siteName, fromTitle]) {
    if (!guess) continue;
    const clean = guess.replace(/^(careers?|jobs?) (?:at|@) /i, '').trim();
    if (!clean || GENERIC_BRANDS.has(clean.toLowerCase())) continue;
    if (!looksLikeBrandName(clean)) continue;
    if (mentionsCompany(clean, companyName)) continue;
    return { mismatch: true, successor: clean, sawBrand: candidates[0] };
  }
  return { mismatch: true, successor: null, sawBrand: candidates[0] };
}

/**
 * True when a page looks like it has been taken over by a *named* other
 * organisation — the only case worth acting on automatically.
 */
export function looksAcquired(html: string, companyName: string): BrandCheck | null {
  const check = checkBrand(html, companyName);
  return check.mismatch && check.successor ? check : null;
}

/** Re-exported for callers that already hold a host rather than a page. */
export { hostLooksLikeCompany };
