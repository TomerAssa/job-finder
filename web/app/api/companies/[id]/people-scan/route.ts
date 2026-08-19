import { NextResponse } from 'next/server';
import { findPeople } from '../../../../../../src/agents/people/index.js';
import { ROLE_PRESETS } from '../../../../../../src/agents/people/roles.js';

/**
 * Search LinkedIn for people worth talking to at a company.
 *
 * A real route, not a server action, because it scrapes: it is slow, it spends
 * credits, and it fails in ways the user has to see. The previous implementation
 * was a server action that spawned `npx tsx src/cli.ts` and parsed stdout inside
 * a bare `catch { return [] }` — every failure, from a missing API key to a
 * crashed subprocess, rendered as "No public profiles found". It had never once
 * succeeded.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** The presets, so the UI does not keep its own copy that can drift. */
export async function GET() {
  return NextResponse.json({
    presets: ROLE_PRESETS.map(({ key, label, why }) => ({ key, label, why })),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const companyId = Number(id);
  if (!Number.isInteger(companyId)) {
    return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
  }

  let body: { roleKeys?: string[]; customTitles?: string[]; location?: string; skipVerification?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body means "use the defaults" */
  }

  try {
    const result = await findPeople(companyId, {
      roleKeys: body.roleKeys,
      customTitles: body.customTitles,
      location: body.location ?? null,
      skipVerification: body.skipVerification,
    });
    return NextResponse.json({
      candidates: result.candidates,
      found: result.candidates.length,
      verification: result.verification,
      partialFailures: result.partialFailures,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[people-scan] company ${companyId} failed:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
