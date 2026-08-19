/**
 * Parse a pasted block of contacts: one per line, LinkedIn URLs or phone numbers.
 *
 * Deliberately strict about what it accepts. A line it cannot classify is
 * reported with its number rather than being turned into a person named after
 * whatever was on it — a contact list quietly full of junk rows is worse than
 * being told line 14 didn't parse.
 */
import { normalizeLinkedinUrl, nameFromSlug } from './linkedin.js';
import { normalizePhone, phonePlaceholderName } from './phone.js';

export interface ParsedEntry {
  line: number;
  raw: string;
  kind: 'linkedin' | 'phone';
  /** Canonical LinkedIn URL, for `kind === 'linkedin'`. */
  linkedinUrl?: string;
  /** E.164 number, for `kind === 'phone'`. */
  phone?: string;
  /** Placeholder shown until the row is enriched or renamed. */
  placeholderName: string;
}

export interface RejectedEntry {
  line: number;
  raw: string;
  reason: string;
}

export interface BulkPasteResult {
  entries: ParsedEntry[];
  rejected: RejectedEntry[];
  /** Lines that appeared more than once in the paste itself. */
  duplicatesInPaste: number;
}

export function parseBulkPaste(text: string): BulkPasteResult {
  const entries: ParsedEntry[] = [];
  const rejected: RejectedEntry[] = [];
  const seen = new Set<string>();
  let duplicatesInPaste = 0;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    // Tolerate "Name, https://..." and comma- or tab-separated exports by taking
    // the first token that classifies.
    const raw = lines[i].trim();
    if (!raw) continue;

    const candidates = raw.split(/[,;\t]/).map((s) => s.trim()).filter(Boolean);
    const all = [raw, ...candidates];

    const url = all.map(normalizeLinkedinUrl).find((u): u is string => u !== null);
    if (url) {
      if (seen.has(url)) { duplicatesInPaste++; continue; }
      seen.add(url);
      entries.push({
        line, raw, kind: 'linkedin', linkedinUrl: url,
        placeholderName: nameFromSlug(url) ?? url.split('/in/')[1],
      });
      continue;
    }

    // Only try the phone reading on lines that have no URL at all, so a profile
    // URL containing digits is never mistaken for a number.
    if (!/https?:\/\//i.test(raw)) {
      const phone = all.map(normalizePhone).find((p): p is string => p !== null);
      if (phone) {
        if (seen.has(phone)) { duplicatesInPaste++; continue; }
        seen.add(phone);
        entries.push({ line, raw, kind: 'phone', phone, placeholderName: phonePlaceholderName(phone) });
        continue;
      }
    }

    rejected.push({
      line,
      raw,
      reason: /linkedin\.com/i.test(raw)
        ? 'LinkedIn link, but not to a personal profile (/in/…)'
        : 'Not a LinkedIn profile URL or a phone number',
    });
  }

  return { entries, rejected, duplicatesInPaste };
}
