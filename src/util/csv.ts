import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/** Parse a CSV file into an array of row objects keyed by header. */
export function readCsv(path: string, fromLine = 1): Record<string, string>[] {
  const content = readFileSync(path, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true, // Startup Nation export puts quotes inside ="..." fields
    bom: true,
    from_line: fromLine,
  }) as Record<string, string>[];
}

/**
 * Strip Excel's text-guard wrapper: `="Aryon Security"` -> `Aryon Security`,
 * `=""` -> ``. Leaves normal values untouched.
 */
export function unwrapExcel(v: string): string {
  const s = v.trim();
  if (s.startsWith('="') && s.endsWith('"') && s.length >= 3) return s.slice(2, -1);
  return s;
}

/** Raw text of a file (used to locate LinkedIn's header line past its preamble). */
export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}
