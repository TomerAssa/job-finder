import { readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Write rows as a CSV, taking the header from the first row's keys.
 *
 * The data is mixed Hebrew/English, so a BOM goes on the front: without it
 * Excel on Windows opens a UTF-8 file as Latin-1 and the Hebrew columns arrive
 * as mojibake, which looks like a scraper bug rather than a spreadsheet one.
 */
export function writeCsv(path: string, rows: Record<string, unknown>[]): number {
  if (rows.length === 0) {
    writeFileSync(path, '﻿', 'utf8');
    return 0;
  }
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))];
  writeFileSync(path, '﻿' + body.join('\n') + '\n', 'utf8');
  return rows.length;
}

/** Raw text of a file (used to locate LinkedIn's header line past its preamble). */
export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}
