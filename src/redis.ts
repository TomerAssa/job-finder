import Redis from 'ioredis';
import { config } from './config.js';

let _redis: Redis | null = null;

export function redis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  _redis.on('error', (err) => {
    // Keep noise low; a single warning is enough for a CLI.
    if ((_redis as any)?._warned) return;
    (_redis as any)._warned = true;
    console.warn(`⚠️  Redis error (${config.redisUrl}): ${err.message}`);
  });
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => _redis?.disconnect());
    _redis = null;
  }
}

/** True if the company was checked within CHECK_TTL_DAYS (dedup across runs). */
export async function isFresh(companyId: number): Promise<boolean> {
  try {
    return (await redis().exists(`checked:${companyId}`)) === 1;
  } catch {
    return false; // Redis down -> never skip, just re-check.
  }
}

export async function markFresh(companyId: number, ttlDays: number): Promise<void> {
  try {
    await redis().set(`checked:${companyId}`, Date.now(), 'EX', Math.max(1, ttlDays) * 86_400);
  } catch {
    /* non-fatal */
  }
}
