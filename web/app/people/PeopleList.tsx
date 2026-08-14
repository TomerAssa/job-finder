'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PersonListItem } from '@/lib/data/people';
import {
  V, card, chip, circleBadge, daysAgo, Empty, FilterGroup, giveMeta, inp, label,
  PageHead, personStatusOrder, primaryBtn, Segmented, statusMeta, StatusChip, td,
} from '../_components/ui';

type View = 'cards' | 'table';

export function PeopleList({
  people,
  pool,
}: {
  people: PersonListItem[];
  pool: { total: number; hiring: number; promoted: number };
}) {
  const [view, setView] = useState<View>('cards');
  const [statusF, setStatusF] = useState('all');
  const [circleF, setCircleF] = useState('all');
  const [giveF, setGiveF] = useState('all');
  const [q, setQ] = useState('');

  const circles = useMemo(
    () => [...new Set(people.map((p) => p.circle).filter((c): c is number => c != null))].sort((a, b) => a - b),
    [people],
  );

  const filtered = people.filter((p) => {
    if (statusF !== 'all' && p.status !== statusF) return false;
    if (circleF !== 'all' && String(p.circle ?? '') !== circleF) return false;
    if (giveF !== 'all' && !p.give.includes(giveF)) return false;
    if (q.trim()) {
      const hay = `${p.name} ${p.role} ${p.companyName}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const connectors = people.filter((p) => p.ledMeToCount > 0).length;

  return (
    <>
      <PageHead
        title="People"
        sub={`${people.length} in your list · ${connectors} have introduced you to someone`}
        right={
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Segmented value={view} options={[['cards', 'Cards'], ['table', 'Table']]} onChange={(v) => setView(v as View)} />
            <Link href="/people/import" style={{ ...primaryBtn(), textDecoration: 'none', display: 'inline-block' }}>
              + Add people
            </Link>
          </div>
        }
      />

      {pool.total > 0 && (
        <Link
          href="/people/import?tab=pool"
          style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 16, textDecoration: 'none', color: V('text'), borderColor: pool.hiring > 0 ? V('cyan') : V('line') }}
        >
          <span style={{ ...label, color: pool.hiring > 0 ? V('cyan') : V('faint') }}>LinkedIn pool</span>
          <span style={{ fontSize: 13 }}>
            {pool.hiring > 0 ? (
              <><b>{pool.hiring}</b> of your {pool.total} connections work somewhere that is hiring</>
            ) : (
              <>{pool.total} connections imported, none at a company with open roles yet</>
            )}
          </span>
          <span style={{ marginLeft: 'auto', ...label, color: V('cyan') }}>review →</span>
        </Link>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 18, alignItems: 'flex-end' }}>
        <FilterGroup
          title="Status"
          value={statusF}
          onChange={setStatusF}
          options={[['all', 'All'], ...personStatusOrder.map((s) => [s, statusMeta[s].label] as [string, string])]}
          colorFor={(v) => statusMeta[v]?.color}
        />
        <FilterGroup
          title="Circle"
          value={circleF}
          onChange={setCircleF}
          options={[['all', 'All'], ...circles.map((c) => [String(c), `Circle ${c}`] as [string, string])]}
        />
        <FilterGroup
          title="Can give"
          value={giveF}
          onChange={setGiveF}
          options={[['all', 'All'], ...Object.keys(giveMeta).map((g) => [g, giveMeta[g].label] as [string, string])]}
          colorFor={(v) => giveMeta[v]?.color}
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, role, company…"
          dir="auto"
          style={{ ...inp(), width: 240, marginLeft: 'auto' }}
        />
      </div>

      {filtered.length === 0 && (
        <Empty>
          {people.length === 0
            ? 'Nobody here yet — add people from LinkedIn URLs, phone numbers, or your connections export.'
            : 'No people match these filters.'}
        </Empty>
      )}

      {view === 'cards' && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px,1fr))', gap: 12 }}>
          {filtered.map((p) => (
            <Link key={p.id} href={`/people/${p.id}`} style={{ ...card, padding: '13px 15px', textDecoration: 'none', color: V('text'), display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }} dir="auto">{p.name}</span>
                <span style={circleBadge}>{p.circle != null ? `circle ${p.circle}` : 'circle —'}</span>
              </div>
              <div style={{ color: V('muted'), fontSize: 12.5, margin: '4px 0 8px' }} dir="auto">
                {[p.role, p.companyName].filter(Boolean).join(' · ') || '—'}
              </div>
              {p.summary && (
                <div style={{ color: V('faint'), fontSize: 12, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} dir="auto">
                  {p.summary}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <StatusChip st={p.status} />
                <span style={{ ...label, letterSpacing: '.04em' }}>
                  {p.interactionCount > 0 ? `spoke ${daysAgo(p.lastInteractionAt)}` : 'never spoke'}
                </span>
              </div>
              {p.ledMeToCount > 0 && (
                <div style={{ ...label, color: V('cyan'), marginTop: 8 }}>
                  led me to {p.ledMeToCount} {p.ledMeToCount === 1 ? 'contact' : 'contacts'}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {view === 'table' && filtered.length > 0 && (
        <div style={{ ...card, padding: '4px 16px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Role', 'Company', 'Circle', 'Led me to them', 'Status', 'Last talked', 'Contact'].map((h) => (
                  <th key={h} style={{ ...label, textAlign: 'left', padding: '10px', borderBottom: `1px solid ${V('line')}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={td()} dir="auto">
                    <Link href={`/people/${p.id}`} style={{ color: V('text'), fontWeight: 600 }}>{p.name}</Link>
                  </td>
                  <td style={td()} dir="auto">{p.role || '—'}</td>
                  <td style={td()} dir="auto">{p.companyName || '—'}</td>
                  <td style={td()}><span style={circleBadge}>{p.circle ?? '—'}</span></td>
                  <td style={td()} dir="auto">{p.introducedBy ?? '—'}</td>
                  <td style={td()}><StatusChip st={p.status} /></td>
                  <td style={{ ...td(), ...label }}>{p.interactionCount > 0 ? daysAgo(p.lastInteractionAt) : '—'}</td>
                  <td style={td()}>
                    {p.linkedin ? (
                      <a href={p.linkedin} target="_blank" rel="noreferrer" style={{ color: V('cyan') }}>in ↗</a>
                    ) : (
                      <span style={{ color: V('faint'), fontFamily: 'var(--mono)', fontSize: 11 }} dir="auto">{p.phone || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
