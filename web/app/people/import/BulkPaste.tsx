'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { V, card, chip, ErrorNote, ghostBtn, inp, label, primaryBtn } from '../../_components/ui';

interface Row {
  id: number;
  placeholderName: string;
  linkedinUrl?: string;
  phone?: string;
  created: boolean;
  needsEnrichment: boolean;
  state: 'idle' | 'enriching' | 'done' | 'failed';
  name?: string;
  role?: string | null;
  company?: string | null;
  error?: string;
}

interface Rejected {
  line: number;
  raw: string;
  reason: string;
}

export function BulkPaste() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [summary, setSummary] = useState<{ added: number; existing: number; duplicatesInPaste: number } | null>(null);
  const [credits, setCredits] = useState(0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/people/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);

      const created: Row[] = (body.created ?? []).map((c: Omit<Row, 'state'>) => ({ ...c, state: 'idle' as const }));
      setRows(created);
      setRejected(body.rejected ?? []);
      setSummary({ added: body.added, existing: body.existing, duplicatesInPaste: body.duplicatesInPaste });
      setText('');
      router.refresh();

      // Enrichment runs one at a time on purpose: it is rate-limited upstream and
      // sequential progress is honest about what has actually been spent.
      const toEnrich = created.filter((c) => c.needsEnrichment);
      for (const row of toEnrich) {
        setRows((rs) => rs!.map((r) => (r.id === row.id ? { ...r, state: 'enriching' } : r)));
        try {
          const eres = await fetch(`/api/people/${row.id}/enrich`, { method: 'POST' });
          const ebody = await eres.json();
          setCredits((c) => c + 1);
          if (!eres.ok) throw new Error(ebody?.error ?? `HTTP ${eres.status}`);
          setRows((rs) => rs!.map((r) => (r.id === row.id
            ? { ...r, state: 'done', name: ebody.name, role: ebody.role, company: ebody.company }
            : r)));
        } catch (err) {
          setRows((rs) => rs!.map((r) => (r.id === row.id
            ? { ...r, state: 'failed', error: err instanceof Error ? err.message : String(err) }
            : r)));
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (row: Row) => {
    setRows((rs) => rs!.map((r) => (r.id === row.id ? { ...r, state: 'enriching', error: undefined } : r)));
    try {
      const res = await fetch(`/api/people/${row.id}/enrich`, { method: 'POST' });
      const body = await res.json();
      setCredits((c) => c + 1);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs!.map((r) => (r.id === row.id ? { ...r, state: 'done', name: body.name, role: body.role, company: body.company } : r)));
      router.refresh();
    } catch (err) {
      setRows((rs) => rs!.map((r) => (r.id === row.id ? { ...r, state: 'failed', error: err instanceof Error ? err.message : String(err) } : r)));
    }
  };

  const pending = rows?.filter((r) => r.state === 'enriching').length ?? 0;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <div style={{ ...card, padding: 20, display: 'grid', gap: 12 }}>
        <div style={label}>Paste LinkedIn profile URLs or phone numbers — one per line</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={'https://www.linkedin.com/in/dana-cohen\nhttps://www.linkedin.com/in/yoni-levi\n054-123-4567'}
          style={{ ...inp(), width: '100%', resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.7 }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={primaryBtn(busy || !text.trim())} disabled={busy || !text.trim()} onClick={submit}>
            {busy ? 'Adding…' : 'Add them'}
          </button>
          <span style={{ color: V('faint'), fontSize: 12, lineHeight: 1.6 }}>
            LinkedIn URLs are looked up to fill in name, role and company — one search
            credit each. Phone numbers are added as blank contacts for you to name.
          </span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {summary && (
        <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={chip(V('ok'))}>{summary.added} added</span>
          {summary.existing > 0 && <span style={chip(V('faint'))}>{summary.existing} already existed</span>}
          {summary.duplicatesInPaste > 0 && <span style={chip(V('faint'))}>{summary.duplicatesInPaste} duplicate lines</span>}
          {rejected.length > 0 && <span style={chip(V('red'))}>{rejected.length} not readable</span>}
          {credits > 0 && <span style={{ ...label, marginLeft: 'auto' }}>{credits} lookups spent{pending > 0 ? ` · ${pending} running` : ''}</span>}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ ...card, padding: '8px 16px' }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${V('lineSoft')}`, flexWrap: 'wrap' }}>
              <Link href={`/people/${r.id}`} style={{ fontWeight: 600, color: V('text'), minWidth: 170 }} dir="auto">
                {r.name ?? r.placeholderName}
              </Link>
              {r.role && <span style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{r.role}</span>}
              {r.company && <span style={{ ...chip(V('violet')), fontSize: 10.5 }} dir="auto">{r.company}</span>}

              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {!r.created && <span style={{ ...chip(V('faint')), fontSize: 10.5 }}>already listed</span>}
                {r.state === 'enriching' && <span style={{ ...label, color: V('cyan') }}>⟳ looking up…</span>}
                {r.state === 'done' && <span style={{ ...chip(V('ok')), fontSize: 10.5 }}>filled in</span>}
                {r.phone && <span style={{ ...chip(V('amber')), fontSize: 10.5 }}>needs a name</span>}
                {r.state === 'failed' && (
                  <>
                    <span style={{ ...chip(V('red')), fontSize: 10.5 }} title={r.error}>lookup failed</span>
                    <button style={{ ...ghostBtn, fontSize: 11, padding: '3px 9px' }} onClick={() => retry(r)}>retry</button>
                  </>
                )}
              </span>
              {r.state === 'failed' && r.error && (
                <div style={{ width: '100%', color: V('faint'), fontSize: 11.5, fontFamily: 'var(--mono)' }}>{r.error}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {rejected.length > 0 && (
        <div style={{ ...card, padding: '12px 16px', borderColor: V('red') }}>
          <div style={{ ...label, color: V('red') }}>Could not read these lines</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {rejected.map((r) => (
              <div key={r.line} style={{ fontSize: 12.5, display: 'flex', gap: 10 }}>
                <span style={{ ...label, minWidth: 52 }}>line {r.line}</span>
                <code style={{ color: V('muted'), flex: 1, wordBreak: 'break-all' }}>{r.raw}</code>
                <span style={{ color: V('faint') }}>{r.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
