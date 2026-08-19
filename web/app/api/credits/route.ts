import { NextResponse } from 'next/server';
import { monthlyUsage } from '../../../../src/brightdata/client.js';
import { config } from '../../../../src/config.js';
import { db } from '@/lib/db';

/**
 * The scrape budget, so the cost of a crawl is visible before paying it.
 *
 * The per-company figure is measured, not guessed: this month's spend divided by
 * the companies actually visited this month. A hardcoded estimate would drift
 * from reality as the mix of ATS types changes, and would be wrong for anyone
 * else's setup.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Until there is enough history to measure, assume the middle of the range. */
const FALLBACK_PER_COMPANY = 3;
const MIN_SAMPLE = 15;

export async function GET() {
  const cap = config.brightData.monthlyLimit;

  let used = 0;
  let usageKnown = true;
  try {
    used = await monthlyUsage();
  } catch {
    // Redis is what counts spend; without it the cap cannot be enforced either.
    usageKnown = false;
  }

  const visitedThisMonth = (
    db()
      .prepare(
        `SELECT COUNT(*) c FROM check_log
          WHERE agent = 'searcher' AND status IN ('ok','error')
            AND started_at >= strftime('%Y-%m-01','now')`,
      )
      .get() as { c: number }
  ).c;

  const measured = usageKnown && visitedThisMonth >= MIN_SAMPLE ? used / visitedThisMonth : null;
  const perCompany = Math.max(1, Math.round((measured ?? FALLBACK_PER_COMPANY) * 10) / 10);

  return NextResponse.json({
    used,
    cap,
    remaining: cap > 0 ? Math.max(0, cap - used) : null,
    usageKnown,
    perCompany,
    // Says whether the number is measured or assumed, so the estimate can be
    // presented as what it is.
    basis: measured != null ? 'measured' : 'estimate',
    visitedThisMonth,
  });
}
