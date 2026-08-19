'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deletePerson, mergePeople } from '@/lib/actions';
import { V, Backdrop, card, ghostBtn, inp, label, primaryBtn } from '../_components/ui';

export interface PersonRef {
  id: number;
  name: string;
  companyName: string;
  role: string;
  interactionCount: number;
}

/**
 * Merge and delete, right where the duplicates are visible.
 *
 * Spotting that two rows are the same person happens while scanning the list,
 * not after opening one of them — so the actions belong on the row. Both open a
 * dialog rather than acting on the click: these are destructive, and a list is
 * exactly where a misclick is easiest.
 */
export function RowActions({ person, all, compact }: { person: PersonRef; all: PersonRef[]; compact?: boolean }) {
  const [mode, setMode] = useState<'merge' | 'delete' | null>(null);

  const btn = {
    font: 'inherit',
    fontSize: compact ? 11 : 11.5,
    padding: compact ? '2px 7px' : '3px 9px',
    borderRadius: 7,
    cursor: 'pointer',
    background: 'transparent',
    border: `1px solid ${V('line')}`,
    lineHeight: 1.6,
  } as const;

  return (
    <>
      <span style={{ display: 'inline-flex', gap: 5 }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <button style={{ ...btn, color: V('muted') }} onClick={() => setMode('merge')} title="Merge another record into this one">
          merge
        </button>
        <button style={{ ...btn, color: V('red') }} onClick={() => setMode('delete')} title="Delete this person">
          ✕
        </button>
      </span>
      {mode === 'merge' && <MergeDialog person={person} all={all} onClose={() => setMode(null)} />}
      {mode === 'delete' && <DeleteDialog person={person} onClose={() => setMode(null)} />}
    </>
  );
}

const panel = {
  ...card,
  width: 'min(520px, 94vw)',
  maxHeight: '86vh',
  overflowY: 'auto',
  padding: '18px 22px',
  boxShadow: '0 30px 80px -26px rgba(20,40,80,.5)',
  // Contact names and companies are arbitrary user text, frequently long and
  // frequently Hebrew. Without this they run straight out of the dialog.
  overflowWrap: 'anywhere',
} as const;

function MergeDialog({ person, all, onClose }: { person: PersonRef; all: PersonRef[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<PersonRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = q.trim()
    ? all
        .filter((c) => c.id !== person.id)
        .filter((c) => `${c.name} ${c.companyName}`.toLowerCase().includes(q.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  const merge = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const res = await mergePeople(person.id, [picked.id]);
    setBusy(false);
    if (!res.ok) {
      // Most often a list that went stale after an earlier merge.
      setError(res.error);
      router.refresh();
      return;
    }
    onClose();
    router.refresh();
  };

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={{ ...label, color: V('cyan') }}>Merge into {person.name}</div>
        <p style={{ color: V('muted'), fontSize: 12.5, lineHeight: 1.6, margin: '8px 0 12px' }}>
          Keeps <b style={{ color: V('text') }} dir="auto">{person.name}</b> and folds the other
          record in — missing fields filled from it, conversations and introductions moved across.
        </p>

        {error && (
          <div style={{ border: `1px solid ${V('red')}`, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12.5, color: V('text') }}>
            <span style={{ ...label, color: V('red') }}>could not merge</span>{' '}
            {error}
          </div>
        )}

        {picked ? (
          <>
            <div style={{ background: V('bg2'), borderRadius: 8, padding: '10px 12px', fontSize: 13, overflowWrap: 'anywhere' }}>
              <b dir="auto">{picked.name}</b>
              <span style={{ color: V('faint') }} dir="auto">
                {' '}{[picked.role, picked.companyName].filter(Boolean).join(' · ') || 'no company'}
              </span>
              {picked.interactionCount > 0 && (
                <div style={{ ...label, marginTop: 4 }}>
                  {picked.interactionCount} logged {picked.interactionCount === 1 ? 'conversation' : 'conversations'} move across
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={primaryBtn(busy)} disabled={busy} onClick={merge}>{busy ? 'merging…' : 'Merge'}</button>
              <button style={ghostBtn} onClick={() => setPicked(null)}>Pick someone else</button>
            </div>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the person to merge in…"
              dir="auto"
              style={{ ...inp(), width: '100%' }}
            />
            <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
              {matches.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPicked(c)}
                  style={{ font: 'inherit', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: V('bg2'), border: `1px solid ${V('line')}`, color: V('text'), overflowWrap: 'anywhere' }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, minWidth: 0 }} dir="auto">{c.name}</span>
                  <span style={{ color: V('faint'), fontSize: 12, minWidth: 0 }} dir="auto">
                    {[c.role, c.companyName].filter(Boolean).join(' · ') || 'no company'}
                  </span>
                  {c.interactionCount > 0 && <span style={{ marginLeft: 'auto', ...label, whiteSpace: 'nowrap' }}>{c.interactionCount} talks</span>}
                </button>
              ))}
              {q.trim() && matches.length === 0 && <span style={{ color: V('faint'), fontSize: 12.5 }}>Nobody matches.</span>}
            </div>
            <button style={{ ...ghostBtn, marginTop: 12 }} onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </Backdrop>
  );
}

function DeleteDialog({ person, onClose }: { person: PersonRef; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    await deletePerson(person.id);
    onClose();
    router.refresh();
  };

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...panel, borderColor: V('red') }}>
        <div style={{ ...label, color: V('red') }}>Delete {person.name}?</div>
        <p style={{ color: V('muted'), fontSize: 12.5, lineHeight: 1.6, margin: '8px 0 0' }}>
          {person.interactionCount > 0 ? (
            <>
              This also deletes their {person.interactionCount} logged{' '}
              {person.interactionCount === 1 ? 'conversation' : 'conversations'} and any
              introductions. If this is a duplicate of someone real, merge instead to keep the history.
            </>
          ) : (
            <>No conversations are recorded against them, so nothing else is lost.</>
          )}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            onClick={remove}
            disabled={busy}
            style={{ font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: V('red'), color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'deleting…' : 'Delete'}
          </button>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Backdrop>
  );
}
