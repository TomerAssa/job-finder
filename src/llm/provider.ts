import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { redis } from '../redis.js';

/**
 * The LLM cannot serve any request at all: no key, a rejected key, or an
 * account out of credit.
 *
 * Distinct from a failed completion, because retrying or carrying on with the
 * next company cannot help — every subsequent call fails identically. Callers
 * that treat an LLM failure as "nothing found" would otherwise record a verdict
 * they never actually reached. That is not hypothetical: run 27 hit Gemini 402
 * ("prepayment credits are depleted") partway through, and because the careers
 * resolver caught and discarded it, 239 companies were written down as having
 * no careers page and backed off for 45 days without one of them having been
 * looked at.
 */
export class LlmUnavailableError extends Error {
  readonly isLlmUnavailable = true;
  constructor(message: string) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

/** True for an LLM failure that every later call will repeat. */
export function isLlmUnavailable(err: unknown): boolean {
  if (err instanceof LlmUnavailableError) return true;
  // The message fallback matters even though the provider throws the typed
  // error: an error that crosses a wrapping boundary loses its class, and
  // misreading one of these as a transient failure is precisely the bug.
  // "rate limit reached" is the Claude CLI running dry; Gemini's retryable
  // overload says "(rate limit / overloaded)" and must stay retryable.
  return (
    err instanceof Error &&
    /Gemini (401|402|403)|credits are depleted|billing|API key not valid|PERMISSION_DENIED|RESOURCE_EXHAUSTED|not set|usage limit|rate limit reached|credit balance|not authenticated|claude login|ENOENT/i.test(
      err.message,
    )
  );
}

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
    if (!config.llm.geminiKey) {
      throw new LlmUnavailableError('Gemini key not set (GOOGLE_GEMINI2.5_API_KEY).');
    }
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
        const message = `Gemini ${res.status}: ${errBody.slice(0, 300)}`;
        // 401/403 is the key, 402 is the balance. None of them get better by
        // trying the next company, and all of them must reach the caller.
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          throw new LlmUnavailableError(message);
        }
        throw new Error(message);
      }
      const json: any = await res.json();
      const cand = json.candidates?.[0];
      if (!cand) throw new Error(`Gemini returned no candidates: ${JSON.stringify(json).slice(0, 200)}`);
      return (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    }
    throw new Error('Gemini: exhausted retries');
  }
}

// ─── Claude Code (the local `claude` CLI, on the user's own subscription) ────
/**
 * Use the installed Claude Code CLI as the model backend.
 *
 * A stopgap for having no working API key: Gemini's prepaid balance ran out and
 * the Anthropic and OpenAI keys in `.env` are empty placeholders, so the
 * pipeline had no LLM at all and careers-page resolution — which cannot run
 * without one — was dead. The `claude` binary is already installed and
 * authenticated, so it can stand in without a new credential.
 *
 * Costs are charged to the user's Claude account rather than per-token to an
 * API key, which is the point, but means a long crawl can eat a usage limit.
 * Every completion still goes through the Redis cache in `complete()`, so a
 * re-run of the same companies is free.
 */
class ClaudeCodeProvider implements LlmProvider {
  name = 'claude-code';

  /**
   * A neutral working directory.
   *
   * `claude` loads CLAUDE.md, skills and plugins from wherever it starts, so
   * running it inside this repo would prepend the project's own instructions —
   * and the superpowers skill — to every single careers-page pick: slower, far
   * more tokens, and it turns a one-line multiple-choice answer into a
   * conversation. An empty directory keeps the prompt to what we sent.
   */
  private static cwd: string | null = null;
  private static workDir(): string {
    if (!ClaudeCodeProvider.cwd) {
      ClaudeCodeProvider.cwd = mkdtempSync(join(tmpdir(), 'job-agent-llm-'));
    }
    return ClaudeCodeProvider.cwd;
  }

  /**
   * Each completion is a process, not a socket, so the searcher's concurrency
   * of 10 would mean ten Claude Code processes at once. Capped separately.
   */
  private static gate: { add<T>(fn: () => Promise<T>): Promise<T> } | null = null;
  private static async queue() {
    if (!ClaudeCodeProvider.gate) {
      const { default: PQueue } = await import('p-queue');
      ClaudeCodeProvider.gate = new PQueue({ concurrency: config.llm.claudeCodeConcurrency });
    }
    return ClaudeCodeProvider.gate;
  }

  async complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
    const gate = await ClaudeCodeProvider.queue();
    return gate.add(() => this.run(prompt, opts)) as Promise<string>;
  }

  private async run(prompt: string, opts: CompleteOpts = {}): Promise<string> {
    const { spawn } = await import('node:child_process');
    const parts = [
      opts.system,
      opts.json ? 'Reply with ONLY a single JSON object. No prose, no code fences, no explanation.' : null,
      prompt,
    ].filter(Boolean);

    const args = [
      '-p',
      '--model', config.llm.claudeCodeModel,
      '--output-format', 'json',
      // No MCP servers and no tools: this is a text transform, and anything
      // agentic here would be slower, dearer and able to touch the filesystem.
      '--strict-mcp-config',
      '--disallowed-tools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task',
    ];

    const child = spawn(config.llm.claudeCodeBin, args, {
      cwd: ClaudeCodeProvider.workDir(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    const timeoutMs = config.llm.claudeCodeTimeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const code: number | null = await new Promise((resolve, reject) => {
      child.on('error', (err) => {
        clearTimeout(timer);
        // A missing binary is not a transient failure; every later call repeats it.
        reject(
          new LlmUnavailableError(
            `Could not run "${config.llm.claudeCodeBin}": ${err.message}. ` +
              `Install the Claude Code CLI or set CLAUDE_CODE_BIN to its path.`,
          ),
        );
      });
      child.on('close', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
      child.stdin.end(parts.join('\n\n'), 'utf8');
    });

    if (timedOut) throw new Error(`claude -p timed out after ${timeoutMs}ms`);

    const blob = `${stdout}\n${stderr}`;
    // Quota and auth failures must be fatal, not read as an empty answer: that
    // confusion is what cost 239 companies on run 27.
    if (/usage limit|rate limit reached|credit balance|not authenticated|please run .?claude login|invalid api key/i.test(blob)) {
      throw new LlmUnavailableError(`Claude Code cannot serve requests: ${blob.trim().slice(0, 300)}`);
    }
    if (code !== 0) throw new Error(`claude -p exited ${code}: ${blob.trim().slice(0, 300)}`);

    let envelope: { is_error?: boolean; result?: unknown; subtype?: string };
    try {
      envelope = JSON.parse(stdout);
    } catch {
      throw new Error(`claude -p returned unparseable output: ${stdout.trim().slice(0, 300)}`);
    }
    if (envelope.is_error) {
      throw new Error(`claude -p reported an error (${envelope.subtype ?? 'unknown'}): ${String(envelope.result).slice(0, 300)}`);
    }
    if (typeof envelope.result !== 'string' || !envelope.result.trim()) {
      throw new Error(`claude -p returned no text: ${stdout.trim().slice(0, 200)}`);
    }
    return envelope.result;
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
    case 'claude-code': _provider = new ClaudeCodeProvider(); break;
    default: _provider = new OllamaProvider(); break;
  }
  return _provider;
}

/** The model name the configured provider will actually use. */
export function currentModel(): string {
  switch (config.llm.provider) {
    case 'gemini': return config.llm.geminiModel;
    case 'anthropic': return config.llm.anthropicModel;
    case 'openai': return config.llm.openaiModel;
    case 'claude-code': return config.llm.claudeCodeModel;
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
