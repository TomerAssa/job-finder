'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { PoolItem } from '@/lib/data/people';
import { addPerson, promoteConnections } from '@/lib/actions';
import {
  V, card, chip, Empty, Field, ghostBtn, inp, label, PageHead, primaryBtn, Segmented,
} from '../../_components/ui';
import { BulkPaste } from './BulkPaste';

type Tab = 'bulk' | 'add' | 'pool';

export function ImportView({
  initialTab, pool, stats,
}: {
  initialTab: Tab;
  pool: PoolItem[];
  stats: { total: number; hiring: number; promoted: number };
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <>
      <Link href="/people" style={{ ...label, color: V('cyan'), textDecoration: 'none' }}>← People</Link>
      <div style={{ marginTop: 12 }}>
        <PageHead
          title="Add people"
          sub="Paste a list, add someone by hand, or pull them out of your LinkedIn connections export"
          right={
            <Segmented
              value={tab}
              options={[['bulk', 'Paste a list'], ['add', 'Add one'], ['pool', `LinkedIn pool (${stats.total})`]]}
              onChange={(v) => setTab(v as Tab)}
            />
          }
        />
      </div>

      {tab === 'bulk' && <BulkPaste />}
      {tab === 'add' && <AddOne />}
      {tab === 'pool' && <Pool pool={pool} stats={stats} />}
    </>
  );
}

function AddOne() {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [phone, setPhone] = useState('');
  const [introducer, setIntroducer] = useState('');
  const [introducerIsSource, setIntroducerIsSource] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [, start] = useTransition();

  const reset = () => {
    setFullName(''); setRole(''); setCompany(''); setLinkedin(''); setPhone('');
    setIntroducer(''); setIntroducerIsSource(false);
  };

  return (
    <div style={{ ...card, padding: 20, maxWidth: 620, display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field l="Name"><input value={fullName} onChange={(e) => setFullName(e.target.value)} dir="auto" style={inp()} /></Field>
        <Field l="Role"><input value={role} onChange={(e) => setRole(e.target.value)} dir="auto" style={inp()} /></Field>
      </div>
      <Field l="Company"><input value={company} onChange={(e) => setCompany(e.target.value)} dir="auto" style={inp()} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field l="LinkedIn URL"><input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/…" style={inp()} /></Field>
        <Field l="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="054-123-4567" style={inp()} /></Field>
      </div>
      <Field l="Who led you to them">
        <input value={introducer} onChange={(e) => setIntroducer(e.target.value)} placeholder="Leave empty if you reached them directly" dir="auto" style={inp()} />
      </Field>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted'), cursor: 'pointer' }}>
        <input type="checkbox" checked={introducerIsSource} onChange={(e) => setIntroducerIsSource(e.target.checked)} />
        that is a community or group, not a person
      </label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          style={primaryBtn(!fullName.trim())}
          disabled={!fullName.trim()}
          onClick={() => start(async () => {
            const r = await addPerson({
              full_name: fullName, role, company, linkedin_url: linkedin, phone,
              introducerName: introducer, introducerIsSource,
            });
            setResult(r.created ? `Added ${fullName}.` : `${fullName} was already in your list — filled in what was missing.`);
            reset();
          })}
        >
          Add person
        </button>
        {result && <span style={{ color: V('muted'), fontSize: 13 }}>{result}</span>}
      </div>

      <p style={{ color: V('faint'), fontSize: 12, lineHeight: 1.7, margin: 0 }}>
        A LinkedIn URL or a phone number is what makes someone identifiable — with one of
        those, re-importing or scraping them later updates this person instead of creating
        a second copy.
      </p>
    </div>
  );
}

function Pool({ pool, stats }: { pool: PoolItem[]; stats: { total: number; hiring: number; promoted: number } }) {
  const [q, setQ] = useState('');
  const [hiringOnly, setHiringOnly] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [, start] = useTransition();

  const filtered = pool.filter((c) => {
    if (hiringOnly && c.openPositions === 0) return false;
    if (q.trim()) {
      const hay = `${c.name} ${c.company}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (stats.total === 0 && stats.promoted === 0) {
    return (
      <Empty>
        No connections imported yet. Export them from LinkedIn (Settings → Data Privacy →
        Get a copy of your data → Connections), drop the CSV in <code>data/input/</code>,
        and run <code>npm run ingest</code>.
      </Empty>
    );
  }

  return (
    <>
      <p style={{ color: V('muted'), fontSize: 13, maxWidth: 640, marginTop: 0 }}>
        Your LinkedIn export, kept separate on purpose — most of these are people you will
        never talk to. Pick the ones you actually want in your list.
        {stats.promoted > 0 && <> {stats.promoted} already added.</>}
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        <button style={hiringOnly ? primaryBtn() : ghostBtn} onClick={() => setHiringOnly(!hiringOnly)}>
          {hiringOnly ? `✓ Only where there are open roles (${stats.hiring})` : 'Show all'}
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or company…" dir="auto" style={{ ...inp(), width: 240 }} />
        {selected.length > 0 && (
          <button
            style={{ ...primaryBtn(), marginLeft: 'auto' }}
            onClick={() => start(() => { promoteConnections(selected); setSelected([]); })}
          >
            Add {selected.length} to my people
          </button>
        )}
      </div>

      <div style={{ ...card, padding: '8px 16px' }}>
        {filtered.length === 0 && <Empty>Nothing matches.</Empty>}
        {filtered.map((c) => (
          <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${V('lineSoft')}`, cursor: 'pointer', flexWrap: 'wrap' }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span style={{ fontWeight: 600, minWidth: 160 }} dir="auto">{c.name}</span>
            <span style={{ color: V('muted'), fontSize: 12.5, minWidth: 140 }} dir="auto">{c.company || '—'}</span>
            <span style={{ color: V('faint'), fontSize: 12.5, flex: 1, minWidth: 120 }} dir="auto">{c.position}</span>
            {c.openPositions > 0 && (
              <span style={{ ...chip(V('ok')), fontSize: 10.5 }}>
                {c.openPositions} open {c.openPositions === 1 ? 'role' : 'roles'}
              </span>
            )}
            {c.possibleDuplicate && (
              <span style={{ ...chip(V('amber')), fontSize: 10.5 }} title="Someone with this name is already in your list">
                already listed?
              </span>
            )}
            {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: V('cyan') }}>in ↗</a>}
          </label>
        ))}
      </div>
    </>
  );
}
