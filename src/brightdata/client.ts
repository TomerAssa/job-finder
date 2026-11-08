import { createHash } from 'node:crypto';
import { config, requireBrightData } from '../config.js';
import { redis } from '../redis.js';

const ENDPOINT = 'https://api.brightdata.com/request';

/**
 * Credentials are wrong or expired. Distinct from a normal request failure
 * because retrying, or carrying on with the next company, cannot help: every
 * subsequent request will fail the same way.
 */
export class BrightDataAuthError extends Error {
  readonly isAuthError = true;
  constructor(message: string) {
    super(message);
    this.name = 'BrightDataAuthError';
  }
}

/**
 * Transient zone failures. BrightData's SERP zone returns these intermittently
 * for a query that succeeds on the next attempt — an unlucky proxy exit, a
 * consent redirect, a page that rendered too slowly. Observed in the wild as
 * "No ready cookies", "redirect location was rejected", and selector timeouts.
 * Retrying is the correct response; reporting a hard failure is not.
 */
const TRANSIENT = /no ready cookies|redirect location was rejected|waiting for selector|timeout|temporarily|try again|502|503|504/i;

export function isTransientError(err: unknown): boolean {
  if (isAuthError(err)) return false;
  return err instanceof Error && TRANSIENT.test(err.message);
}

/** True for an auth failure anywhere in a wrapped error chain. */
export function isAuthError(err: unknown): boolean {
  return err instanceof BrightDataAuthError
    || (err instanceof Error && /BrightData (401|403)|Token expired|auth failed/i.test(err.message));
}

/** Said once per process: a warning per request would drown the run log. */
let warnedAboutUncountedSpend = false;
function warnUncountedSpend(): void {
  if (warnedAboutUncountedSpend) return;
  warnedAboutUncountedSpend = true;
  console.warn(
    '⚠️  Redis is unreachable, so spend cannot be counted and BRIGHTDATA_MONTHLY_LIMIT ' +
      'is not being enforced. Responses are not being cached either, so re-crawls ' +
      'cost full price. Start it with `docker compose up -d redis`.',
  );
}

function cacheKey(zone: string, url: string, render: boolean): string {
  return `bd:${zone}:${render ? 'r:' : ''}${createHash('sha1').update(url).digest('hex')}`;
}

/** Redis key for this calendar month's billable-request counter. */
function monthKey(): string {
  const d = new Date();
  return `bd:count:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Billable requests counted this month, or null when that cannot be known.
 *
 * The distinction matters more than it looks. This used to return 0 on a Redis
 * failure, which is indistinguishable from "nothing spent yet" — so with Redis
 * down the cap below never triggered and the console reported a full budget
 * while money was going out. A number nobody can vouch for is worse than no
 * number.
 */
export async function monthlyUsage(): Promise<number | null> {
  try {
    return Number((await redis().get(monthKey())) ?? 0);
  } catch {
    return null;
  }
}

/**
 * Core BrightData "request" call, shared by SERP and Web Unlocker.
 * Checks the Redis response cache first (to avoid re-billing), then calls the API.
 * `format` "raw" returns page text/HTML; the SERP layer appends brd_json=1 for JSON.
 */
export async function brightDataRequest(
  zone: string,
  url: string,
  opts: { cache?: boolean; render?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  requireBrightData();
  const render = opts.render === true;
  const useCache = opts.cache !== false && config.responseCacheHours > 0;
  const key = cacheKey(zone, url, render);

  if (useCache) {
    try {
      const hit = await redis().get(key);
      if (hit !== null) return hit;
    } catch {
      /* cache miss on Redis error */
    }
  }

  // Enforce the monthly cap BEFORE spending a billable request.
  const limit = config.brightData.monthlyLimit;
  if (limit > 0) {
    const used = await monthlyUsage();
    if (used == null) {
      // Requests still go out — Redis is documented as optional — but the guard
      // the user configured is not working, and that has to be said rather than
      // discovered on a bill.
      warnUncountedSpend();
    } else if (used >= limit) {
      throw new Error(
        `BrightData monthly request cap reached (${used}/${limit}). ` +
          `Raise BRIGHTDATA_MONTHLY_LIMIT in .env or wait for the month to reset.`,
      );
    }
  }

  // Never hang. There was no timeout here at all, and it cost nine hours: the
  // careers-page probe fetches company domains directly, dead startup domains
  // take upwards of 100 seconds to give up, and 213 companies at up to three
  // paths each turned a two-hour crawl into an overnight one. A request that
  // has not answered by now is not going to.
  const ctrl = new AbortController();
  const budget = opts.timeoutMs ?? config.brightData.timeoutMs;
  const timer = setTimeout(() => ctrl.abort(), budget);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.brightData.apiKey}`,
      },
      body: JSON.stringify({ zone, url, format: 'raw', ...(render ? { render: 'true' } : {}) }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Reported as a timeout, which `isTransientError` already treats as worth
    // retrying — and which callers must not read as "this page does not exist".
    if (ctrl.signal.aborted) throw new Error(`BrightData timeout after ${budget}ms for ${url}`);
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const message = `BrightData ${res.status} for ${url}: ${body.slice(0, 300)}`;
    // An expired or wrong token fails identically for every request. Callers
    // that treat a fetch failure as "nothing found" would otherwise mark
    // thousands of companies checked without a single one having been checked,
    // so this is flagged as fatal for them to abort on.
    if (res.status === 401 || res.status === 403) throw new BrightDataAuthError(message);
    throw new Error(message);
  }

  // BrightData returns HTTP 200 even when the proxy denies the request — the real
  // outcome is in x-brd-* headers. Surface those instead of caching an empty body.
  const brdErr = res.headers.get('x-brd-err-msg') || res.headers.get('x-brd-error');
  if (brdErr) {
    const code = res.headers.get('x-brd-err-code') ?? '';
    throw new Error(`BrightData zone "${zone}" error ${code}: ${brdErr}`);
  }

  const text = await res.text();

  // Count this billable request (we only reach here on a cache miss).
  try {
    const k = monthKey();
    const n = await redis().incr(k);
    if (n === 1) await redis().expire(k, 40 * 86_400); // auto-clear old months
  } catch {
    /* non-fatal: without Redis we can't count, cap is best-effort */
  }

  if (useCache) {
    try {
      await redis().set(key, text, 'EX', config.responseCacheHours * 3600);
    } catch {
      /* non-fatal */
    }
  }
  return text;
}
