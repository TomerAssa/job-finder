import type { FoundPosition } from '../types.js';

/**
 * Parse schema.org JobPosting objects from a page's <script type="application/ld+json">
 * blocks. This is a W3C-standard structured format many custom career sites emit, so it
 * gives precise data with no LLM. Handles single objects, arrays, and @graph wrappers.
 */
export function parseJsonLd(html: string): FoundPosition[] {
  const out: FoundPosition[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let data: any;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const node of flatten(data)) {
      if (isJobPosting(node)) out.push(toPosition(node));
    }
  }
  return out;
}

function flatten(data: any): any[] {
  if (Array.isArray(data)) return data.flatMap(flatten);
  if (data && typeof data === 'object') {
    if (Array.isArray(data['@graph'])) return data['@graph'].flatMap(flatten);
    return [data];
  }
  return [];
}

function isJobPosting(node: any): boolean {
  const t = node?.['@type'];
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
}

function toPosition(node: any): FoundPosition {
  const loc = node.jobLocation;
  const addr = (Array.isArray(loc) ? loc[0] : loc)?.address;
  const location = addr
    ? [addr.addressLocality, addr.addressRegion, addr.addressCountry]
        .map((v: any) => (typeof v === 'object' ? v?.name : v))
        .filter(Boolean)
        .join(', ')
    : node.applicantLocationRequirements?.name;
  return {
    title: node.title,
    location: location || undefined,
    url: typeof node.url === 'string' ? node.url : undefined,
    description: typeof node.description === 'string'
      ? node.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000)
      : undefined,
  };
}
