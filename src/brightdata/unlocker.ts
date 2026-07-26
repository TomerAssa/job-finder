import { config } from '../config.js';
import { brightDataRequest } from './client.js';

/**
 * Fetch a URL's HTML through the BrightData Web Unlocker zone.
 * `render: true` forces JS execution (for SPA career portals) — slower/costlier,
 * so callers use it only as a fallback when the plain fetch yields no jobs.
 */
export async function fetchPage(url: string, opts: { render?: boolean } = {}): Promise<string> {
  return brightDataRequest(config.brightData.unlockerZone, url, { render: opts.render });
}
