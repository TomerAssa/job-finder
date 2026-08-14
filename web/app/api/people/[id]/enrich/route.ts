import { NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { enrichLinkedinProfile } from '../../../../../../src/agents/people/enrichProfile.js';

/**
 * Read one person's public LinkedIn profile and fill in what is missing.
 *
 * One person per request so the client can render progress across a batch and
 * retry individual failures. Costs a scrape credit, so it is only ever called
 * from an explicit user action.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const personId = Number(id);
  if (!Number.isInteger(personId)) {
    return NextResponse.json({ error: 'Invalid person id' }, { status: 400 });
  }

  const r = repo();
  const person = r.getPerson(personId);
  if (!person) return NextResponse.json({ error: 'No such person' }, { status: 404 });
  if (!person.linkedin_url) {
    return NextResponse.json({ error: 'This person has no LinkedIn URL to read' }, { status: 400 });
  }

  try {
    const facts = await enrichLinkedinProfile(person.linkedin_url);

    // The name is the one field worth overwriting: what is there is a slug-derived
    // placeholder this endpoint exists to replace. Everything else goes through
    // upsertPerson, which fills empty columns only and never clobbers user edits.
    if (facts.name && person.origin === 'bulk_paste') {
      r.updatePerson(personId, { full_name: facts.name });
    }
    r.upsertPerson({
      full_name: facts.name ?? person.full_name,
      linkedin_url: person.linkedin_url,
      role: facts.role,
      company: facts.company,
    });

    const updated = r.getPerson(personId)!;
    return NextResponse.json({
      id: personId,
      name: updated.full_name,
      role: updated.role,
      company: facts.company,
      source: facts.source,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[enrich] person ${personId} failed:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
