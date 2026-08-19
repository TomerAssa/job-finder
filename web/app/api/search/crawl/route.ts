import { NextResponse } from 'next/server';
import { runSearcher } from '../../../../../src/agents/searcher/index.js';
import { db } from '@/lib/db';

/**
 * Crawl the careers pages of companies in the selected sectors.
 *
 * This spends real money — roughly two to four scrape credits per company — so
 * it is a route the user triggers, never something a page does on render. The
 * request reports what it cost and what it found rather than returning silently.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

/** Cap a single request. Crawling a whole sector is a CLI job, not a web one. */
const MAX_LIMIT = 60;

export async function POST(req: Request) {
  let body: { sectors?: number[]; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }

  const sectors = (body.sectors ?? []).filter(Number.isInteger);
  if (!sectors.length) {
    return NextResponse.json({ error: 'Pick at least one sector to crawl' }, { status: 400 });
  }

  const limit = Math.min(Math.max(1, body.limit ?? 20), MAX_LIMIT);
  const handle = db();

  const before = counts(handle, sectors);
  try {
    await runSearcher({ listIds: sectors, limit });
    const after = counts(handle, sectors);
    return NextResponse.json({
      crawled: after.checked - before.checked,
      newPositions: after.positions - before.positions,
      newTargetRoles: after.target - before.target,
      remaining: after.pending,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[search/crawl] failed:', err);
    // Auth failures abort the run with every company left untouched, which is
    // worth saying plainly rather than reporting as "found nothing".
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function counts(handle: ReturnType<typeof db>, sectors: number[]) {
  const inScope = `IN (SELECT company_id FROM company_list_members WHERE list_id IN (${sectors.map(() => '?').join(',')}))`;
  const one = (sql: string) => (handle.prepare(sql).get(...sectors) as { c: number }).c;
  return {
    checked: one(`SELECT COUNT(*) c FROM companies WHERE id ${inScope} AND status = 'checked'`),
    pending: one(`SELECT COUNT(*) c FROM companies WHERE id ${inScope} AND status != 'checked'`),
    positions: one(`SELECT COUNT(*) c FROM positions WHERE company_id ${inScope}`),
    target: one(`SELECT COUNT(*) c FROM positions WHERE company_id ${inScope} AND is_product = 1`),
  };
}
