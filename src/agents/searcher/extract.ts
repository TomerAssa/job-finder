import { z } from 'zod';
import { config } from '../../config.js';
import { fetchPage } from '../../brightdata/unlocker.js';
import { htmlToText } from '../../util/html.js';
import { extract } from '../../llm/provider.js';
import {
  greenhouseJobs, leverJobs, workableJobs, ashbyJobs, smartRecruitersJobs, recruiteeJobs, bamboohrJobs,
} from './ats/apis.js';
import { comeetJobs } from './ats/comeet.js';
import { parseJsonLd } from './ats/jsonld.js';
import { detectAtsInHtml, detectAts } from './ats/detect.js';
import type { AtsType, FoundPosition, Resolved } from './types.js';

export interface ExtractResult {
  positions: FoundPosition[];
  /** Which extractor produced the result: an ATS type, 'jsonld', 'llm', or 'none'. */
  source: string;
  /** True when nothing structured matched and the LLM also couldn't parse it. */
  needsLlm: boolean;
}

const LlmPositions = z.object({
  positions: z
    .array(z.object({ title: z.string(), location: z.string().optional().nullable(), url: z.string().optional().nullable() }))
    .default([]),
});

/** Call the right structured ATS API for a tokened board; null on miss/failure. */
async function tryAtsApi(atsType: AtsType, token?: string): Promise<FoundPosition[] | null> {
  if (!token) return null;
  try {
    switch (atsType) {
      case 'greenhouse': return await greenhouseJobs(token);
      case 'lever': return await leverJobs(token);
      case 'workable': return await workableJobs(token);
      case 'ashby': return await ashbyJobs(token);
      case 'smartrecruiters': return await smartRecruitersJobs(token);
      case 'recruitee': return await recruiteeJobs(token);
      case 'bamboohr': return await bamboohrJobs(token);
      default: return null;
    }
  } catch {
    return null;
  }
}

async function llmExtract(pageText: string, careersUrl: string): Promise<FoundPosition[]> {
  const { positions } = await extract(
    `Below is the text of a company's careers page. Extract ONLY currently open job positions. ` +
      `Ignore navigation, perks, and boilerplate. For each: "title", "location" if present, and ` +
      `"url" (absolute; page is ${careersUrl}) if a link is present.\n` +
      `Return JSON: {"positions":[{"title":"...","location":"...","url":"..."}]}\n\nPAGE TEXT:\n${pageText}`,
    LlmPositions,
    { temperature: 0 },
  );
  return (positions ?? []).map((p) => ({ title: p.title, location: p.location ?? undefined, url: p.url ?? undefined }));
}

/**
 * Extract positions for a resolved company, most-precise source first:
 * tokened ATS API → (fetch) embedded ATS → Comeet → JSON-LD → Gemini.
 * If a plain fetch finds nothing, retry once with JS rendering (SPA portals).
 */
export async function extractPositions(resolved: Resolved): Promise<ExtractResult> {
  const { careersUrl, atsType, token } = resolved;
  if (!careersUrl) return { positions: [], source: 'none', needsLlm: false };

  // 1. URL is itself a tokened ATS board — structured API, no fetch needed.
  const direct = await tryAtsApi(atsType, token);
  if (direct && direct.length) return { positions: direct, source: atsType, needsLlm: false };

  // 2. Plain fetch + parse.
  const plain = await fetchAndParse(careersUrl, atsType, false);
  if (plain.positions.length) return plain;

  // 3. Render JS and retry — only for pages a plain fetch couldn't parse.
  const rendered = await fetchAndParse(careersUrl, atsType, true);
  if (rendered.positions.length) return rendered;

  return { positions: [], source: 'none', needsLlm: plain.needsLlm || rendered.needsLlm };
}

/** Run the structured→LLM chain over a page's HTML (no fetching). */
async function parseFromHtml(html: string, baseUrl: string, atsType: AtsType, tagSuffix: string): Promise<ExtractResult> {
  const tag = (s: string) => (tagSuffix ? `${s}-${tagSuffix}` : s);

  const emb = detectAtsInHtml(html);
  if (emb.atsType !== 'unknown' && emb.atsType !== 'comeet') {
    const viaEmbed = await tryAtsApi(emb.atsType, emb.token);
    if (viaEmbed && viaEmbed.length) return { positions: viaEmbed, source: emb.atsType, needsLlm: false };
  }
  if (atsType === 'comeet' || emb.atsType === 'comeet') {
    try {
      const cj = await comeetJobs(html, baseUrl);
      if (cj.length) return { positions: cj, source: 'comeet', needsLlm: false };
    } catch { /* fall through */ }
  }
  const ld = parseJsonLd(html);
  if (ld.length) return { positions: ld, source: tag('jsonld'), needsLlm: false };

  if (config.searchUseLlm) {
    try {
      const llm = await llmExtract(htmlToText(html), baseUrl);
      if (llm.length) return { positions: llm, source: tag('llm'), needsLlm: false };
    } catch {
      return { positions: [], source: 'none', needsLlm: true };
    }
  }
  return { positions: [], source: 'none', needsLlm: false };
}

const ATS_HINT = /greenhouse|lever\.co|comeet|ashbyhq|workable|recruitee|bamboohr|smartrecruiters|teamtailor|personio|careers|jobs/i;

/** Find a careers <iframe>/embed src pointing at an ATS or jobs subdomain. */
function findCareersIframe(html: string, baseUrl: string): string | null {
  const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) {
      try { src = new URL(src, baseUrl).href; } catch { continue; }
    }
    if (/^https?:\/\//.test(src) && ATS_HINT.test(src)) return src.replace(/&amp;/g, '&');
  }
  return null;
}

/** Fetch a careers page (optionally JS-rendered), parse it, and follow a careers iframe if needed. */
async function fetchAndParse(careersUrl: string, atsType: AtsType, render: boolean): Promise<ExtractResult> {
  let html: string;
  try {
    html = await fetchPage(careersUrl, { render });
  } catch {
    return { positions: [], source: 'none', needsLlm: false };
  }
  const res = await parseFromHtml(html, careersUrl, atsType, render ? 'rendered' : '');
  if (res.positions.length) return res;

  // Iframe-follow: the jobs may live in a cross-origin ATS iframe embedded on the page.
  const iframe = findCareersIframe(html, careersUrl);
  if (iframe && iframe !== careersUrl) {
    try {
      const iframeHtml = await fetchPage(iframe, { render });
      const iframeRes = await parseFromHtml(iframeHtml, iframe, detectAts(iframe).atsType, 'iframe');
      if (iframeRes.positions.length) return iframeRes;
    } catch { /* ignore */ }
  }
  return { positions: [], source: 'none', needsLlm: res.needsLlm };
}
