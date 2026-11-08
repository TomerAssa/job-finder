/**
 * Which hosts belong to a company, and which belong to everybody.
 *
 * Lives in `util` rather than inside the searcher because two different
 * questions need the same answer: the resolver must not accept an aggregator as
 * a company's careers page, and the lifecycle layer must not treat an
 * aggregator stored as a company's "website" as evidence that the company has
 * a site at all.
 */

/**
 * Hosts that list many companies' jobs, so a page on one is never *this*
 * company's careers page.
 *
 * Accepting one is not a cosmetic error: whatever roles the page happens to
 * show get scraped and filed under this company. That is how three openings at
 * Cyble arrived labelled "Cybool" — the resolver picked a LinkedIn jobs page
 * for a similarly-named company and an LLM read it as if it were the careers
 * site. Venture portfolio boards are the same trap wearing a company's domain.
 */
const JOB_BOARD_HOSTS =
  /linkedin\.|glassdoor\.|indeed\.|ziprecruiter\.|dice\.com|monster\.|wellfound\.|angel\.co|builtin\.|allremote\.|secretjobs\.|techaviv\.|crunchbase\.|portfoliojobs\.|\.vc$|\.vc\//i;

/** True when a URL lives on a multi-company job board rather than a company's own site or ATS. */
export function isJobBoardHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  // A venture fund's board is usually jobs.<fund>.com listing its portfolio.
  if (/^jobs\.(insightpartners|initialized|f2vc|jvpvc|decibel|greylock|sequoiacap|a16z|bvp|lightspeedvp|motion)\./i.test(host)) {
    return true;
  }
  return JOB_BOARD_HOSTS.test(host);
}

/** Hostname of a URL, or null when it is not a URL at all. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Words a company adds to its own name to get a registrable domain. Anything
 * longer or stranger than these is a different company that happens to start
 * the same way.
 */
const GENERIC_TAILS = new Set([
  '', 'ai', 'io', 'app', 'hq', 'inc', 'ltd', 'co', 'corp', 'group', 'labs', 'lab',
  'tech', 'technologies', 'technology', 'security', 'systems', 'system', 'software',
  'solutions', 'health', 'medical', 'med', 'bio', 'pharma', 'energy', 'global',
  'online', 'site', 'web', 'digital', 'cloud', 'data', 'robotics', 'israel',
]);

/** Subdomains that say what a page is for rather than whose it is. */
const ROLE_SUBDOMAINS = /^(www|jobs|careers|career|apply|boards|job|hire|hiring|work|en|il|he)\./i;

/**
 * The distinctive part of a hostname: `www.jobs.acme.co.il` -> `acme`.
 *
 * Two-part public suffixes (`co.il`, `com`, `ac.il`, `org.uk`) are stripped so
 * the comparison is against the registrable name rather than the country.
 */
export function hostLabel(host: string): string {
  let h = host.toLowerCase().replace(/\.$/, '');
  while (ROLE_SUBDOMAINS.test(h)) h = h.replace(ROLE_SUBDOMAINS, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length === 0) return '';
  // Drop the public suffix: two labels for the compound ones, otherwise one.
  const suffix2 = parts.slice(-2).join('.');
  const drop = /^(co|com|org|net|ac|gov|muni|idf)\.[a-z]{2}$/.test(suffix2) ? 2 : 1;
  const label = parts.slice(0, Math.max(1, parts.length - drop)).pop() ?? '';
  return label.replace(/[^a-z0-9]/g, '');
}

/**
 * Does this hostname plausibly belong to this company?
 *
 * The crawler stores the first non-social host a search returns as a company's
 * "website", which is frequently nobody's business but somebody else's: Aidoc
 * came back as google.com, Alma Lasers as pgcareers.com, Hazera as
 * greenhouse.com. The host is still worth showing — sometimes it is right — but
 * only alongside an honest answer to whether it matches the name.
 *
 * Deliberately a signal and not a filter. It is shown in the manual-dive queue,
 * where a human is already looking and a wrong guess costs a glance; it is not
 * used to park anything, where a wrong guess would be silent and permanent.
 */
export function hostLooksLikeCompany(
  host: string | null | undefined,
  companyName: string,
  similarity: (a: string, b: string) => number,
): boolean {
  if (!host) return false;
  const label = hostLabel(host);
  if (!label) return false;
  const name = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!name) return false;
  if (label === name) return true;

  // The two containment directions are not equally safe, and treating them as
  // if they were is the short-name trap: "rain" sits inside rainforest-alliance,
  // raincheck and rainguard alike, so a bare substring test hands one company
  // every host that merely starts the same way.
  //
  // A host SHORTER than the name is the safe direction — a company drops its
  // generic words to register a domain ("Pentera Security" -> pentera.io) — so
  // long as it is a prefix of the name rather than buried in it.
  if (label.length >= 3 && name.startsWith(label)) return true;

  // A host LONGER than the name is only believable when the extra is a generic
  // corporate tail: "Entro" -> entrosecurity.com, "Dream" -> dreamgroup.com.
  if (name.length >= 4 && label.startsWith(name)) {
    const tail = label.slice(name.length);
    if (GENERIC_TAILS.has(tail)) return true;
  }

  return similarity(name, label) >= 0.8;
}
