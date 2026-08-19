import { NextResponse } from 'next/server';
import { activeRun, dueCount, getRun, latestRun, startRun, stopRun } from '../../../../../src/agents/searcher/crawlRun.js';

/**
 * Start, watch and stop a crawl.
 *
 * The work outlives the request that starts it, so this is three verbs over one
 * record rather than one long call: POST begins a run and returns immediately,
 * GET reports progress, DELETE asks it to stop after the chunk in flight.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id') ?? '');
  const run = Number.isInteger(id) && id > 0 ? getRun(id) : (activeRun() ?? latestRun());
  return NextResponse.json({ run });
}

export async function POST(req: Request) {
  let body: {
    sectors?: number[];
    targetCompanies?: number | null;
    creditLimit?: number | null;
    force?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }

  const sectors = (body.sectors ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (!sectors.length) {
    return NextResponse.json({ error: 'Pick at least one sector to search' }, { status: 400 });
  }

  try {
    const run = startRun({
      sectors,
      targetCompanies: body.targetCompanies ?? null,
      creditLimit: body.creditLimit ?? null,
      force: body.force === true,
    });
    return NextResponse.json({ run, due: dueCount(sectors, body.force === true) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id') ?? '');
  const run = Number.isInteger(id) && id > 0 ? getRun(id) : activeRun();
  if (!run) return NextResponse.json({ error: 'No run to stop' }, { status: 404 });
  stopRun(run.id);
  return NextResponse.json({ run: getRun(run.id) });
}
