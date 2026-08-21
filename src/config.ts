import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(__dirname, '..');

/**
 * Load `.env` from the project root, not from wherever the process happens to
 * have been started.
 *
 * `dotenv/config` resolves relative to `process.cwd()`. That is the project root
 * for the CLI, but `web/` for the Next.js server — which imports the agents
 * directly — so the console silently ran with no API keys at all and reported
 * them as unset. The bundled server can also resolve `import.meta.url` into
 * `.next/`, so several candidates are tried and the first that exists wins.
 */
const ENV_CANDIDATES = [
  process.env.JOB_ENV_FILE,
  resolve(projectRoot, '.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '.env'),
].filter((p): p is string => !!p);

for (const path of ENV_CANDIDATES) {
  if (!existsSync(path)) continue;
  loadEnv({ path });
  break;
}

export const paths = {
  root: projectRoot,
  inputDir: resolve(projectRoot, 'data/input'),
  outputDir: resolve(projectRoot, 'data/output'),
  // JOB_DB points both the CLI and the web app at the same file; without it they
  // would silently disagree, since web/lib/db.ts has always honoured it.
  db: process.env.JOB_DB ? resolve(process.cwd(), process.env.JOB_DB) : resolve(projectRoot, 'data/output/job.db'),
  // Default input filenames (override via CLI flags)
  companiesCsv: resolve(projectRoot, 'data/input/startup-finder.csv'),
  connectionsCsv: resolve(projectRoot, 'data/input/Connections.csv'),
  // Optional hand-maintained spreadsheets of leads/positions.
  // Point these at your own files via env vars, or drop them in data/input.
  leadsXlsx: process.env.LEADS_XLSX ?? resolve(projectRoot, 'data/input/leads.xlsx'),
  positionsXlsx: process.env.POSITIONS_XLSX ?? resolve(projectRoot, 'data/input/positions.xlsx'),
};

/** The Gemini key uses a non-standard dotted name in .env; also accept GEMINI_API_KEY. */
function geminiKey(): string {
  return (process.env['GOOGLE_GEMINI2.5_API_KEY'] ?? process.env['GEMINI_API_KEY'] ?? '').trim();
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  brightData: {
    apiKey: (process.env.BRIGHTDATA_API_KEY ?? '').trim(),
    unlockerZone: (process.env.BRIGHTDATA_UNLOCKER_ZONE ?? 'web_unlocker1').trim(),
    serpZone: (process.env.BRIGHTDATA_SERP_ZONE ?? 'serp_api1').trim(),
    // Hard monthly cap on billable requests (0 = disabled). Keeps you under the
    // 5,000 free-tier credits by default; counted in Redis per calendar month.
    monthlyLimit: num('BRIGHTDATA_MONTHLY_LIMIT', 4800),
  },
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  llm: {
    // Default to Gemini when a key is present, else Ollama.
    provider: (process.env.LLM_PROVIDER ?? (geminiKey() ? 'gemini' : 'ollama')) as
      | 'gemini'
      | 'ollama'
      | 'anthropic'
      | 'openai',
    geminiKey: geminiKey(),
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    // Requests/minute cap. Free tier ≈ 15; raise to 1000+ once billing is enabled.
    geminiRpm: num('GEMINI_RPM', 15),
    ollamaHost: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:14b',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
  },
  // Use the LLM (Gemini) to parse careers pages that have no structured data.
  searchUseLlm: (process.env.SEARCH_USE_LLM ?? 'true').toLowerCase() !== 'false',
  checkTtlDays: num('CHECK_TTL_DAYS', 7),
  /**
   * Where you are looking for work. Used as the search default, and to drop
   * postings whose stated location is somewhere else before they are stored.
   * Set it empty to keep everything, wherever it is.
   */
  defaultLocation: (process.env.DEFAULT_LOCATION ?? 'Israel').trim(),
  searchConcurrency: num('SEARCH_CONCURRENCY', 4),
  responseCacheHours: num('RESPONSE_CACHE_HOURS', 72),
};

export function requireBrightData(): void {
  if (!config.brightData.apiKey) {
    throw new Error(
      'BRIGHTDATA_API_KEY is not set. Copy .env.example to .env and fill in your BrightData token.',
    );
  }
}
