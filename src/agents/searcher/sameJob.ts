/**
 * Deciding whether two rows describe the same opening.
 *
 * A company's careers page is read by several extractors — the ATS API, JSON-LD,
 * the rendered page, an embedded iframe, LinkedIn — and each may see the same
 * job. They disagree about the URL, and some produce none at all, so matching on
 * (title, url) counts one opening several times.
 *
 * Two rows with the same title at the same company are the same job unless there
 * is positive evidence otherwise: both carry a URL, from the same source, and
 * those URLs identify different postings. That is the case where a company
 * really is advertising two openings with one title.
 */

export interface JobRef {
  title: string;
  url: string | null;
  source: string | null;
}

export const normalizeTitle = (t: string): string =>
  t.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The identifying tail of a posting URL — usually the board's own job id.
 * Comeet publishes the same job under several account slugs, so the id matters
 * and the path leading to it does not.
 */
export function postingId(url: string | null): string | null {
  if (!url) return null;
  const clean = url.split(/[?#]/)[0].replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  // A trailing slug with no digits is a title, not an id, and titles are
  // already being compared.
  return /\d/.test(last) ? last : null;
}

export function isSameJob(a: JobRef, b: JobRef): boolean {
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false;

  // One side never gave a URL: it is a weaker sighting of the same posting.
  if (!a.url || !b.url) return true;

  // Different extractors reading the same careers page.
  if (a.source !== b.source) return true;

  if (a.url === b.url) return true;

  const idA = postingId(a.url);
  const idB = postingId(b.url);
  // Same board id under different account slugs is one job; different ids from
  // the same board are two.
  if (idA && idB) return idA === idB;

  return false;
}
