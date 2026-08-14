/**
 * Fill in a person from their public LinkedIn profile.
 *
 * A pasted URL gives you a slug and nothing else — and slugs are frequently
 * nicknames, transliterations, or a hash. This turns one into a real name, role
 * and company so the person is worth having in the list.
 *
 * Two routes, cheapest-first:
 *   1. The public profile page through the Web Unlocker. Its `<title>` is
 *      reliably "Name - Role - Company | LinkedIn" when the page renders.
 *   2. A search for the profile, whose result title carries the same string.
 *      This is the fallback for the login wall.
 *
 * Both are best-effort by nature. A failure is reported, never guessed around —
 * the caller keeps the slug-derived placeholder and offers a retry.
 */
import { fetchPage } from '../../brightdata/unlocker.js';
import { serpSearch } from '../../brightdata/serp.js';
import { linkedinSlug, nameFromSlug, normalizeLinkedinUrl } from '../../util/linkedin.js';

export interface ProfileFacts {
  name: string | null;
  role: string | null;
  company: string | null;
  /** Where the facts came from, so the UI can be honest about confidence. */
  source: 'profile_page' | 'search' | 'slug';
}

/** Titles look like "Dana Cohen - Group Product Manager - Wiz | LinkedIn". */
export function parseProfileTitle(title: string): { name: string | null; role: string | null; company: string | null } {
  const cleaned = title
    .replace(/\s*\|\s*LinkedIn\s*$/i, '')
    .replace(/\s*-\s*LinkedIn\s*$/i, '')
    .trim();
  if (!cleaned) return { name: null, role: null, company: null };

  const parts = cleaned.split(/\s+[-–—|]\s+/).map((s) => s.trim()).filter(Boolean);
  const name = parts[0] && parts[0].length <= 60 ? parts[0] : null;

  // "Role at Company" collapses into one segment often enough to be worth handling.
  if (parts.length === 2) {
    const at = parts[1].split(/\s+\bat\b\s+/i);
    if (at.length === 2) return { name, role: at[0].trim(), company: at[1].trim() };
    return { name, role: parts[1], company: null };
  }

  return {
    name,
    role: parts[1] ?? null,
    company: parts[2] ?? null,
  };
}

const titleOf = (html: string): string | null => {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!t) return null;
  return t[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim();
};

const isLoginWall = (title: string | null): boolean =>
  !title || /^(sign up|join linkedin|linkedin|log in|sign in)/i.test(title);

/**
 * Look up one profile. Throws when both routes fail, so the caller can show why
 * rather than silently keeping a slug as somebody's name.
 */
export async function enrichLinkedinProfile(rawUrl: string): Promise<ProfileFacts> {
  const url = normalizeLinkedinUrl(rawUrl);
  if (!url) throw new Error(`Not a LinkedIn profile URL: ${rawUrl}`);
  const slug = linkedinSlug(url)!;

  const failures: string[] = [];

  try {
    const title = titleOf(await fetchPage(url));
    if (!isLoginWall(title)) {
      const facts = parseProfileTitle(title!);
      if (facts.name) return { ...facts, source: 'profile_page' };
      failures.push('profile page had no usable title');
    } else {
      failures.push('profile page returned a login wall');
    }
  } catch (err) {
    failures.push(`profile fetch: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const results = await serpSearch(`site:linkedin.com/in/${slug}`, 5);
    const hit = results.find((r) => normalizeLinkedinUrl(r.url) === url) ?? results[0];
    if (hit) {
      const facts = parseProfileTitle(hit.title);
      if (facts.name) return { ...facts, source: 'search' };
      failures.push('search result had no usable title');
    } else {
      failures.push('search returned no results');
    }
  } catch (err) {
    failures.push(`search: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(`Could not read ${url} — ${failures.join('; ')}`);
}

/** The placeholder used until enrichment succeeds. Never treated as a real name. */
export function placeholderFromUrl(rawUrl: string): ProfileFacts {
  return { name: nameFromSlug(rawUrl), role: null, company: null, source: 'slug' };
}
