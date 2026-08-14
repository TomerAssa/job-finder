'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SetupStatus } from '@/lib/data/setup';
import { V, card, chip, ErrorNote, ghostBtn, label, PageHead, primaryBtn } from '../_components/ui';

/**
 * First-run setup.
 *
 * Every step is a check plus the command that satisfies it, rather than a button
 * that does the work invisibly: the steps that matter — importing your contacts,
 * crawling companies — read private files and spend credits, and both are worth
 * running deliberately from a terminal you control.
 */
export function SetupWizard({ status }: { status: SetupStatus }) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const test = async () => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/setup/check', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setTestResult({ ok: body.ok, lines: body.lines ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch('/api/setup/complete', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      router.refresh();
      router.push('/people');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  };

  const keysDone = status.keys.brightData && status.keys.llm;

  return (
    <>
      <PageHead
        title="Setup"
        sub="Four steps to a search of your own. Nothing here runs without you asking."
      />

      {error && <div style={{ marginBottom: 16 }}><ErrorNote>{error}</ErrorNote></div>}

      <div style={{ display: 'grid', gap: 14, maxWidth: 780 }}>
        <Step n={1} title="API keys" done={keysDone}>
          <Check ok={status.keys.brightData} label="BRIGHTDATA_API_KEY — scraping careers pages and LinkedIn" />
          <Check
            ok={status.keys.llm}
            label={`LLM provider "${status.keys.llmProvider}" — reading job listings into structured fields`}
          />
          {!keysDone && (
            <P>
              Copy <Code>.env.example</Code> to <Code>.env</Code> and fill in the missing
              values. Ollama needs no key and keeps everything on your machine.
            </P>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={test} disabled={testing} style={{ ...ghostBtn, opacity: testing ? 0.6 : 1 }}>
              {testing ? 'testing…' : 'Test the connections'}
            </button>
            <span style={{ color: V('faint'), fontSize: 12 }}>Spends one or two credits.</span>
          </div>
          {testResult && (
            <pre style={{ marginTop: 12, background: V('bg2'), borderRadius: 8, padding: 12, fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: testResult.ok ? V('text') : V('red') }}>
              {testResult.lines.join('\n')}
            </pre>
          )}
        </Step>

        <Step n={2} title="Companies to search" done={status.companies.total > 0}>
          {status.companies.lists.length > 0 ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {status.companies.lists.map((l) => (
                <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ flex: 1 }} dir="auto">{l.name}</span>
                  <span style={label}>{l.companies} companies</span>
                  <span style={{ ...chip(l.crawled > 0 ? V('ok') : V('faint')), fontSize: 10.5 }}>
                    {l.crawled} crawled
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <P>
              Drop a company-list CSV in <Code>data/input/</Code> and load it as a named
              sector: <Code>npm run job ingest-list &lt;file&gt;</Code>
            </P>
          )}
        </Step>

        <Step n={3} title="Your LinkedIn connections" done={status.connections.total > 0} optional>
          {status.connections.total > 0 ? (
            <P>
              {status.connections.total} imported, {status.connections.promoted} added to your
              people list. <Link href="/people/import?tab=pool" style={{ color: V('cyan') }}>Review the pool →</Link>
            </P>
          ) : (
            <P>
              Optional, but it is what turns a job list into warm paths. Export from LinkedIn
              (Settings → Data Privacy → Get a copy of your data → Connections), put{' '}
              <Code>Connections.csv</Code> in <Code>data/input/</Code>, then{' '}
              <Code>npm run ingest</Code>. It stays on your machine.
            </P>
          )}
        </Step>

        <Step n={4} title="Find some jobs" done={status.positions.total > 0}>
          {status.positions.total > 0 ? (
            <P>
              {status.positions.total} positions found, {status.positions.targetRoles} matching
              your target roles. <Link href="/search" style={{ color: V('cyan') }}>Search them →</Link>
            </P>
          ) : (
            <P>
              Crawl the careers pages of a sector:{' '}
              <Code>npm run job search --sector &quot;&lt;name&gt;&quot;</Code>. Costs roughly two to
              four credits per company, so start with <Code>--limit 20</Code> to see how it goes.
            </P>
          )}
        </Step>
      </div>

      {status.demo.active && (
        <div style={{ ...card, borderColor: V('amber'), padding: '16px 18px', marginTop: 20, maxWidth: 780 }}>
          <div style={{ ...label, color: V('amber') }}>Demo data is still loaded</div>
          <P>
            {status.demo.people} people, {status.demo.companies} companies and{' '}
            {status.demo.positions} positions are invented placeholders, there so the screens
            are not empty. Clearing them deletes only rows flagged as demo.
          </P>
          <button onClick={finish} disabled={finishing} style={{ ...primaryBtn(finishing), marginTop: 12 }}>
            {finishing ? 'clearing…' : 'Clear the demo data and finish'}
          </button>
        </div>
      )}

      {!status.demo.active && status.complete && (
        <div style={{ ...card, borderColor: V('ok'), padding: '16px 18px', marginTop: 20, maxWidth: 780 }}>
          <div style={{ ...label, color: V('ok') }}>Setup complete</div>
          <P>
            Everything is in place. <Link href="/search" style={{ color: V('cyan') }}>Run a search →</Link>
          </P>
        </div>
      )}
    </>
  );
}

function Step({ n, title, done, optional, children }: {
  n: number; title: string; done: boolean; optional?: boolean; children: ReactNode;
}) {
  return (
    <section style={{ ...card, padding: '16px 18px', borderColor: done ? V('ok') : V('line') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 11, background: done ? V('ok') : V('panel2'), color: done ? '#fff' : V('faint'), border: `1px solid ${done ? 'transparent' : V('line')}` }}>
          {done ? '✓' : n}
        </span>
        <span style={{ fontFamily: 'var(--display)', fontSize: 18 }}>{title}</span>
        {optional && <span style={{ ...chip(V('faint')), fontSize: 10 }}>optional</span>}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

function Check({ ok, label: text }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, padding: '3px 0' }}>
      <span style={{ color: ok ? V('ok') : V('red'), fontFamily: 'var(--mono)' }}>{ok ? '✓' : '✕'}</span>
      <span style={{ color: ok ? V('text') : V('muted') }}>{text}</span>
    </div>
  );
}

const P = ({ children }: { children: ReactNode }) => (
  <p style={{ color: V('muted'), fontSize: 13, lineHeight: 1.7, margin: '6px 0 0' }}>{children}</p>
);

const Code = ({ children }: { children: ReactNode }) => (
  <code style={{ fontFamily: 'var(--mono)', fontSize: 12, background: V('bg2'), padding: '1px 6px', borderRadius: 5 }}>
    {children}
  </code>
);
