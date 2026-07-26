import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { paths } from '../config.js';

const cachePath = resolve(paths.outputDir, 'cv.txt');

/** Extract text from the CV PDF and cache it to data/output/cv.txt. */
export async function ingestCv(path: string): Promise<{ chars: number; cachePath: string }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const buf = await readFile(path);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  const clean = (Array.isArray(text) ? text.join('\n') : text).replace(/\n{3,}/g, '\n\n').trim();

  await mkdir(paths.outputDir, { recursive: true });
  await writeFile(cachePath, clean, 'utf8');
  return { chars: clean.length, cachePath };
}

/** Read the cached CV text (run `ingest` first). */
export async function getCvText(): Promise<string> {
  if (!existsSync(cachePath)) {
    throw new Error('CV text not found. Run `npm run ingest` first (needs data/input/cv.pdf).');
  }
  return readFile(cachePath, 'utf8');
}
