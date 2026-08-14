import { NextResponse } from 'next/server';
import { findPeople } from '../../../../../../src/agents/people/index.js';

/**
 * Search LinkedIn for product and HR people at a company.
 *
 * This is a real route, not a server action, because it scrapes: it is slow, it
 * spends credits, and it fails in ways the user has to see. The previous
 * implementation was a server action that spawned `npx tsx src/cli.ts` and
 * parsed stdout inside a bare `catch { return [] }` — every failure, from a
 * missing API key to a crashed subprocess, rendered as "No public profiles
 * found". It had never once succeeded.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const companyId = Number(id);
  if (!Number.isInteger(companyId)) {
    return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
  }

  try {
    const candidates = await findPeople(companyId);
    return NextResponse.json({ candidates, found: candidates.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[people-scan] company ${companyId} failed:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
