'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { PersonListItem } from '@/lib/data/people';
import { deletePerson, mergePeople, updatePersonFields } from '@/lib/actions';
import {
  V, card, Empty, ghostBtn, inp, label, PageHead, personStatusOrder, primaryBtn, statusMeta,
} from '../_components/ui';

export function ManageView({ people, companies }: { people: PersonListItem[]; companies: { id: number; name: string }[] }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [, start] = useTransition();

  /**
   * Duplicate suggestions come from an exact match on the normalized name, which
   * is what the identity layer deliberately refuses to merge on its own. The old
   * console ran an O(n²) Levenshtein pass in the browser over every pair; an
   * indexed exact match finds the same real duplicates without the quadratic cost.
   */
  const clusters = useMemo(() => {
    const byKey = new Map<string, PersonListItem[]>();
    for (const p of people) {
      const key = p.name.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(p);
    }
    return [...byKey.values()].filter((g) => g.length > 1);
  }, [people]);

  const filtered = people.filter(
    (p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.companyName.toLowerCase().includes(q.toLowerCase()),
  );

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <PageHead
        title="Manage & dedupe"
        sub={`${people.length} people · merge duplicates, edit, delete`}
        right={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" dir="auto" style={{ ...inp(), width: 220 }} />}
      />
      <datalist id="manage-companies">{companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>

      {selected.length >= 2 && (
        <div style={{ ...card, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, borderColor: V('cyan'), flexWrap: 'wrap' }}>
          <span style={label}>
            {selected.length} selected — merge into{' '}
            <b style={{ color: V('cyan') }} dir="auto">{people.find((p) => p.id === selected[0])?.name}</b>
          </span>
          <button
            style={{ ...primaryBtn(), marginLeft: 'auto' }}
            onClick={() => start(() => { mergePeople(selected[0], selected.slice(1)); setSelected([]); })}
          >
            ⤵ Merge selected
          </button>
          <button style={ghostBtn} onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {clusters.length > 0 && (
        <section style={{ ...card, padding: 16, marginBottom: 18 }}>
          <div style={{ ...label, marginBottom: 10 }}>Same name ({clusters.length})</div>
          <p style={{ color: V('muted'), fontSize: 12.5, margin: '0 0 12px' }}>
            These share a name. That is a suggestion, not a match — check the company before merging.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clusters.map((group) => (
              <div key={group[0].id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: `1px solid ${V('lineSoft')}`, paddingBottom: 8 }}>
                {group.map((p, j) => (
                  <span key={p.id} dir="auto" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <Link href={`/people/${p.id}`} style={{ fontWeight: j === 0 ? 600 : 400, color: V('text') }}>{p.name}</Link>
                    <span style={label}>{p.companyName || 'no company'}</span>
                    {j < group.length - 1 && <span style={{ color: V('faint') }}>≈</span>}
                  </span>
                ))}
                <button
                  onClick={() => start(() => { mergePeople(group[0].id, group.slice(1).map((p) => p.id)); })}
                  style={{ marginLeft: 'auto', font: 'inherit', fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: V('panel2'), color: V('cyan'), border: `1px solid ${V('cyanDim')}` }}
                >
                  ⤵ Merge into {group[0].name}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ ...card, padding: '4px 16px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['', 'Name', 'Role', 'Company', 'Circle', 'Status', ''].map((h, i) => (
                <th key={i} style={{ ...label, textAlign: 'left', padding: '10px 8px', borderBottom: `1px solid ${V('line')}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 400).map((p) => (
              <PersonRow key={p.id} p={p} selected={selected.includes(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty>No people match.</Empty>}
      </div>
    </>
  );
}

function PersonRow({ p, selected, onToggle }: { p: PersonListItem; selected: boolean; onToggle: () => void }) {
  const [name, setName] = useState(p.name);
  const [role, setRole] = useState(p.role);
  const [company, setCompany] = useState(p.companyName);
  const [status, setStatus] = useState(p.status);
  const [, start] = useTransition();

  const dirty = name !== p.name || role !== p.role || company !== p.companyName || status !== p.status;
  const cell = { padding: '7px 8px', borderBottom: `1px solid ${V('lineSoft')}`, verticalAlign: 'middle' as const };

  return (
    <tr>
      <td style={cell}><input type="checkbox" checked={selected} onChange={onToggle} /></td>
      <td style={cell}>
        <input value={name} onChange={(e) => setName(e.target.value)} dir="auto" style={{ ...inp(), padding: '4px 8px', fontSize: 12.5, width: 170 }} />
      </td>
      <td style={cell}>
        <input value={role} onChange={(e) => setRole(e.target.value)} dir="auto" style={{ ...inp(), padding: '4px 8px', fontSize: 12, width: 150 }} />
      </td>
      <td style={cell}>
        <input list="manage-companies" value={company} onChange={(e) => setCompany(e.target.value)} dir="auto" style={{ ...inp(), padding: '4px 8px', fontSize: 12, width: 150 }} />
      </td>
      {/* Circle is derived from the introduction graph, so it is shown, not edited. */}
      <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: 12, color: V('faint') }}>{p.circle ?? '—'}</td>
      <td style={cell}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inp(), padding: '4px 6px', fontSize: 12, color: statusMeta[status]?.color }}>
          {personStatusOrder.map((s) => <option key={s} value={s} style={{ color: '#000' }}>{statusMeta[s].label}</option>)}
        </select>
      </td>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <button
          onClick={() => start(() => { updatePersonFields(p.id, { full_name: name, role, company, status }); })}
          disabled={!dirty}
          style={{ font: 'inherit', fontSize: 11, padding: '4px 9px', borderRadius: 7, cursor: dirty ? 'pointer' : 'default', background: dirty ? V('cyan') : 'transparent', color: dirty ? '#fff' : V('faint'), border: `1px solid ${dirty ? 'transparent' : V('line')}` }}
        >
          save
        </button>
        <button
          onClick={() => { if (confirm(`Delete ${p.name}? Their conversations and introductions go too.`)) start(() => { deletePerson(p.id); }); }}
          style={{ marginLeft: 6, font: 'inherit', fontSize: 11, padding: '4px 8px', borderRadius: 7, cursor: 'pointer', background: 'transparent', color: V('red'), border: `1px solid ${V('line')}` }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
