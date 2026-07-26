import { createHash } from 'node:crypto';
import { config, requireBrightData } from '../config.js';
import { redis } from '../redis.js';

const ENDPOINT = 'https://api.brightdata.com/request';

function cacheKey(zone: string, url: string, render: boolean): string {
  return `bd:${zone}:${render ? 'r:' : ''}${createHash('sha1').update(url).digest('hex')}`;
}

/** Redis key for this calendar month's billable-request counter. */
function monthKey(): string {
  const d = new Date();
  return `bd:count:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Current month's billable BrightData request count (0 if Redis unavailable). */
export async function monthlyUsage(): Promise<number> {
  try {
    return Number((await redis().get(monthKey())) ?? 0);
  } catch {
    return 0;
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
  opts: { cache?: boolean; render?: boolean } = {},
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
    if (used >= limit) {
      throw new Error(
        `BrightData monthly request cap reached (${used}/${limit}). ` +
          `Raise BRIGHTDATA_MONTHLY_LIMIT in .env or wait for the month to reset.`,
      );
    }
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.brightData.apiKey}`,
    },
    body: JSON.stringify({ zone, url, format: 'raw', ...(render ? { render: 'true' } : {}) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BrightData ${res.status} for ${url}: ${body.slice(0, 300)}`);
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
