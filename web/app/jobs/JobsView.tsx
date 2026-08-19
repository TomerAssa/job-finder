'use client';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { RoleItem } from '@/lib/data/jobs';
import { setRoleStatus } from '@/lib/actions';
import {
  V, cap, card, chip, Empty, FilterGroup, inp, label, PageHead, roleStatusMeta,
  roleStatusOrder, Segmented, senChip,
} from '../_components/ui';

/** Which field the text box matches. Shown, so it is never a guess. */
const SEARCH_FIELDS = [
  ['all', 'Everything'],
  ['company', 'Company'],
  ['title', 'Job title'],
  ['location', 'Location'],
] as const;
type SearchField = (typeof SEARCH_FIELDS)[number][0];

export function JobsView({ roles: initial }: { roles: RoleItem[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [roles, setRoles] = useState(initial);
  const [, start] = useTransition();

  // View and filters live in the URL: a reload, a back button or a shared link
  // all land on the same screen. Losing the board every time you looked at a
  // company made it useless for actually working through a list.
  const view = (params.get('view') === 'board' ? 'board' : 'list') as 'list' | 'board';
  // Roles you have not dealt with yet are the point of the list; everything
  // else is history, one click away.
  const statusF = params.get('status') ?? 'relevant';
  const senF = params.get('sen') ?? 'all';
  const pathF = params.get('path') ?? 'all';
  const field = (params.get('field') ?? 'all') as SearchField;
  const q = params.get('q') ?? '';

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '' || (k === 'status' && v === 'relevant')) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `/jobs?${qs}` : '/jobs', { scroll: false });
    },
    [params, router],
  );

  // Typing should not push a history entry per keystroke.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => setParam({ q: draft }), 250);
    return () => clearTimeout(t);
  }, [draft, q, setParam]);

  const seniorities = useMemo(() => [...new Set(roles.map((r) => r.seniority))], [roles]);

  const changeStatus = (id: number, status: string) => {
    setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    start(() => { setRoleStatus(id, status); });
  };

  const filtered = roles.filter((r) => {
    if (statusF !== 'all' && r.status !== statusF) return false;
    if (senF !== 'all' && r.seniority !== senF) return false;
    if (pathF === 'warm' && r.paths === 0) return false;
    if (pathF === 'nopath' && r.paths > 0) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const hay =
        field === 'company' ? r.companyName
        : field === 'title' ? r.title
        : field === 'location' ? r.location
        : `${r.companyName} ${r.title} ${r.location}`;
      if (!hay.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  const companyCount = new Set(filtered.map((r) => r.companyId)).size;

  return (
    <>
      <PageHead
        title="Jobs & Companies"
        sub={`${filtered.length} of ${roles.length} roles · ${companyCount} companies`}
        right={<Segmented value={view} options={[['list', 'List'], ['board', 'Board']]} onChange={(v) => setParam({ view: v === 'board' ? 'board' : null })} />}
      />

      {view === 'list' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 16, alignItems: 'flex-end' }}>
            <FilterGroup
              title="Status"
              value={statusF}
              onChange={(v) => setParam({ status: v })}
              options={[['all', 'All'], ...roleStatusOrder.map((s) => [s, roleStatusMeta[s].label] as [string, string])]}
              colorFor={(v) => roleStatusMeta[v]?.color}
            />
            <FilterGroup
              title="Seniority"
              value={senF}
              onChange={(v) => setParam({ sen: v === 'all' ? null : v })}
              options={[['all', 'All'], ...seniorities.map((s) => [s, cap(s)] as [string, string])]}
            />
            <FilterGroup
              title="Path"
              value={pathF}
              onChange={(v) => setParam({ path: v === 'all' ? null : v })}
              options={[['all', 'All'], ['warm', 'Has a path'], ['nopath', 'No path']]}
              colorFor={(v) => (v === 'warm' ? V('ok') : v === 'nopath' ? V('red') : undefined)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginLeft: 'auto' }}>
              <span style={label}>
                Search <span style={{ color: V('cyan') }}>{SEARCH_FIELDS.find(([k]) => k === field)?.[1]}</span>
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={field}
                  onChange={(e) => setParam({ field: e.target.value === 'all' ? null : e.target.value })}
                  style={{ ...inp(), padding: '7px 8px', fontSize: 12 }}
                >
                  {SEARCH_FIELDS.map(([k, l]) => <option key={k} value={k} style={{ color: '#000' }}>{l}</option>)}
                </select>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={field === 'all' ? 'company, title or location…' : `${SEARCH_FIELDS.find(([k]) => k === field)?.[1]}…`}
                  dir="auto"
                  style={{ ...inp(), width: 210 }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((r) => (
              <div key={r.id} style={{ ...card, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Link href={`/companies/${r.companyId}?role=${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none', color: V('text') }}>
                  <span style={{ width: 14, color: V('amber') }}>{r.paths > 0 ? '★' : ''}</span>
                  <b style={{ minWidth: 150 }} dir="auto">{r.companyName}</b>
                  <span style={{ flex: 1, minWidth: 0 }} dir="auto">{r.title}</span>
                  <span style={senChip}>{r.seniority}</span>
                  {(r.minYears != null || r.maxYears != null) && (
                    <span style={{ ...label, minWidth: 54 }}>
                      {r.minYears ?? '?'}–{r.maxYears ?? '?'} yrs
                    </span>
                  )}
                  <span style={{ ...label, minWidth: 96 }} dir="auto">{r.location}</span>
                  <span style={chip(r.paths > 0 ? V('ok') : V('red'))}>
                    {r.paths > 0 ? `${r.paths} ${r.paths === 1 ? 'path' : 'paths'}` : 'no path'}
                  </span>
                </Link>
                <select
                  value={r.status}
                  onChange={(e) => changeStatus(r.id, e.target.value)}
                  title="Change relevance / status"
                  style={{ ...inp(), padding: '5px 8px', fontSize: 12, color: roleStatusMeta[r.status]?.color, borderColor: roleStatusMeta[r.status]?.color, cursor: 'pointer' }}
                >
                  {roleStatusOrder.map((s) => <option key={s} value={s} style={{ color: '#000' }}>{roleStatusMeta[s].label}</option>)}
                </select>
              </div>
            ))}
            {filtered.length === 0 && (
              <Empty>{roles.length === 0 ? 'No roles yet — run a search to find some.' : 'No roles match these filters.'}</Empty>
            )}
          </div>
        </>
      )}

      {view === 'board' && <Board roles={filtered} onDrop={changeStatus} />}
    </>
  );
}

/**
 * The Kanban. Plain HTML5 drag-and-drop, no library.
 *
 * It renders the filtered set — the old board ignored the list's filters, so
 * switching views silently changed which roles you were looking at.
 */
function Board({ roles, onDrop }: { roles: RoleItem[]; onDrop: (id: number, status: string) => void }) {
  const [drag, setDrag] = useState<number | null>(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${roleStatusOrder.length}, minmax(0,1fr))`, gap: 12 }}>
      {roleStatusOrder.map((st) => {
        const col = roles.filter((r) => r.status === st);
        const color = roleStatusMeta[st].color;
        return (
          <div
            key={st}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (drag != null) onDrop(drag, st); setDrag(null); }}
            style={{ background: V('bg2'), border: `1px solid ${V('line')}`, borderRadius: 10, padding: 8, minHeight: 120 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 10px' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
              <span style={label}>{roleStatusMeta[st].label}</span>
              <span style={{ marginLeft: 'auto', ...label }}>{col.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.map((r) => (
                <div
                  key={r.id}
                  draggable
                  onDragStart={() => setDrag(r.id)}
                  onDragEnd={() => setDrag(null)}
                  style={{ background: V('panel'), border: `1px solid ${V('line')}`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '9px 11px', cursor: 'grab' }}
                >
                  <Link href={`/companies/${r.companyId}?role=${r.id}`} style={{ textDecoration: 'none', color: V('text') }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }} dir="auto">{r.paths > 0 ? '★ ' : ''}{r.companyName}</div>
                    <div style={{ color: V('muted'), fontSize: 12 }} dir="auto">{r.title}</div>
                  </Link>
                  <div style={{ ...label, marginTop: 6 }}>{r.seniority} · drag ⇄</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
