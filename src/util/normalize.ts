import { distance } from 'fastest-levenshtein';

const LEGAL_SUFFIXES = [
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'plc', 'sa', 'ag', 'srl', 'bv', 'nv',
];

/**
 * Normalize a company name for fuzzy matching: lowercase, strip accents,
 * drop legal suffixes and punctuation, collapse whitespace.
 * "Wiz, Inc." and "wiz" both -> "wiz".
 */
export function normalizeCompany(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();

  const words = s.split(' ').filter((w) => w && !LEGAL_SUFFIXES.includes(w));
  return words.join(' ').trim();
}

/**
 * Normalize a PERSON name for matching. Unlike normalizeCompany this keeps
 * non-Latin letters (Hebrew, etc.) — it only lowercases, strips punctuation,
 * and collapses whitespace. "יוסי רחמן" and "יוסי  רחמן" both -> "יוסי רחמן".
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Similarity in [0,1] based on Levenshtein distance over normalized strings.
 * 1 = identical after normalization.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = distance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 0 : 1 - d / maxLen;
}
