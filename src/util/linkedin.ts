/**
 * LinkedIn profile URLs are the strongest identity key we have for a person, so
 * they get canonicalized before they are stored or compared. The same profile
 * arrives as `linkedin.com/in/dana-cohen-1a2b3`, `www.linkedin.com/in/dana-cohen-1a2b3/`,
 * `https://il.linkedin.com/in/dana-cohen-1a2b3?originalSubdomain=il` and
 * `/pub/dana-cohen-1a2b3` depending on whether it came from a CSV export, a SERP
 * result, or a paste.
 */

const PROFILE_PATH = /\/(?:in|pub)\/([^/?#]+)/i;

/**
 * Canonical form: `https://www.linkedin.com/in/<slug>`. Returns null when the
 * string is not a LinkedIn profile URL (company pages, job posts, feed links).
 */
export function normalizeLinkedinUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/linkedin\.com/i.test(trimmed)) return null;

  const match = PROFILE_PATH.exec(trimmed);
  if (!match) return null;

  let slug = match[1].toLowerCase();
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* malformed escape — keep the raw slug */
  }
  slug = slug.replace(/\/+$/, '');
  if (!slug) return null;

  return `https://www.linkedin.com/in/${slug}`;
}

export function isLinkedinProfileUrl(raw: string | null | undefined): boolean {
  return normalizeLinkedinUrl(raw) !== null;
}

/** The slug of a canonical profile URL, or null. */
export function linkedinSlug(raw: string | null | undefined): string | null {
  const url = normalizeLinkedinUrl(raw);
  return url ? url.slice('https://www.linkedin.com/in/'.length) : null;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Best-effort display name from a profile slug: "dana-cohen-1a2b3" -> "Dana Cohen".
 *
 * This is a placeholder shown until enrichment fills in the real name — slugs are
 * frequently nicknames, transliterations, or nothing like the person's name. Never
 * treat the result as authoritative; it must not be used for identity matching.
 * Returns null when nothing name-shaped survives (all-numeric or hash-like slugs).
 */
export function nameFromSlug(raw: string | null | undefined): string | null {
  const slug = linkedinSlug(raw);
  if (!slug) return null;

  const words = slug
    .split(/[-_.]+/)
    .filter((w) => /^[a-z]+$/i.test(w) && w.length > 1);
  if (!words.length) return null;

  return words.slice(0, 3).map((w) => cap(w.toLowerCase())).join(' ');
}
