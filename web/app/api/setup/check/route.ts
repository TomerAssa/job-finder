import { NextResponse } from 'next/server';
import { serpSearch } from '../../../../../src/brightdata/serp.js';
import { complete } from '../../../../../src/llm/provider.js';

/**
 * Prove the credentials actually work.
 *
 * Having a key in `.env` and having a key that BrightData still accepts are
 * different things — an expired token fails every request identically while
 * looking perfectly configured. So this makes one real request of each kind.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const lines: string[] = [];
  let ok = true;

  try {
    const hits = await serpSearch('site:linkedin.com/in product manager', 3);
    lines.push(`✓ Search works — ${hits.length} results`);
  } catch (err) {
    ok = false;
    lines.push(`✕ Search failed — ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const reply = await complete('Reply with the single word: ready', { temperature: 0 });
    lines.push(`✓ LLM replied — ${reply.trim().slice(0, 40)}`);
  } catch (err) {
    ok = false;
    lines.push(`✕ LLM failed — ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json({ ok, lines });
}
