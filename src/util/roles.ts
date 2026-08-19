/**
 * Job-title matching.
 *
 * The pipeline used to answer exactly one question — "is this a Product Manager
 * role?" — because it had one user looking for one kind of job. Title is a search
 * parameter now, so matching is general, with the product-manager rules kept as
 * the default profile rather than the only behaviour.
 */

export interface TitleMatcher {
  /** Words that make a title a match. Substring, case- and punctuation-insensitive. */
  include: string[];
  /** Words that disqualify it even when an include matched. */
  exclude?: string[];
}

/** Lowercase, strip punctuation, pad with spaces so ` word ` boundaries work. */
function canon(title: string): string {
  return ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Does a title match? A term containing a space is matched as a phrase; a single
 * word must match a whole word, so "pm" never matches inside "pmo".
 */
export function matchesTitle(title: string | null | undefined, matcher: TitleMatcher): boolean {
  if (!title) return false;
  const t = canon(title);

  const hit = (term: string): boolean => {
    const needle = canon(term).trim();
    if (!needle) return false;
    return t.includes(` ${needle} `) || (needle.includes(' ') && t.includes(needle));
  };

  if (matcher.exclude?.some(hit)) return false;
  return matcher.include.some(hit);
}

/**
 * The default profile: product management in any flavour, deliberately excluding
 * adjacent-but-different roles that also contain the word "product".
 */
export const PRODUCT_MANAGER: TitleMatcher = {
  include: [
    'product manager', 'product owner', 'product management',
    'product lead', 'product leader',
    'associate product manager', 'apm',
    'senior product', 'staff product', 'group product', 'principal product',
    // "Product builder" is how a growing number of startups advertise a hands-on
    // PM role, especially where the job spans product and delivery.
    'product builder', 'product builders', 'founding product manager',
  ],
  exclude: [
    // Adjacent roles that contain "product" but are not product management.
    'product marketing', 'product design', 'product designer', 'product analyst',
    'product support', 'product specialist', 'product operations', 'product ops',
    'project manager', 'program manager',
    // Executive tier. Excluded deliberately: these are not reachable at the
    // experience level this search targets, and they crowd out the roles that are.
    'vp', 'vp product', 'vice president', 'svp', 'evp',
    'chief product officer', 'cpo', 'chief',
    'head of product', 'director of product', 'director product', 'director',
  ],
};

/** Kept for the many call sites that only ever ask the default question. */
export function isProductManager(title: string | null | undefined): boolean {
  return matchesTitle(title, PRODUCT_MANAGER);
}

/**
 * Build a matcher from free-text keywords typed into the search form.
 * With nothing typed, searching falls back to the product-manager profile.
 */
export function matcherFromKeywords(keywords: string[] | undefined | null): TitleMatcher {
  const include = (keywords ?? []).map((k) => k.trim()).filter(Boolean);
  return include.length ? { include } : PRODUCT_MANAGER;
}

/**
 * Does a role's experience requirement overlap the range the user asked for?
 *
 * A posting with no stated range always passes: most listings omit it, and
 * filtering them out would hide the majority of real matches. Absence of
 * evidence is not a mismatch.
 */
export function yearsOverlap(
  role: { minYears: number | null; maxYears: number | null },
  want: { minYears?: number | null; maxYears?: number | null },
): boolean {
  const wantMin = want.minYears ?? null;
  const wantMax = want.maxYears ?? null;
  if (wantMin == null && wantMax == null) return true;
  if (role.minYears == null && role.maxYears == null) return true;

  const roleLo = role.minYears ?? 0;
  const roleHi = role.maxYears ?? Number.POSITIVE_INFINITY;
  const wantLo = wantMin ?? 0;
  const wantHi = wantMax ?? Number.POSITIVE_INFINITY;

  return roleLo <= wantHi && wantLo <= roleHi;
}
