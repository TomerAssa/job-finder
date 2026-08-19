'use client';
import { useEffect, useRef, useState } from 'react';
import { V, chip, ErrorNote, ghostBtn, inp, label } from '../_components/ui';

/**
 * Drop a file in rather than finding the right directory and a terminal.
 *
 * Uploads go straight into the ingest that the CLI would have run, so the two
 * routes into the product cannot drift.
 */
export function DropZone({
  kind, title, accept, hint, onDone, askName,
}: {
  kind: 'company-list' | 'connections' | 'cv';
  title: string;
  accept: string;
  hint: React.ReactNode;
  onDone?: () => void;
  /** Company lists are named, so a sector can be picked later. */
  askName?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('kind', kind);
      if (askName && name.trim()) form.set('name', name.trim());
      const res = await fetch('/api/setup/upload', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Upload failed (HTTP ${res.status})`);
      setResult(body.summary);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {askName && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this list — e.g. Health Tech (optional)"
          dir="auto"
          style={inp()}
        />
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void send(f);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        style={{
          border: `1.5px dashed ${over ? V('cyan') : V('line')}`,
          background: over ? V('panel2') : 'transparent',
          borderRadius: 10,
          padding: '18px 16px',
          textAlign: 'center',
          cursor: busy ? 'default' : 'pointer',
          transition: '.12s',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {busy ? 'reading…' : over ? `Drop ${title.toLowerCase()}` : `Drop ${title.toLowerCase()} here`}
        </div>
        <div style={{ ...label, marginTop: 5, textTransform: 'none', letterSpacing: 0, fontSize: 11.5 }}>
          or click to choose · {accept}
        </div>
        <input
          ref={input}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }}
        />
      </div>

      <div style={{ color: V('muted'), fontSize: 12, lineHeight: 1.6 }}>{hint}</div>
      {result && <span style={{ ...chip(V('ok')), fontSize: 10.5, justifySelf: 'start' }}>{result}</span>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

export function KeyFields({ onSaved }: { onSaved?: () => void }) {
  const [fields, setFields] = useState<{ key: string; label: string; hint: string; set: boolean; preview: string }[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/setup/keys')
      .then((r) => r.json())
      .then((b) => { if (alive) setFields(b.fields ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const dirty = Object.entries(values).filter(([, v]) => v.trim() !== '');

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/setup/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(dirty)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      setFields(body.fields ?? fields);
      setSaved(body.saved ?? []);
      setValues({});
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      {fields.map((f) => (
        <div key={f.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', gap: 10, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13 }}>{f.label}</div>
            <div style={{ ...label, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>{f.hint}</div>
          </div>
          <input
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            placeholder={f.set ? `saved · ${f.preview}` : 'not set'}
            spellCheck={false}
            autoComplete="off"
            style={{ ...inp(), fontFamily: 'var(--mono)', fontSize: 12, borderColor: f.set ? V('ok') : V('line') }}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={save} disabled={busy || dirty.length === 0} style={{ ...ghostBtn, opacity: busy || !dirty.length ? 0.55 : 1 }}>
          {busy ? 'saving…' : `Save ${dirty.length || ''} key${dirty.length === 1 ? '' : 's'}`}
        </button>
        {saved && saved.length > 0 && <span style={{ ...chip(V('ok')), fontSize: 10.5 }}>saved, in effect now</span>}
        <span style={{ color: V('faint'), fontSize: 11.5, flex: 1, minWidth: 240 }}>
          Written to your .env and applied immediately — no restart. Saved values are never
          sent back to the browser, only whether they are set.
        </span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
