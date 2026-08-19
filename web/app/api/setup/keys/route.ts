import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paths } from '../../../../../src/config.js';
import { sameOrigin } from '@/lib/guard';

/**
 * Read and set API keys from the setup page.
 *
 * Only ever reports whether a key is present and its last four characters. The
 * values themselves are never sent to the browser: rendering a secret to make a
 * settings screen feel complete is how secrets end up in screenshots and
 * scrollback.
 *
 * Writing updates both the file and the running process, so a key takes effect
 * without a restart — otherwise the page would say "saved" while every request
 * kept failing with the old value.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENV_PATH = resolve(paths.root, '.env');

/** Keys the page is allowed to touch. Anything else is ignored. */
const EDITABLE = [
  { key: 'BRIGHTDATA_API_KEY', label: 'BrightData API key', hint: 'Account settings → API tokens' },
  { key: 'BRIGHTDATA_SERP_ZONE', label: 'BrightData SERP zone', hint: 'Leave blank to search through the unlocker zone' },
  { key: 'BRIGHTDATA_UNLOCKER_ZONE', label: 'BrightData Unlocker zone', hint: 'Zones → your unlocker zone' },
  { key: 'GEMINI_API_KEY', label: 'Gemini API key', hint: 'Free tier is enough to start' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', hint: 'Optional alternative to Gemini' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API key', hint: 'Optional alternative to Gemini' },
] as const;

const SECRET = /KEY$/;

const describe = (key: string) => {
  const raw = (process.env[key] ?? '').trim();
  if (!raw) return { set: false, preview: '' };
  return { set: true, preview: SECRET.test(key) ? `…${raw.slice(-4)}` : raw };
};

export async function GET() {
  return NextResponse.json({
    envPath: ENV_PATH.replace(paths.root + '/', ''),
    envExists: existsSync(ENV_PATH),
    fields: EDITABLE.map((f) => ({ ...f, ...describe(f.key) })),
  });
}

/** Replace a key in place, or append it, without disturbing the rest of the file. */
function setEnvLine(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (re.test(contents)) return contents.replace(re, line);
  return contents.replace(/\s*$/, '\n') + line + '\n';
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request refused' }, { status: 403 });
  }

  let body: Record<string, string> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const allowed = new Set(EDITABLE.map((f) => f.key));
  const updates = Object.entries(body).filter(([k, v]) => allowed.has(k as never) && typeof v === 'string');
  if (!updates.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  try {
    if (!existsSync(ENV_PATH)) {
      const example = resolve(paths.root, '.env.example');
      if (existsSync(example)) copyFileSync(example, ENV_PATH);
      else writeFileSync(ENV_PATH, '');
    } else {
      // Keys are not something to lose to a bad write.
      copyFileSync(ENV_PATH, `${ENV_PATH}.backup`);
    }

    let contents = readFileSync(ENV_PATH, 'utf8');
    for (const [key, value] of updates) {
      const clean = value.trim();
      contents = setEnvLine(contents, key, clean);
      // So the next request uses it, rather than the value loaded at boot.
      if (clean) process.env[key] = clean;
      else delete process.env[key];
    }
    writeFileSync(ENV_PATH, contents, { mode: 0o600 });

    return NextResponse.json({
      saved: updates.map(([k]) => k),
      fields: EDITABLE.map((f) => ({ ...f, ...describe(f.key) })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[setup/keys] failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
