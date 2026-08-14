import { NextResponse } from 'next/server';
import { purgeDemo } from '../../../../../src/demo/seed.js';

/**
 * Finish setup by clearing the demo data.
 *
 * A real route rather than a server action because it deletes rows: if it fails
 * the user has to know, not discover later that placeholders are still mixed in
 * with their contacts.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const removed = purgeDemo();
    return NextResponse.json({ removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[setup/complete] failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
