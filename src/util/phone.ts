/**
 * Phone numbers are one of the three identity keys for a person, so they need a
 * single canonical form or the unique index is worthless: "054-123-4567",
 * "+972 54 123 4567" and "00972541234567" are the same human.
 *
 * We normalize to E.164 without a full libphonenumber dependency — the tool is
 * local-first and the input is hand-typed contacts, not billing data. Numbers
 * written without a country code are assumed to be in `DEFAULT_COUNTRY_CODE`
 * (Israel unless configured otherwise).
 */

const defaultCc = (): string => (process.env.DEFAULT_COUNTRY_CODE ?? '972').replace(/\D/g, '');

/**
 * Returns the number in E.164 ("+972541234567"), or null if it can't plausibly
 * be a phone number. Never throws — callers treat null as "not a phone".
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (/[a-z]/i.test(trimmed.replace(/^tel:/i, ''))) return null; // URLs, emails, names

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // A national number is at least 7 digits. Checking this BEFORE prepending a
  // country code matters: without it, "12345" becomes "+97212345" and a stray
  // number in a paste turns into a contact.
  const MIN_NATIONAL = 7;

  if (!hasPlus && digits.startsWith('00')) {
    digits = digits.slice(2); // international prefix
  } else if (!hasPlus && digits.startsWith('0')) {
    const national = digits.replace(/^0+/, '');
    if (national.length < MIN_NATIONAL) return null;
    digits = defaultCc() + national; // national trunk prefix
  } else if (!hasPlus && digits.length <= 10) {
    if (digits.length < MIN_NATIONAL) return null;
    digits = defaultCc() + digits; // bare local number
  }

  // E.164 allows at most 15 digits; anything under 8 is a fragment, not a number.
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** True when the string looks like a phone number rather than a URL or a name. */
export function isPhone(raw: string | null | undefined): boolean {
  return normalizePhone(raw) !== null;
}

/** Human-readable placeholder for a contact we only have a number for. */
export function phonePlaceholderName(e164: string): string {
  return `Unknown (${e164})`;
}
