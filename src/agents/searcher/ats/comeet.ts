import type { FoundPosition } from '../types.js';

/**
 * Comeet careers pages are JS-rendered, so the fetched HTML rarely lists jobs
 * directly — but it does carry the company UID + token needed to call Comeet's
 * public positions API. We extract those, then fetch structured positions.
 * Handles both an embedded api URL and separate uid/token fields.
 */
export async function comeetJobs(html: string, pageUrl: string): Promise<FoundPosition[]> {
  const api = resolveApiUrl(html, pageUrl);
  if (!api) return [];
  const res = await fetch(api, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`comeet ${res.status}`);
  const data: any = await res.json();
  const list: any[] = Array.isArray(data) ? data : (data.positions ?? []);
  return list.map((p) => ({
    title: p.name ?? p.position_name,
    location: p.location?.name || [p.location?.city, p.location?.country].filter(Boolean).join(', '),
    url: p.url_comeet_hosted_page || p.url_active || p.url_detected,
    description: sectionsToText(p),
  }));
}

function resolveApiUrl(html: string, pageUrl: string): string | null {
  // 1) The page may embed the full API URL already.
  const embedded = html.match(/https?:\/\/www\.comeet\.co\/careers-api\/2\.0\/company\/[^"'\s]+positions[^"'\s]*/i);
  if (embedded) return embedded[0].replace(/&amp;/g, '&');

  // 2) Otherwise assemble from uid (URL last segment or html) + token (html).
  let uid = (pageUrl.match(/comeet\.com\/jobs\/[^/]+\/([0-9A-Za-z.]+)/i) || [])[1]
    || (html.match(/company[_-]?uid["']?\s*[:=]\s*["']([0-9A-Za-z.]+)["']/i) || [])[1];
  const token = (html.match(/[?&]token=([A-Za-z0-9]+)/) || [])[1]
    || (html.match(/["']?token["']?\s*[:=]\s*["']([A-Za-z0-9]{6,})["']/i) || [])[1];
  if (!uid) return null;
  const base = `https://www.comeet.co/careers-api/2.0/company/${uid}/positions?details=true`;
  return token ? `${base}&token=${token}` : base;
}

function sectionsToText(p: any): string | undefined {
  if (typeof p.description === 'string') return p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const secs = p.details || p.description?.sections;
  if (Array.isArray(secs)) {
    return secs
      .map((s: any) => `${s.name ?? ''}: ${(s.value ?? s.content ?? '').replace(/<[^>]+>/g, ' ')}`)
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000) || undefined;
  }
  return undefined;
}
