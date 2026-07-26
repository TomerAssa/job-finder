/**
 * Standalone connectivity check: validates BrightData (SERP + Web Unlocker),
 * Redis, and the LLM provider without spending on a full run.
 * Run with: npm run job -- doctor   (wired in cli.ts)
 */
import { config, requireBrightData } from './config.js';
import { brightDataRequest, monthlyUsage } from './brightdata/client.js';
import { serpSearch, serpMode } from './brightdata/serp.js';
import { redis } from './redis.js';
import { complete } from './llm/provider.js';

function ok(label: string, detail = '') { console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`); }
function bad(label: string, detail = '') { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }

export async function runDoctor(): Promise<void> {
  console.log('\n🩺 Environment check\n');

  // ── BrightData key ──
  try {
    requireBrightData();
    ok('BRIGHTDATA_API_KEY set', `${config.brightData.apiKey.slice(0, 4)}…`);
  } catch (e) {
    bad('BRIGHTDATA_API_KEY', (e as Error).message);
    return;
  }
  const mode = serpMode();
  console.log(`  ℹ️  Search mode: "${mode}"  |  Unlocker zone: "${config.brightData.unlockerZone}"` +
    (mode === 'serp' ? `  |  SERP zone: "${config.brightData.serpZone}"` : ' (search runs through Unlocker)'));

  // ── Search (SERP zone or Unlocker-DuckDuckGo depending on mode) ──
  try {
    const results = await serpSearch('Wiz cyber security careers', 5);
    if (results.length > 0) ok('Search returns results', `${results.length} hits; e.g. ${results[0].url}`);
    else bad('Search returned no results', mode === 'unlocker'
      ? 'Unlocker fetched but nothing parsed — check the Unlocker zone is active'
      : 'SERP zone may not honor brd_json');
  } catch (e) {
    bad('Search call failed', (e as Error).message);
  }

  // ── Web Unlocker: fetch a plain page ──
  try {
    const html = await brightDataRequest(config.brightData.unlockerZone, 'https://example.com', { cache: false });
    if (/example domain/i.test(html)) ok('Web Unlocker zone fetches pages');
    else ok('Web Unlocker zone responded', `${html.length} bytes`);
  } catch (e) {
    bad('Web Unlocker call failed', (e as Error).message);
  }

  // ── Redis + monthly usage ──
  try {
    const pong = await redis().ping();
    const used = await monthlyUsage();
    const limit = config.brightData.monthlyLimit;
    ok('Redis reachable', pong);
    console.log(`  ℹ️  BrightData usage this month: ${used}${limit ? ` / ${limit} cap` : ' (no cap)'}`);
  } catch (e) {
    bad('Redis unreachable', `${(e as Error).message} (optional, but the monthly cap needs Redis to count)`);
  }

  // ── LLM ──
  const model = config.llm.provider === 'gemini' ? config.llm.geminiModel
    : config.llm.provider === 'ollama' ? config.llm.ollamaModel
    : config.llm.provider === 'anthropic' ? config.llm.anthropicModel
    : config.llm.openaiModel;
  console.log(`  ℹ️  LLM provider: "${config.llm.provider}" (${model})`);
  try {
    const reply = await complete('Reply with the single word: OK', { temperature: 0 });
    if (/ok/i.test(reply)) ok('LLM reachable', `${config.llm.provider} replied`);
    else ok('LLM responded', `"${reply.slice(0, 40)}"`);
  } catch (e) {
    bad('LLM call failed', (e as Error).message);
  }

  console.log('\nDone.\n');
}
