import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { redis } from '../redis.js';

export interface CompleteOpts {
  system?: string;
  /** Ask the backend to return strict JSON (used by extract()). */
  json?: boolean;
  temperature?: number;
}

export interface LlmProvider {
  name: string;
  complete(prompt: string, opts?: CompleteOpts): Promise<string>;
}

// ─── Ollama (default, local) ──────────────────────────────────────────────
class OllamaProvider implements LlmProvider {
  name = 'ollama';
  async complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
    const { Ollama } = await import('ollama');
    const client = new Ollama({ host: config.llm.ollamaHost });
    const res = await client.chat({
      model: config.llm.ollamaModel,
      format: opts.json ? 'json' : undefined,
      options: { temperature: opts.temperature ?? 0.2 },
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user' as const, content: prompt },
      ],
    });
    return res.message.content;
  }
}

// ─── Anthropic (optional API fallback) ────────────────────────────────────
class AnthropicProvider implements LlmProvider {
  name = 'anthropic';
  async complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
    if (!config.llm.anthropicKey) throw new Error('ANTHROPIC_API_KEY not set.');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: config.llm.anthropicKey });
    const res = await client.messages.create({
      model: config.llm.anthropicModel,
      max_tokens: 4096,
      temperature: opts.temperature ?? 0.2,
      system: opts.json
        ? `${opts.system ?? ''}\nRespond with a single valid JSON object and nothing else.`.trim()
        : opts.system,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }
}

// ─── OpenAI (optional API fallback) ───────────────────────────────────────
class OpenAiProvider implements LlmProvider {
  name = 'openai';
  async complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
    if (!config.llm.openaiKey) throw new Error('OPENAI_API_KEY not set.');
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: config.llm.openaiKey });
    const res = await client.chat.completions.create({
      model: config.llm.openaiModel,
      temperature: opts.temperature ?? 0.2,
      response_format: opts.json ? { type: 'json_object' } : undefined,
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user' as const, content: prompt },
      ],
    });
    return res.choices[0]?.message?.content ?? '';
  }
}

// ─── Gemini (Google, default) ─────────────────────────────────────────────
// Process-wide spacing so concurrent callers never exceed the Gemini RPM cap.
let _nextSlot = 0;
async function rateLimit(): Promise<void> {
  const interval = 60_000 / Math.max(1, config.llm.geminiRpm);
  const now = Date.now();
  const wait = Math.max(0, _nextSlot - now);
  _nextSlot = Math.max(now, _nextSlot) + interval;
  if (wait > 0) await sleep(wait);
}

class GeminiProvider implements LlmProvider {
  name = 'gemini';
  async complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
    if (!config.llm.geminiKey) throw new Error('Gemini key not set (GOOGLE_GEMINI2.5_API_KEY).');
    await rateLimit();
    const model = config.llm.geminiModel;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    });

    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000); // never hang
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.llm.geminiKey },
            body,
            signal: ctrl.signal,
          },
        );
      } catch (e) {
        clearTimeout(timer);
        if (attempt === maxAttempts) throw new Error(`Gemini request failed: ${(e as Error).message}`);
        await sleep(backoff(attempt));
        continue;
      }
      clearTimeout(timer);

      // Retry on rate-limit / transient server errors, honoring Google's stated delay.
      if (res.status === 429 || res.status === 503 || res.status === 500) {
        if (attempt === maxAttempts) {
          throw new Error(`Gemini ${res.status} after ${maxAttempts} attempts (rate limit / overloaded)`);
        }
        const bodyTxt = await res.text().catch(() => '');
        const m = bodyTxt.match(/retry in ([\d.]+)s/i) || bodyTxt.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
        const headerMs = Number(res.headers.get('retry-after')) * 1000;
        const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 800 : headerMs > 0 ? headerMs : backoff(attempt);
        await sleep(Math.min(waitMs, 30_000));
        continue;
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 300)}`);
      }
      const json: any = await res.json();
      const cand = json.candidates?.[0];
      if (!cand) throw new Error(`Gemini returned no candidates: ${JSON.stringify(json).slice(0, 200)}`);
      return (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    }
    throw new Error('Gemini: exhausted retries');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000);

let _provider: LlmProvider | null = null;
export function getProvider(): LlmProvider {
  if (_provider) return _provider;
  switch (config.llm.provider) {
    case 'gemini': _provider = new GeminiProvider(); break;
    case 'anthropic': _provider = new AnthropicProvider(); break;
    case 'openai': _provider = new OpenAiProvider(); break;
    default: _provider = new OllamaProvider(); break;
  }
  return _provider;
}

function currentModel(): string {
  switch (config.llm.provider) {
    case 'gemini': return config.llm.geminiModel;
    case 'anthropic': return config.llm.anthropicModel;
    case 'openai': return config.llm.openaiModel;
    default: return config.llm.ollamaModel;
  }
}

/** Complete with a Redis cache keyed by provider+model+prompt+opts (re-runs don't re-spend). */
export async function complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
  const p = getProvider();
  const key = `llm:${p.name}:${createHash('sha1')
    .update(JSON.stringify({ model: currentModel(), prompt, opts }))
    .digest('hex')}`;
  try {
    const hit = await redis().get(key);
    if (hit !== null) return hit;
  } catch {
    /* cache miss on Redis error */
  }
  const out = await p.complete(prompt, opts);
  try {
    await redis().set(key, out, 'EX', Math.max(1, config.responseCacheHours) * 3600);
  } catch {
    /* non-fatal */
  }
  return out;
}

/** Strip ```json fences and grab the outermost {...} so parsing survives chatty models. */
function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/** Prompt the model for JSON and validate it against a zod schema (one repair retry). */
export async function extract<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: CompleteOpts = {},
): Promise<T> {
  const raw = await complete(prompt, { ...opts, json: true });
  try {
    return schema.parse(JSON.parse(extractJsonBlock(raw)));
  } catch {
    const repair = await complete(
      `${prompt}\n\nYour previous reply was not valid JSON for the required shape. ` +
        `Reply again with ONLY a valid JSON object.`,
      { ...opts, json: true },
    );
    return schema.parse(JSON.parse(extractJsonBlock(repair)));
  }
}
