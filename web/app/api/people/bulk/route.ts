import { NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { parseBulkPaste } from '../../../../../src/util/bulkPaste.js';

/**
 * Create people from a pasted block of LinkedIn URLs and phone numbers.
 *
 * Rows are created immediately from what was pasted and returned straight away —
 * enrichment is a separate call per person so the client can show progress, count
 * what it spends, and retry the ones that fail. Pasting 30 URLs must not be one
 * request that either takes two minutes or dies halfway with nothing saved.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface BulkCreated {
  id: number;
  placeholderName: string;
  linkedinUrl?: string;
  phone?: string;
  created: boolean;
  needsEnrichment: boolean;
}

export async function POST(req: Request) {
  let text = '';
  try {
    ({ text = '' } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "text" field' }, { status: 400 });
  }

  const parsed = parseBulkPaste(text);
  if (!parsed.entries.length) {
    return NextResponse.json({
      created: [], added: 0, existing: 0,
      rejected: parsed.rejected, duplicatesInPaste: parsed.duplicatesInPaste,
    });
  }

  const r = repo();
  const created: BulkCreated[] = [];
  let added = 0;
  let existing = 0;

  for (const e of parsed.entries) {
    const result = r.upsertPerson({
      full_name: e.placeholderName,
      linkedin_url: e.linkedinUrl ?? null,
      phone: e.phone ?? null,
      origin: 'bulk_paste',
    });
    if (result.created) added++;
    else existing++;

    const person = r.getPerson(result.id);
    created.push({
      id: result.id,
      placeholderName: person?.full_name ?? e.placeholderName,
      linkedinUrl: e.linkedinUrl,
      phone: e.phone,
      created: result.created,
      // Only newly-created LinkedIn rows are worth spending a credit on: an
      // existing person already has whatever the user or an earlier run filled in.
      needsEnrichment: e.kind === 'linkedin' && result.created,
    });
  }

  return NextResponse.json({
    created, added, existing,
    rejected: parsed.rejected,
    duplicatesInPaste: parsed.duplicatesInPaste,
  });
}
