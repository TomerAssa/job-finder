import { config } from '../config.js';
import { brightDataRequest, isTransientError } from './client.js';

export interface SerpResult {
  title: string;
  url: string;
  description?: string;
}

/**
 * Two search backends:
 *  - "serp": a dedicated BrightData SERP API zone (Google + brd_json structured JSON).
 *  - "unlocker": no SERP zone — run the search through the Web Unlocker zone against
 *    DuckDuckGo's lightweight HTML endpoint and parse results ourselves.
 * Mode is chosen automatically: unlocker mode when no distinct SERP zone is set.
 */
export function serpMode(): 'serp' | 'unlocker' {
  const { serpZone, unlockerZone } = config.brightData;
  return !serpZone || serpZone === unlockerZone ? 'unlocker' : 'serp';
}

/**
 * Run a search, retrying the transient zone failures.
 *
 * The SERP zone intermittently rejects a query it will happily answer a moment
 * later. Without this, a company that is perfectly findable fails its identity
 * check on an unlucky proxy exit and every person found there gets marked
 * unverified — a wrong answer caused by infrastructure, not by the data.
 */
export async function serpSearch(query: string, num = 10, attempts = 3): Promise<SerpResult[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return serpMode() === 'unlocker'
        ? await searchViaUnlocker(query, num)
        : await searchViaSerpZone(query, num);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === attempts) throw err;
      // Short, growing pause: these clear in seconds, and the caller is usually
      // in a queue that should not stall on one unlucky query.
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

// ── Dedicated SERP API zone (Google, structured) ─────────────────────────────
async function searchViaSerpZone(query: string, num: number): Promise<SerpResult[]> {
  const url =
    `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}&brd_json=1`;
  const raw = await brightDataRequest(config.brightData.serpZone, url);
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const organic: any[] = json.organic ?? json.organic_results ?? [];
  return organic
    .map((r) => ({ title: r.title ?? r.name ?? '', url: r.link ?? r.url ?? '', description: r.description ?? r.snippet ?? '' }))
    .filter((r: SerpResult) => r.url);
}

// ── Web Unlocker fallback (DuckDuckGo HTML, parsed here) ──────────────────────
async function searchViaUnlocker(query: string, num: number): Promise<SerpResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await brightDataRequest(config.brightData.unlockerZone, url);
  return parseDuckDuckGo(html).slice(0, num);
}

/** Parse DuckDuckGo's HTML results page. Links are wrapped as //duckduckgo.com/l/?uddg=<real>. */
export function parseDuckDuckGo(html: string): SerpResult[] {
  const results: SerpResult[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    if (/^https?:\/\//.test(href)) results.push({ title, url: href });
  }
  return results;
}
