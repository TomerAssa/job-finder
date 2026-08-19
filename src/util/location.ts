/**
 * Location matching for job listings.
 *
 * Listings almost never state a country. The same city appears as "Tel Aviv",
 * "tel aviv", "Tel Aviv-Yafo" and "Tel Aviv-Yafo, Tel Aviv District, Israel",
 * and plenty say only "Herzliya". Filtering on the text alone therefore misses
 * most of what the user means when they ask for Israel.
 *
 * Two signals are combined: the `is_israel` flag the enrichment step derives
 * from the full listing, which is authoritative when present, and a city list
 * for everything not yet enriched.
 */

const norm = (s: string | null | undefined): string =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Places that mean "Israel" on a job listing. Hebrew spellings included because
 * some boards post in Hebrew, and the tool keeps Hebrew throughout.
 */
const ISRAEL_PLACES = [
  'israel', 'ישראל',
  'tel aviv', 'tel aviv yafo', 'telaviv', 'tlv', 'תל אביב',
  'jerusalem', 'ירושלים',
  'haifa', 'חיפה',
  'herzliya', 'herzeliya', 'הרצליה',
  'ramat gan', 'רמת גן',
  'petah tikva', 'petach tikva', 'פתח תקווה',
  'netanya', 'נתניה',
  'beer sheva', 'beersheba', 'באר שבע',
  'raanana', 'ra anana', 'רעננה',
  'rehovot', 'רחובות',
  'hod hasharon', 'הוד השרון',
  'kfar saba', 'כפר סבא',
  'givatayim', 'גבעתיים',
  'holon', 'חולון',
  'rishon lezion', 'ראשון לציון',
  'yokneam', 'יקנעם',
  'caesarea', 'קיסריה',
  'modiin', 'מודיעין',
  'ness ziona', 'נס ציונה',
  'airport city', 'ramat hachayal', 'sharon', 'hasharon',
];

/** Countries we can resolve from a city list, keyed by how a user might type them. */
const COUNTRY_PLACES: Record<string, string[]> = {
  israel: ISRAEL_PLACES,
};

/** Resolve free text to a country key, or null when it is a city or region. */
export function countryKey(raw: string | null | undefined): string | null {
  const n = norm(raw);
  if (!n) return null;
  if (n === 'israel' || n === 'ישראל' || n === 'il') return 'israel';
  return null;
}

export interface LocatedRole {
  /** The listing's own location text, however it was written. */
  location: string | null;
  /** From enrichment: 1 in Israel, 0 elsewhere, null not yet determined. */
  isIsrael: number | null;
}

/**
 * Does a role match the requested location?
 *
 * An empty request matches everything. Asking for a country uses the enriched
 * flag first and falls back to the city list, so "Herzliya" counts as Israel and
 * "London" does not. Asking for anything else is a plain text match, which is
 * what someone typing a specific city wants.
 */
export function matchesLocation(role: LocatedRole, want: string | null | undefined): boolean {
  const wanted = norm(want);
  if (!wanted) return true;

  const country = countryKey(wanted);
  const haystack = norm(role.location);

  if (country) {
    // The enrichment flag read the whole listing, so it beats the location line.
    if (role.isIsrael === 1) return true;
    if (role.isIsrael === 0) return false;
    if (!haystack) return false;
    return COUNTRY_PLACES[country].some((place) => haystack.includes(place));
  }

  if (!haystack) return false;
  return haystack.includes(wanted);
}

/** Every place name that counts as the given country — for explaining the filter. */
export function placesFor(country: string): string[] {
  return COUNTRY_PLACES[country] ?? [];
}
