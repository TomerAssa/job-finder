/**
 * Domain comparison, used to check that a LinkedIn company page really belongs
 * to the company we think it does.
 *
 * This is an approximation of the public suffix list: enough to tell
 * `careers.wiz.io` and `www.wiz.io` apart from `wiz-security.com`, without
 * pulling in a dependency that ships the whole PSL. Getting a two-part suffix
 * wrong (treating `co.il` as registrable) would make every Israeli company look
 * like every other, so those are listed explicitly.
 */

const MULTIPART_SUFFIXES = new Set([
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'muni.il', 'k12.il',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.cn', 'com.mx', 'com.sg',
  'co.jp', 'co.kr', 'co.nz', 'co.za', 'com.tr', 'co.in', 'com.hk',
]);

/** The hostname of a URL, lowercased and stripped of `www.`. Null if unparseable. */
export function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * The registrable domain: `careers.wiz.io` -> `wiz.io`, `jobs.acme.co.il` ->
 * `acme.co.il`. Null when the input is not a usable host.
 */
export function registrableDomain(raw: string | null | undefined): string | null {
  const host = hostOf(raw);
  if (!host) return null;
  // A bare IP or single label has no registrable domain to speak of.
  if (/^\d+(\.\d+)*$/.test(host)) return null;

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;

  const lastTwo = parts.slice(-2).join('.');
  if (MULTIPART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/** True when two URLs belong to the same registrable domain. */
export function sameDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return da !== null && da === db;
}
