import { NextResponse } from 'next/server';
import { runSearcher } from '../../../../../src/agents/searcher/index.js';
import { runEnrich } from '../../../../../src/agents/enrich/index.js';
import { monthlyUsage } from '../../../../../src/brightdata/client.js';
import { db } from '@/lib/db';

/**
 * Find roles that are not in the database yet.
 *
 * This is the expensive half of searching — it visits careers pages and spends
 * scrape credits — so it only ever runs from an explicit action, and reports what
 * it actually cost rather than an estimate.
 *
 * Enrichment runs straight afterwards on what was found. It costs no scrape
 * credits, and without it new roles have no experience range or resolved
 * location, which makes exactly the filters the user came here for do nothing.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

/** One request stays a batch. Whole sectors are long jobs, run repeatedly. */
const MAX_LIMIT = 60;

export async function POST(req: Request) {
  let body: { sectors?: number[]; limit?: number; enrich?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }

  const sectors = (body.sectors ?? []).filter(Number.isInteger);
  if (!sectors.length) {
    return NextResponse.json({ error: 'Pick at least one sector to search' }, { status: 400 });
  }

  const limit = Math.min(Math.max(1, body.limit ?? 20), MAX_LIMIT);
  const handle = db();
  const before = counts(handle, sectors);
  const spentBefore = await usage();

  try {
    await runSearcher({ listIds: sectors, limit });

    // Only the newly-found roles, and only when asked: this is Gemini time, and
    // on a big batch it is the slow part.
    let enriched = 0;
    if (body.enrich !== false) {
      const pending = countUnenriched(handle, sectors);
      if (pending > 0) {
        await runEnrich({ limit: Math.min(pending, 120) });
        enriched = pending - countUnenriched(handle, sectors);
      }
    }

    const after = counts(handle, sectors);
    const spentAfter = await usage();

    return NextResponse.json({
      visited: after.visited - before.visited,
      newPositions: after.positions - before.positions,
      newTargetRoles: after.target - before.target,
      enriched,
      remaining: after.pending,
      creditsUsed: spentBefore != null && spentAfter != null ? spentAfter - spentBefore : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[search/crawl] failed:', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function usage(): Promise<number | null> {
  try {
    return await monthlyUsage();
  } catch {
    return null;
  }
}

function scope(sectors: number[]): string {
  return `IN (SELECT company_id FROM company_list_members WHERE list_id IN (${sectors.map(() => '?').join(',')}))`;
}

function countUnenriched(handle: ReturnType<typeof db>, sectors: number[]): number {
  return (
    handle
      .prepare(
        `SELECT COUNT(*) c FROM positions p
           LEFT JOIN position_requirements r ON r.position_id = p.id
          WHERE p.company_id ${scope(sectors)} AND p.is_product = 1 AND r.position_id IS NULL`,
      )
      .get(...sectors) as { c: number }
  ).c;
}

function counts(handle: ReturnType<typeof db>, sectors: number[]) {
  const inScope = scope(sectors);
  const one = (sql: string) => (handle.prepare(sql).get(...sectors) as { c: number }).c;
  return {
    visited: one(`SELECT COUNT(*) c FROM companies WHERE id ${inScope} AND status = 'checked'`),
    pending: one(`SELECT COUNT(*) c FROM companies WHERE id ${inScope} AND status != 'checked'`),
    positions: one(`SELECT COUNT(*) c FROM positions WHERE company_id ${inScope}`),
    target: one(`SELECT COUNT(*) c FROM positions WHERE company_id ${inScope} AND is_product = 1`),
  };
}
