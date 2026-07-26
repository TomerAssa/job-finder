'use client';
import { useEffect, useMemo, useState, useTransition, CSSProperties } from 'react';
import type { ConsoleData, Person, Role, Company } from '@/lib/console-data';
import { setPersonStatus, setPersonNotes, setRoleStatus, addPerson, expandEmployees, logOutreach, setRoleNote, addLead, setContactVia, updateEntity, deleteEntity, mergeEntities } from '@/lib/actions';

// tiny levenshtein ratio for fuzzy duplicate detection
function sim(a: string, b: string): number {
  a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
  if (!a || !b) return 0; if (a === b) return 1;
  const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

// ── token themes (from the handoff) ──
const THEMES: Record<string, Record<string, string>> = {
  light: { bg: '#eef3fa', bg2: '#e3ecf8', panel: '#ffffff', panel2: '#f4f8fe', line: '#d6e1f1', lineSoft: '#e7eef8', text: '#17233c', muted: '#56658a', faint: '#93a1bd', amber: '#c98a1e', amberDim: '#e6d6b0', cyan: '#2f6bed', cyanDim: '#b8cdf5', violet: '#5b62d6', ok: '#2e9e6b', red: '#d9534f' },
  dark: { bg: '#0b1220', bg2: '#101a30', panel: '#14203a', panel2: '#1b2949', line: '#28385f', lineSoft: '#1b2846', text: '#dbe6f8', muted: '#8b9cc0', faint: '#5a6b8e', amber: '#e7b24b', amberDim: '#6b5a2c', cyan: '#5aa0ff', cyanDim: '#2f5aa0', violet: '#8f92f0', ok: '#5cc487', red: '#ea6a63' },
};
const V = (k: string) => `var(--${k})`;

const statusMeta: Record<string, { label: string; color: string }> = {
  'new': { label: 'New lead', color: V('violet') }, 'to-reach': { label: "Haven't talked", color: V('amber') },
  'talked': { label: 'Talked', color: V('cyan') }, 'following-up': { label: 'Following up', color: V('amber') }, 'done': { label: 'Done', color: V('ok') },
};
const personStatusOrder = ['new', 'to-reach', 'talked', 'following-up', 'done'];
const giveMeta: Record<string, { label: string; color: string }> = {
  intro: { label: 'Intro', color: V('cyan') }, lead: { label: 'Lead', color: V('amber') }, advice: { label: 'Advice', color: V('violet') }, referral: { label: 'Referral', color: V('ok') },
};
const roleStatusMeta: Record<string, { label: string; color: string }> = {
  rejected: { label: 'Not relevant / Rejected', color: V('red') },
  relevant: { label: 'Relevant — not applied', color: V('cyan') },
  applied: { label: 'Applied (CV sent)', color: V('amber') },
  in_process: { label: 'In process', color: V('violet') },
  via_people: { label: 'Applied via people', color: V('ok') },
};
const roleStatusOrder = ['rejected', 'relevant', 'applied', 'in_process', 'via_people'];
const outreachOrder = ['none', 'cold', 'request', 'wrote', 'submitted', 'connected', 'not_relevant'];
const outreachMeta: Record<string, { label: string; color: string }> = {
  none: { label: 'Set status', color: V('faint') },
  cold: { label: 'Cold approach', color: V('violet') },
  request: { label: 'Connection request sent', color: V('cyan') },
  wrote: { label: 'Wrote to them', color: V('amber') },
  submitted: { label: 'Submitted CV', color: V('ok') },
  connected: { label: 'Connected me onward', color: V('cyan') },
  not_relevant: { label: 'Not relevant', color: V('red') },
};
const contactTypeMeta: Record<string, { label: string; color: string }> = {
  pm: { label: 'Product contacts', color: V('cyan') }, hr: { label: 'HR / Talent', color: V('amber') }, found: { label: 'You added', color: V('violet') },
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const initials = (n: string) => (n || '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

// ── style helpers ──
const pill = (active: boolean, color?: string): CSSProperties => ({
  font: 'inherit', fontSize: 12, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--mono)', letterSpacing: '.02em', transition: '.12s',
  ...(active ? { background: color ?? V('cyan'), color: '#fff', border: '1px solid transparent', fontWeight: 600 } : { background: 'transparent', color: V('muted'), border: `1px solid ${V('line')}` }),
});
const seg = (active: boolean): CSSProperties => ({ font: 'inherit', fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', border: 'none', transition: '.12s', ...(active ? { background: V('cyan'), color: '#fff', fontWeight: 600 } : { background: 'transparent', color: V('muted') }) });
const chip = (color: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 10px', borderRadius: 999, color, border: '1px solid currentColor', whiteSpace: 'nowrap' });
const circleBadge: CSSProperties = { fontFamily: 'var(--mono)', fontSize: 10.5, color: V('amber'), border: `1px solid ${V('amberDim')}`, borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' };
const senChip: CSSProperties = { fontFamily: 'var(--mono)', fontSize: 10.5, color: V('cyan'), border: `1px solid ${V('cyanDim')}`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' };
const label: CSSProperties = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: V('faint') };
const card: CSSProperties = { background: V('panel'), border: `1px solid ${V('line')}`, borderRadius: 11 };

export default function Console({ data, initialFacet, initialCompany }: { data: ConsoleData; initialFacet?: string; initialCompany?: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [facet, setFacet] = useState<'people' | 'jobs' | 'network' | 'manage'>(
    (['people', 'jobs', 'network', 'manage'].includes(initialFacet ?? '') ? initialFacet : 'people') as any,
  );
  const [people, setPeople] = useState<Person[]>(data.people);
  const [roles, setRoles] = useState<Role[]>(data.roles);
  const [, start] = useTransition();
  // re-sync from server after any mutation revalidates (keeps merges/edits correct)
  useEffect(() => { setPeople(data.people); setRoles(data.roles); }, [data]);

  const companies = data.companies, sources = data.sources;
  const companyById = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const personById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const srcById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s])), [sources]);
  const cName = (ci: string) => companyById[ci]?.name ?? '';

  const themeVars = Object.fromEntries(Object.entries(THEMES[theme]).map(([k, v]) => [`--${k}`, v])) as CSSProperties;

  // mutations (optimistic + persist)
  const changePersonStatus = (id: string, st: string) => { setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, status: st } : p))); start(() => { setPersonStatus(id, st); }); };
  const changeRoleStatus = (id: string, st: string) => { setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, status: st } : r))); start(() => { setRoleStatus(id, st); }); };
  const changeRoleNote = (id: string, note: string) => { setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, note } : r))); start(() => { setRoleNote(id, note); }); };
  const changeContactStatus = (id: string, companyId: string, st: string) => { setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, outreach: st } : p))); start(() => { logOutreach(id, companyId, st); }); };
  const changeContactVia = (id: string, companyId: string, via: string) => { setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, via } : p))); start(() => { setContactVia(id, companyId, via || null); }); };
  const addLeadTo = async (companyId: string, input: any) => { const lead = await addLead(companyId, input); if (lead) setPeople((ps) => [...ps, lead]); };
  const changePersonNotes = (id: string, notes: string) => { setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, notes } : p))); start(() => { setPersonNotes(id, notes); }); };
  const editEntity = (id: string, fields: any) => start(() => { updateEntity(id, fields); });
  const removeEntity = (id: string) => { setPeople((ps) => ps.filter((p) => p.id !== id)); start(() => { deleteEntity(id); }); };
  const mergePeople = (primary: string, dups: string[]) => { setPeople((ps) => ps.filter((p) => !dups.includes(p.id))); start(() => { mergeEntities(primary, dups); }); };
  const connectorNames = useMemo(() => people.filter((p) => p.circle === 1).map((p) => p.name), [people]);
  const peopleNames = useMemo(() => people.map((p) => p.name), [people]);

  return (
    <div style={{ ...themeVars, display: 'grid', gridTemplateColumns: '238px 1fr', minHeight: '100vh', background: V('bg'), color: V('text'), fontFamily: 'var(--body)', fontSize: 14, lineHeight: 1.5 } as CSSProperties}>
      <Sidebar {...{ facet, setFacet, theme, setTheme, counts: { people: people.length, jobs: roles.length, network: people.length + companies.length, manage: people.length } }} />
      <main style={{ height: '100vh', overflow: 'auto', padding: '30px 36px 72px', maxWidth: 1340 }}>
        {facet === 'people' && <PeopleFacet {...{ people, companies, sources, companyById, srcById, cName, changePersonStatus, changePersonNotes }} />}
        {facet === 'jobs' && <JobsFacet {...{ roles, companyById, cName, changeRoleStatus, changeRoleNote, changeContactStatus, changeContactVia, addLeadTo, connectorNames, peopleNames, companies, people, initialCompany }} />}
        {facet === 'network' && <NetworkFacet {...{ people, companies, sources }} />}
        {facet === 'manage' && <ManageFacet {...{ people, companies, cName, handlers: { editEntity, removeEntity, mergePeople } }} />}
      </main>
    </div>
  );
}

function Sidebar({ facet, setFacet, theme, setTheme, counts }: any) {
  const items = [
    { key: 'people', label: 'People', dot: V('cyan'), n: counts.people },
    { key: 'jobs', label: 'Jobs & Companies', dot: V('amber'), n: counts.jobs },
    { key: 'network', label: 'Network', dot: V('violet'), n: counts.network },
    { key: 'manage', label: 'Manage & dedupe', dot: V('ok'), n: counts.manage },
  ];
  return (
    <aside style={{ borderRight: `1px solid ${V('line')}`, background: `linear-gradient(180deg, ${V('panel')}, ${V('bg2')})`, padding: '22px 16px', position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: 22, letterSpacing: '-.01em' }}>Job<span style={{ color: V('cyan') }}>·</span>Console</div>
      <div style={{ ...label, marginTop: 4, letterSpacing: '.18em' }}>Outreach Intel</div>
      <nav style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map((it) => {
          const active = facet === it.key;
          return (
            <button key={it.key} onClick={() => setFacet(it.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: active ? V('text') : V('muted'), background: active ? V('panel2') : 'transparent', border: `1px solid ${active ? V('line') : 'transparent'}` }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: it.dot }} />
              <span style={{ flex: 1, fontWeight: 500 }}>{it.label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: active ? V('cyan') : V('faint') }}>{it.n}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={{ font: 'inherit', fontSize: 12.5, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', background: V('panel2'), color: V('muted'), border: `1px solid ${V('line')}`, textAlign: 'left' }}>{theme === 'dark' ? '☾ Dark' : '☀ Light'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: V('panel2'), border: `1px solid ${V('line')}`, display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: V('amber') }}>YOU</div>
          <div style={{ fontSize: 12.5 }}><div style={{ fontWeight: 600 }}>You</div><div style={{ color: V('faint'), fontSize: 11 }}>PM · Tel Aviv</div></div>
        </div>
      </div>
    </aside>
  );
}

function PageHead({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
      <div><h1 style={{ fontFamily: 'var(--display)', fontWeight: 400, fontSize: 30, letterSpacing: '-.02em', margin: 0 }}>{title}</h1><p style={{ color: V('muted'), margin: '6px 0 0' }}>{sub}</p></div>
      {right}
    </div>
  );
}
function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: V('panel2'), border: `1px solid ${V('line')}`, borderRadius: 8, padding: 2 }}>
      {options.map(([v, l]) => <button key={v} style={seg(value === v)} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}
function StatusChip({ st }: { st: string }) { const m = statusMeta[st] ?? { label: st, color: V('muted') }; return <span style={chip(m.color)}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />{m.label}</span>; }

// PEOPLE ------------------------------------------------------------------
function PeopleFacet({ people, companies, sources, companyById, srcById, cName, changePersonStatus, changePersonNotes }: any) {
  const [pView, setPView] = useState<'cards' | 'table' | 'connector'>('cards');
  const [statusF, setStatusF] = useState('all'); const [circleF, setCircleF] = useState('all'); const [giveF, setGiveF] = useState('all');
  const [sel, setSel] = useState<string>(people[0]?.id ?? '');
  const [addOpen, setAddOpen] = useState(false);

  const filtered = people.filter((p: Person) =>
    (statusF === 'all' || p.status === statusF) && (circleF === 'all' || String(p.circle) === circleF) && (giveF === 'all' || p.give.includes(giveF)));
  const selP: Person | undefined = people.find((p: Person) => p.id === sel) ?? filtered[0];

  return (
    <>
      <PageHead title="People" sub={`${people.length} in your network · ${people.filter((p: Person) => p.circle === 1).length} connectors`}
        right={<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Segmented value={pView} options={[['cards', 'Cards'], ['table', 'Table'], ['connector', 'Talk-to']]} onChange={(v) => setPView(v as any)} /><button onClick={() => setAddOpen(true)} style={{ font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: V('cyan'), color: '#fff', border: 'none' }}>+ Add person</button></div>} />

      {pView !== 'connector' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 18 }}>
          <FilterGroup title="Status" value={statusF} onChange={setStatusF} options={[['all', 'All'], ...personStatusOrder.map((s) => [s, statusMeta[s].label] as [string, string])]} colorFor={(v) => statusMeta[v]?.color} />
          <FilterGroup title="Circle" value={circleF} onChange={setCircleF} options={[['all', 'All'], ['1', 'Circle 1'], ['2', 'Circle 2'], ['3', 'Circle 3']]} />
          <FilterGroup title="Can give" value={giveF} onChange={setGiveF} options={[['all', 'All'], ...Object.keys(giveMeta).map((g) => [g, giveMeta[g].label] as [string, string])]} colorFor={(v) => giveMeta[v]?.color} />
        </div>
      )}

      {pView === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '76vh', overflow: 'auto', paddingRight: 4 }}>
            {filtered.map((p: Person) => (
              <button key={p.id} onClick={() => setSel(p.id)} style={{ ...card, padding: '13px 15px', textAlign: 'left', cursor: 'pointer', font: 'inherit', ...(selP?.id === p.id ? { borderColor: V('cyan'), boxShadow: `0 0 0 1px ${V('cyan')}` } : {}) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600 }} dir="auto">{p.name}</span><span style={circleBadge}>circle {p.circle}</span>
                </div>
                <div style={{ color: V('muted'), fontSize: 12.5, margin: '4px 0 8px' }} dir="auto">{[p.role, cName(p.ci)].filter(Boolean).join(' · ')}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <StatusChip st={p.status} /><span style={{ ...label, letterSpacing: '.04em' }}>{p.give.map((g) => giveMeta[g]?.label).join(' · ')}</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <div style={{ color: V('faint'), padding: 12 }}>No people match.</div>}
          </div>
          {selP && <PersonDetail p={selP} cName={cName} companyById={companyById} srcById={srcById} personById={Object.fromEntries(people.map((x: Person) => [x.id, x]))} onStatus={changePersonStatus} onNotes={changePersonNotes} />}
        </div>
      )}

      {pView === 'table' && (
        <div style={{ ...card, padding: '4px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Name', 'Role', 'Company', 'Circle', 'Connector', 'Status', 'Can give', 'Contact'].map((h) => <th key={h} style={{ ...label, textAlign: 'left', padding: '10px 10px', borderBottom: `1px solid ${V('line')}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((p: Person) => (
                <tr key={p.id} onClick={() => setSel(p.id)} style={{ cursor: 'pointer' }}>
                  <td style={td()} dir="auto"><b>{p.name}</b></td><td style={td()} dir="auto">{p.role}</td><td style={td()} dir="auto">{cName(p.ci)}</td>
                  <td style={td()}><span style={circleBadge}>{p.circle}</span></td>
                  <td style={td()} dir="auto">{p.viaId ? people.find((x: Person) => x.id === p.viaId)?.name : p.ledBy ? srcById[p.ledBy]?.name : '—'}</td>
                  <td style={td()}><StatusChip st={p.status} /></td><td style={{ ...td(), ...label, letterSpacing: '.04em' }}>{p.give.map((g) => giveMeta[g]?.label).join(' · ')}</td>
                  <td style={td()}>{p.linkedin ? <a href={p.linkedin} target="_blank" style={{ color: V('cyan') }}>in ↗</a> : <span style={{ color: V('faint'), fontFamily: 'var(--mono)', fontSize: 11 }} dir="auto">{p.phone || '—'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pView === 'connector' && <TalkTo people={people} cName={cName} />}

      {addOpen && <AddPersonModal people={people} sources={sources} companies={companies} onClose={() => setAddOpen(false)} onAdded={(id) => { setAddOpen(false); setPView('cards'); setSel(id); }} />}
    </>
  );
}
const td = (): CSSProperties => ({ padding: '11px 10px', borderBottom: `1px solid ${V('lineSoft')}`, verticalAlign: 'middle' });

function FilterGroup({ title, value, onChange, options, colorFor }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={label}>{title}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{options.map(([v, l]: [string, string]) => <button key={v} onClick={() => onChange(v)} style={pill(value === v, colorFor?.(v))}>{l}</button>)}</div>
    </div>
  );
}

function PersonDetail({ p, cName, companyById, srcById, personById, onStatus, onNotes }: any) {
  const c = companyById[p.ci];
  const via = p.viaId ? personById[p.viaId]?.name : p.ledBy ? srcById[p.ledBy]?.name : null;
  return (
    <div style={{ ...card, borderRadius: 12, boxShadow: `0 12px 34px -22px rgba(20,40,80,.4)` }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${V('line')}`, background: `linear-gradient(180deg, ${V('panel2')}, transparent)`, borderRadius: '12px 12px 0 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div><div style={{ fontFamily: 'var(--display)', fontSize: 24 }} dir="auto">{p.name}</div><div style={{ color: V('muted'), marginTop: 2 }} dir="auto">{[p.role, cName(p.ci)].filter(Boolean).join(' · ')}</div></div>
          <StatusChip st={p.status} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
          <span style={circleBadge}>circle {p.circle}</span>
          {p.give.map((g: string) => <span key={g} style={{ ...chip(giveMeta[g]?.color), fontSize: 10.5, padding: '2px 9px' }}>{giveMeta[g]?.label}</span>)}
          {p.linkedin && <a href={p.linkedin} target="_blank" style={{ ...chip(V('cyan')), textDecoration: 'none' }}>in ↗</a>}
          {p.phone && <span style={chip(V('faint'))} dir="auto">{p.phone}</span>}
        </div>
      </div>
      <div style={{ padding: '18px 20px', display: 'grid', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div><div style={label}>Where they work</div><div style={{ marginTop: 6 }} dir="auto">{c ? `${c.name}${c.sector ? ` — ${c.sector}` : ''}` : '—'}</div></div>
          <div><div style={label}>Who led me to them</div><div style={{ marginTop: 6 }} dir="auto">{via ?? 'Cold · direct'}</div></div>
        </div>
        <div>
          <div style={label}>Who I want to ask them about</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {p.ask.length === 0 && <span style={{ color: V('faint') }}>Nothing queued yet.</span>}
            {p.ask.map((a: any, i: number) => <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', background: V('bg2'), borderRadius: 8, padding: '7px 10px' }}><span style={{ width: 6, height: 6, borderRadius: 999, background: V('amber') }} /><b dir="auto">{a.who}</b><span style={{ color: V('faint') }} dir="auto">— {a.why}</span></div>)}
          </div>
        </div>
        <div><div style={label}>Notes</div><textarea key={p.id} defaultValue={p.notes} onBlur={(e) => { if (e.target.value !== (p.notes ?? '')) onNotes(p.id, e.target.value); }} placeholder="Your notes on this person…" dir="auto" style={{ ...inp(), width: '100%', marginTop: 6, minHeight: 60, resize: 'vertical', color: V('muted') }} /></div>
        <div>
          <div style={label}>Move to</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{personStatusOrder.map((s) => <button key={s} onClick={() => onStatus(p.id, s)} style={pill(p.status === s, statusMeta[s].color)}>{statusMeta[s].label}</button>)}</div>
        </div>
      </div>
    </div>
  );
}

function TalkTo({ people, cName }: any) {
  const connectors = people.filter((p: Person) => p.circle === 1);
  const groups = connectors.map((c: Person) => ({ c, leads: people.filter((l: Person) => l.viaId === c.id) })).filter((g: any) => g.leads.length).sort((a: any, b: any) => b.leads.length - a.leads.length);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px,1fr))', gap: 16 }}>
      {groups.map(({ c, leads }: any) => {
        const comps = new Set(leads.map((l: Person) => l.ci).filter((x: string) => x !== 'c_none'));
        return (
          <div key={c.id} style={{ ...card }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${V('line')}`, background: `linear-gradient(180deg, ${V('panel2')}, transparent)` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ fontFamily: 'var(--display)', fontSize: 19 }} dir="auto">{c.name}</span><span style={circleBadge}>circle {c.circle}</span></div>
              <div style={{ ...label, color: V('cyan'), marginTop: 6 }}>can connect you with {leads.length} people across {comps.size} companies</div>
            </div>
            <div style={{ padding: '6px 16px 12px' }}>
              {leads.map((l: Person) => <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${V('lineSoft')}` }}><span style={{ width: 7, height: 7, borderRadius: 999, background: statusMeta[l.status]?.color }} /><span dir="auto">{l.name}</span><span style={{ color: V('faint'), fontSize: 12.5 }} dir="auto">{[l.role, cName(l.ci)].filter(Boolean).join(' · ')}</span><span style={{ marginLeft: 'auto' }}><StatusChip st={l.status} /></span></div>)}
            </div>
          </div>
        );
      })}
      {groups.length === 0 && <div style={{ color: V('faint') }}>No connectors with leads yet.</div>}
    </div>
  );
}

// JOBS --------------------------------------------------------------------
function JobsFacet(props: any) {
  const { roles, companyById, cName, changeRoleStatus, changeRoleNote, changeContactStatus, changeContactVia, addLeadTo, connectorNames, peopleNames, people, initialCompany } = props;
  const [view, setView] = useState<'list' | 'board'>('list');
  const [companyId, setCompanyId] = useState<string | null>(initialCompany ?? null);
  const [statusF, setStatusF] = useState('all'); const [senF, setSenF] = useState('all'); const [pathF, setPathF] = useState('all');
  const sens = useMemo(() => [...new Set(roles.map((r: Role) => r.sen))] as string[], [roles]);
  const filtered = roles.filter((r: Role) =>
    (statusF === 'all' || r.status === statusF) && (senF === 'all' || r.sen === senF) &&
    (pathF === 'all' || (pathF === 'warm' ? r.warm : !r.warm)));
  const companyCount = new Set(filtered.map((r: Role) => r.ci)).size;

  return (
    <>
      <PageHead title="Jobs & Companies" sub={`${filtered.length} of ${roles.length} roles · ${companyCount} companies`} right={<Segmented value={view} options={[['list', 'List'], ['board', 'Board']]} onChange={(v) => setView(v as any)} />} />
      {view === 'list' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 16 }}>
            <FilterGroup title="Status" value={statusF} onChange={setStatusF} options={[['all', 'All'], ...roleStatusOrder.map((s) => [s, roleStatusMeta[s].label] as [string, string])]} colorFor={(v: string) => roleStatusMeta[v]?.color} />
            <FilterGroup title="Seniority" value={senF} onChange={setSenF} options={[['all', 'All'], ...sens.map((s) => [s, cap(s)] as [string, string])]} />
            <FilterGroup title="Path" value={pathF} onChange={setPathF} options={[['all', 'All'], ['warm', 'Warm path'], ['nopath', 'No path']]} colorFor={(v: string) => (v === 'warm' ? V('ok') : v === 'nopath' ? V('red') : undefined)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((r: Role) => (
              <div key={r.id} style={{ ...card, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div onClick={() => setCompanyId(r.ci)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, cursor: 'pointer', minWidth: 0 }}>
                  <span style={{ width: 14, color: V('amber') }}>{r.warm ? '★' : ''}</span>
                  <b style={{ minWidth: 150 }} dir="auto">{cName(r.ci)}</b>
                  <span style={{ flex: 1 }} dir="auto">{r.title}</span>
                  <span style={senChip}>{r.sen}</span>
                  <span style={{ ...label, minWidth: 96 }} dir="auto">{r.loc}</span>
                  <span style={chip(r.warm ? V('ok') : V('red'))}>{r.warm ? 'has path' : 'no path'}</span>
                </div>
                <select value={r.status} onChange={(e) => changeRoleStatus(r.id, e.target.value)} title="Change relevance / status"
                  style={{ ...inp(), padding: '5px 8px', fontSize: 12, color: roleStatusMeta[r.status]?.color, borderColor: roleStatusMeta[r.status]?.color, cursor: 'pointer' }}>
                  {roleStatusOrder.map((s) => <option key={s} value={s} style={{ color: '#000' }}>{roleStatusMeta[s].label}</option>)}
                </select>
              </div>
            ))}
            {filtered.length === 0 && <div style={{ color: V('faint'), padding: 12 }}>No roles match these filters.</div>}
          </div>
        </>
      )}
      {view === 'board' && <Board roles={roles} cName={cName} onDrop={changeRoleStatus} onOpen={setCompanyId} />}
      {companyId && <CompanyModal ci={companyId} company={companyById[companyId]}
        roles={roles.filter((r: Role) => r.ci === companyId)} people={people.filter((p: Person) => p.ci === companyId)}
        connectorNames={connectorNames} peopleNames={peopleNames} handlers={{ changeRoleStatus, changeRoleNote, changeContactStatus, changeContactVia, addLeadTo }} onClose={() => setCompanyId(null)} />}
    </>
  );
}

function Board({ roles, cName, onDrop, onOpen }: any) {
  const [drag, setDrag] = useState<string | null>(null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${roleStatusOrder.length}, 1fr)`, gap: 12 }}>
      {roleStatusOrder.map((st) => {
        const col = roles.filter((r: Role) => r.status === st);
        const color = roleStatusMeta[st].color;
        return (
          <div key={st} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (drag) onDrop(drag, st); setDrag(null); }} style={{ background: V('bg2'), border: `1px solid ${V('line')}`, borderRadius: 10, padding: 8, minHeight: 120 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 10px' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: color }} /><span style={label}>{roleStatusMeta[st].label}</span><span style={{ marginLeft: 'auto', ...label }}>{col.length}</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.map((r: Role) => (
                <div key={r.id} draggable onDragStart={() => setDrag(r.id)} onDragEnd={() => setDrag(null)} onClick={() => onOpen(r.ci)} style={{ background: V('panel'), border: `1px solid ${V('line')}`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '9px 11px', cursor: 'grab' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }} dir="auto">{r.warm ? '★ ' : ''}{cName(r.ci)}</div>
                  <div style={{ color: V('muted'), fontSize: 12 }} dir="auto">{r.title}</div>
                  <div style={{ ...label, marginTop: 6 }}>{r.sen} · drag ⇄</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// NETWORK -----------------------------------------------------------------
function NetworkFacet({ people, companies, sources }: any) {
  const [layout, setLayout] = useState<'radial' | 'layered'>('radial');
  const [search, setSearch] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const g = useMemo(() => computeGraph(people, companies, sources, layout), [people, companies, sources, layout]);
  const focus = useMemo(() => {
    if (search.trim()) { const hit = Object.values(g.nodes).find((n: any) => n.label.toLowerCase().includes(search.toLowerCase())); return hit ? (hit as any).id : null; }
    return hover ?? sel;
  }, [search, hover, sel, g]);
  const near = (id: string) => focus == null || id === focus || g.adj[focus]?.has(id);
  const legend = [['You', V('amber')], ['Connectors', V('cyan')], ['Leads', V('text')], ['Companies', V('violet')], ['Sources', V('faint')]] as [string, string][];
  const selNode: any = sel ? g.nodes[sel] : null;

  return (
    <>
      <PageHead title="Network" sub={`${Object.keys(g.nodes).length} nodes · ${g.edges.length} links`} right={<Segmented value={layout} options={[['radial', 'Radial'], ['layered', 'Layered']]} onChange={(v) => setLayout(v as any)} />} />
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={search} onChange={(e) => { setSearch(e.target.value); setSel(null); }} placeholder="Search a person or company…" style={{ background: V('bg2'), color: V('text'), border: `1px solid ${V('line')}`, borderRadius: 8, padding: '7px 11px', font: 'inherit', fontSize: 13, width: 260 }} dir="auto" />
        {search && <span style={{ ...label, color: focus ? V('cyan') : V('red') }}>{focus ? 'match →' : 'No match'}</span>}
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>{legend.map(([l, c]) => <span key={l} style={{ display: 'flex', gap: 6, alignItems: 'center', ...label }}><span style={{ width: 9, height: 9, borderRadius: l === 'Companies' ? 2 : 999, background: c }} />{l}</span>)}</div>
      </div>
      <div style={{ ...card, borderRadius: 12, padding: 4, position: 'relative' }}>
        <svg viewBox="0 0 920 560" style={{ width: '100%', display: 'block' }} onMouseLeave={() => setHover(null)}>
          {g.edges.map((e: any, i: number) => { const a = g.nodes[e.a], b = g.nodes[e.b]; const on = focus == null || e.a === focus || e.b === focus; return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.stroke} strokeWidth={on ? 1.6 : 0.6} opacity={focus == null ? 0.5 : on ? 0.9 : 0.05} />; })}
          {Object.values(g.nodes).map((n: any) => (
            <g key={n.id} opacity={near(n.id) ? 1 : 0.12} onMouseEnter={() => setHover(n.id)} onClick={() => setSel(n.id)} style={{ cursor: 'pointer' }}>
              <circle cx={n.x} cy={n.y} r={n.r + 8} fill={n.fill} opacity={0.16} />
              <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill} stroke={V('panel')} strokeWidth={2} />
              <text x={n.x} y={n.y + n.r + 14} textAnchor="middle" fill={V('text')} fontSize={n.kind === 'you' ? 13 : 11} fontFamily="var(--body)">{n.label}</text>
            </g>
          ))}
        </svg>
        {selNode ? (
          <div style={{ position: 'absolute', top: 12, right: 12, width: 240, background: V('panel2'), border: `1px solid ${V('line')}`, borderRadius: 10, padding: 14, boxShadow: `0 16px 44px -22px rgba(20,40,80,.5)` }}>
            <div style={{ ...label, color: selNode.fill }}>{selNode.kind}</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 20, margin: '2px 0' }} dir="auto">{selNode.label}</div>
            <div style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{selNode.sub}</div>
            <div style={{ ...label, marginTop: 10 }}>Connected to ({(g.adj[selNode.id]?.size) || 0})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6, maxHeight: 220, overflow: 'auto' }}>
              {[...(g.adj[selNode.id] ?? [])].map((nid: any) => { const nn = g.nodes[nid]; const rel = g.edges.find((e: any) => (e.a === selNode.id && e.b === nid) || (e.b === selNode.id && e.a === nid))?.rel; return <div key={nid} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: nn.fill }} /><span dir="auto">{nn.label}</span><span style={{ marginLeft: 'auto', ...label }}>{rel}</span></div>; })}
            </div>
          </div>
        ) : <div style={{ position: 'absolute', bottom: 14, right: 14, ...label, background: V('panel2'), border: `1px solid ${V('line')}`, borderRadius: 999, padding: '5px 12px' }}>Click or search a node →</div>}
      </div>
    </>
  );
}

function computeGraph(people: Person[], companies: Company[], sources: any[], layout: string) {
  const W = 920, H = 560, cx = 470, cy = 280;
  const connectors = people.filter((p) => p.circle === 1);
  const leads = people.filter((p) => p.circle >= 2);
  const usedC = [...new Set(people.map((p) => p.ci).filter((x) => x && x !== 'c_none'))];
  const comps = usedC.map((id) => companies.find((c) => c.id === id)).filter(Boolean) as Company[];
  const usedS = [...new Set(connectors.map((c) => c.ledBy).filter(Boolean))];
  const srcs = usedS.map((id) => sources.find((s: any) => s.id === id)).filter(Boolean);
  const nodes: Record<string, any> = { me: { id: 'me', kind: 'you', label: 'You', sub: 'PM · Tel Aviv', fill: V('amber'), r: 15 } };
  const angleOf: Record<string, number> = {}, compAngle: Record<string, number> = {};
  if (layout === 'radial') {
    nodes.me.x = cx; nodes.me.y = cy;
    connectors.forEach((c, i) => { const a = (i / (connectors.length || 1)) * Math.PI * 2 - Math.PI / 2; angleOf[c.id] = a; nodes[c.id] = { id: c.id, kind: 'connector', label: c.name, sub: c.role, fill: V('cyan'), r: 11, x: cx + 150 * Math.cos(a), y: cy + 150 * Math.sin(a) }; });
    comps.forEach((c, i) => { const a = (i / (comps.length || 1)) * Math.PI * 2 - Math.PI / 2 + 0.3; compAngle[c.id] = a; nodes[c.id] = { id: c.id, kind: 'company', label: c.name, sub: c.sector, fill: V('violet'), r: 11, x: cx + 385 * Math.cos(a), y: cy + 385 * Math.sin(a) }; });
    srcs.forEach((s: any, i: number) => { const kids = connectors.filter((c) => c.ledBy === s.id); const a = kids.length ? kids.reduce((sum, c) => sum + angleOf[c.id], 0) / kids.length : (i / (srcs.length || 1)) * Math.PI * 2; nodes[s.id] = { id: s.id, kind: 'source', label: s.name, sub: 'Community / source', fill: V('faint'), r: 8, x: cx + 70 * Math.cos(a + 0.15), y: cy + 70 * Math.sin(a + 0.15) }; });
    const seen: Record<string, number> = {};
    leads.forEach((l, li) => { const key = (l.viaId || l.ci) as string; const base = l.viaId && angleOf[l.viaId] != null ? angleOf[l.viaId] : compAngle[l.ci] != null ? compAngle[l.ci] : (li / (leads.length || 1)) * Math.PI * 2; seen[key] = (seen[key] || 0) + 1; const a = base + ((seen[key] - 1) * 0.28 - 0.14); nodes[l.id] = { id: l.id, kind: 'lead', label: l.name, sub: l.role, fill: V('text'), r: 9, x: cx + 262 * Math.cos(a), y: cy + 262 * Math.sin(a) }; });
  } else {
    const col = (arr: any[], x: number, mk: (it: any) => any) => { const n = arr.length; arr.forEach((it, i) => { const node = mk(it); node.x = x; node.y = n <= 1 ? cy : 60 + i * (440 / (n - 1)); nodes[node.id] = node; }); };
    nodes.me.x = 70; nodes.me.y = cy;
    col(srcs, 210, (s) => ({ id: s.id, kind: 'source', label: s.name, sub: 'Community / source', fill: V('faint'), r: 8 }));
    col(connectors, 400, (c) => ({ id: c.id, kind: 'connector', label: c.name, sub: c.role, fill: V('cyan'), r: 11 }));
    col(leads, 620, (l) => ({ id: l.id, kind: 'lead', label: l.name, sub: l.role, fill: V('text'), r: 9 }));
    col(comps, 850, (c) => ({ id: c.id, kind: 'company', label: c.name, sub: c.sector, fill: V('violet'), r: 11 }));
  }
  const edges: any[] = [], adj: Record<string, Set<string>> = {};
  const link = (a: string, b: string, rel: string, stroke: string) => { if (!nodes[a] || !nodes[b]) return; edges.push({ a, b, rel, stroke }); (adj[a] = adj[a] || new Set()).add(b); (adj[b] = adj[b] || new Set()).add(a); };
  connectors.forEach((c) => { link('me', c.id, 'connector', V('cyan')); if (c.ledBy) link(c.ledBy, c.id, 'led me to', V('faint')); if (c.ci !== 'c_none') link(c.id, c.ci, 'works at', V('violet')); });
  leads.forEach((l) => { if (l.viaId) link(l.viaId, l.id, 'can intro', V('cyan')); if (l.ci !== 'c_none') link(l.id, l.ci, 'works at', V('violet')); });
  return { nodes, edges, adj, W, H };
}

// MANAGE / DEDUPE ---------------------------------------------------------
function ManageFacet({ people, companies, cName, handlers }: any) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const clusters = useMemo(() => {
    const used = new Set<string>(); const out: Person[][] = [];
    for (let i = 0; i < people.length; i++) {
      if (used.has(people[i].id)) continue;
      const group = [people[i]]; used.add(people[i].id);
      for (let j = i + 1; j < people.length; j++) {
        if (used.has(people[j].id)) continue;
        if (sim(people[i].name, people[j].name) >= 0.85) { group.push(people[j]); used.add(people[j].id); }
      }
      if (group.length > 1) out.push(group);
    }
    return out;
  }, [people]);
  const filtered = people.filter((p: Person) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (cName(p.ci) || '').toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const mergeSel = () => { if (sel.length >= 2) { handlers.mergePeople(sel[0], sel.slice(1)); setSel([]); } };

  return (
    <>
      <PageHead title="Manage & dedupe" sub={`${people.length} entities · merge duplicates, edit, delete`}
        right={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" dir="auto" style={{ ...inp(), width: 220 }} />} />
      <datalist id="companies-list">{companies.map((c: Company) => <option key={c.id} value={c.name} />)}</datalist>

      {sel.length >= 2 && (
        <div style={{ ...card, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, borderColor: V('cyan') }}>
          <span style={label}>{sel.length} selected — merge into <b style={{ color: V('cyan') }}>{people.find((p: Person) => p.id === sel[0])?.name}</b></span>
          <button onClick={mergeSel} style={{ marginLeft: 'auto', font: 'inherit', fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', background: V('cyan'), color: '#fff', border: 'none' }}>⤵ Merge selected</button>
          <button onClick={() => setSel([])} style={{ font: 'inherit', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: V('muted'), border: `1px solid ${V('line')}` }}>Clear</button>
        </div>
      )}

      {clusters.length > 0 && (
        <section style={{ ...card, padding: 16, marginBottom: 18 }}>
          <div style={{ ...label, marginBottom: 10 }}>Possible duplicates ({clusters.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clusters.map((group, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: `1px solid ${V('lineSoft')}`, paddingBottom: 8 }}>
                {group.map((p, j) => <span key={p.id} dir="auto" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span style={{ fontWeight: j === 0 ? 600 : 400 }}>{p.name}</span><span style={{ ...label }}>{p.ctype}{cName(p.ci) ? ` · ${cName(p.ci)}` : ''}</span>{j < group.length - 1 && <span style={{ color: V('faint') }}>≈</span>}</span>)}
                <button onClick={() => handlers.mergePeople(group[0].id, group.slice(1).map((p) => p.id))} style={{ marginLeft: 'auto', font: 'inherit', fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: V('panel2'), color: V('cyan'), border: `1px solid ${V('cyanDim')}` }}>⤵ Merge into {group[0].name}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ ...card, padding: '4px 16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['', 'Name', 'Kind', 'Company', 'Circle', 'Status', ''].map((h, i) => <th key={i} style={{ ...label, textAlign: 'left', padding: '10px 8px', borderBottom: `1px solid ${V('line')}` }}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.slice(0, 400).map((p: Person) => <EntityRow key={p.id} p={p} cName={cName} selected={sel.includes(p.id)} onToggle={() => toggle(p.id)} onSave={handlers.editEntity} onDelete={handlers.removeEntity} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EntityRow({ p, cName, selected, onToggle, onSave, onDelete }: any) {
  const [name, setName] = useState(p.name); const [kind, setKind] = useState(p.ctype); const [company, setCompany] = useState(cName(p.ci) || ''); const [degree, setDegree] = useState(p.circle ?? ''); const [status, setStatus] = useState(p.status);
  const dirty = name !== p.name || kind !== p.ctype || company !== (cName(p.ci) || '') || String(degree) !== String(p.circle ?? '') || status !== p.status;
  const save = () => onSave(p.id, { name, kind, company, degree: degree === '' ? null : Number(degree), status });
  const cell: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${V('lineSoft')}`, verticalAlign: 'middle' };
  return (
    <tr>
      <td style={cell}><input type="checkbox" checked={selected} onChange={onToggle} /></td>
      <td style={cell}><input value={name} onChange={(e) => setName(e.target.value)} dir="auto" style={{ ...inp(), padding: '4px 8px', fontSize: 12.5, width: 170 }} /></td>
      <td style={cell}><select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inp(), padding: '4px 6px', fontSize: 12 }}>{['connector', 'pm', 'hr', 'found'].map((k) => <option key={k} value={k} style={{ color: '#000' }}>{k}</option>)}</select></td>
      <td style={cell}><input list="companies-list" value={company} onChange={(e) => setCompany(e.target.value)} dir="auto" style={{ ...inp(), padding: '4px 8px', fontSize: 12, width: 150 }} /></td>
      <td style={cell}><input value={degree} onChange={(e) => setDegree(e.target.value)} style={{ ...inp(), padding: '4px 6px', fontSize: 12, width: 44 }} /></td>
      <td style={cell}><select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inp(), padding: '4px 6px', fontSize: 12, color: statusMeta[status]?.color }}>{personStatusOrder.map((s) => <option key={s} value={s} style={{ color: '#000' }}>{statusMeta[s].label}</option>)}</select></td>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <button onClick={save} disabled={!dirty} style={{ font: 'inherit', fontSize: 11, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', background: dirty ? V('cyan') : 'transparent', color: dirty ? '#fff' : V('faint'), border: `1px solid ${dirty ? 'transparent' : V('line')}` }}>save</button>
        <button onClick={() => { if (confirm(`Delete ${p.name}?`)) onDelete(p.id); }} style={{ marginLeft: 6, font: 'inherit', fontSize: 11, padding: '4px 8px', borderRadius: 7, cursor: 'pointer', background: 'transparent', color: V('red'), border: `1px solid ${V('line')}` }}>✕</button>
      </td>
    </tr>
  );
}

// MODALS ------------------------------------------------------------------
function Backdrop({ children, onClose }: any) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,45,.42)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 50 }}>{children}</div>;
}

function AddPersonModal({ people, sources, companies, onClose, onAdded }: any) {
  const [mode, setMode] = useState<'linkedin' | 'manual'>('linkedin');
  const [url, setUrl] = useState(''); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [role, setRole] = useState('');
  const [viaText, setViaText] = useState(''); const [viaId, setViaId] = useState<string>(people.find((p: Person) => p.circle === 1)?.id ?? '');
  const [companyId, setCompanyId] = useState<string>('c_none');
  const [pending, start] = useTransition();
  const parsed = (() => { const slug = (url.split('/in/')[1] || '').split(/[/?#]/)[0]; const t = slug.split('-').filter((x) => /^[a-z]+$/i.test(x) && x.length > 1); return t.slice(0, 2).map((x) => cap(x.toLowerCase())).join(' '); })();
  const connectors = people.filter((p: Person) => p.circle === 1);
  const submit = () => start(async () => { const id = await addPerson({ mode, name: mode === 'linkedin' ? parsed : name, url, phone, role, viaId: viaText ? '' : viaId, viaText, companyId }); onAdded(id); });
  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(540px,94vw)', background: V('panel'), border: `1px solid ${V('line')}`, borderRadius: 16, boxShadow: `0 30px 80px -26px rgba(20,40,80,.5)`, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px 0' }}><div style={{ fontFamily: 'var(--display)', fontSize: 22 }}>Add a person</div><div style={{ color: V('muted'), fontSize: 12.5, margin: '4px 0 14px' }}>Paste a LinkedIn URL to auto-fill, or add by phone.</div>
          <div style={{ display: 'flex', gap: 4 }}>{(['linkedin', 'manual'] as const).map((m) => <button key={m} onClick={() => setMode(m)} style={{ font: 'inherit', fontSize: 12.5, padding: '7px 14px', borderRadius: '8px 8px 0 0', cursor: 'pointer', border: `1px solid ${V('line')}`, borderBottom: 'none', background: mode === m ? V('panel2') : 'transparent', color: mode === m ? V('text') : V('faint'), fontWeight: mode === m ? 600 : 400 }}>{m === 'linkedin' ? 'LinkedIn' : 'Phone / manual'}</button>)}</div>
        </div>
        <div style={{ padding: '18px 24px', borderTop: `1px solid ${V('line')}`, display: 'grid', gap: 12 }}>
          {mode === 'linkedin' ? (
            <div style={{ display: 'grid', gap: 6 }}><span style={label}>LinkedIn URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/…" style={inp()} />{parsed && <span style={{ ...label, color: V('cyan'), letterSpacing: '.02em' }}>↳ auto-fills: {parsed} · role from profile</span>}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><Field l="Name"><input value={name} onChange={(e) => setName(e.target.value)} style={inp()} dir="auto" /></Field><Field l="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} style={inp()} /></Field><div style={{ gridColumn: 'span 2' }}><Field l="Role (optional)"><input value={role} onChange={(e) => setRole(e.target.value)} style={inp()} dir="auto" /></Field></div></div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ display: 'grid', gap: 6 }}><span style={label}>Who knows them</span><input value={viaText} onChange={(e) => { setViaText(e.target.value); setViaId(''); }} placeholder="Type a name — e.g. Derman" style={inp()} dir="auto" /><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[...connectors, ...sources].map((x: any) => <button key={x.id} onClick={() => { setViaId(x.id); setViaText(''); }} style={pill(viaId === x.id && !viaText, x.id.startsWith('s') ? V('faint') : V('cyan'))} dir="auto">{x.name}</button>)}</div></div>
            <div style={{ display: 'grid', gap: 6 }}><span style={label}>For which company</span><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 120, overflow: 'auto' }}>{companies.map((c: Company) => <button key={c.id} onClick={() => setCompanyId(c.id)} style={pill(companyId === c.id, V('violet'))} dir="auto">{c.name}</button>)}</div></div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px', borderTop: `1px solid ${V('line')}` }}><button onClick={onClose} style={{ font: 'inherit', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: V('muted'), border: `1px solid ${V('line')}` }}>Cancel</button><button onClick={submit} disabled={pending} style={{ font: 'inherit', fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: V('cyan'), color: '#fff', border: 'none', opacity: pending ? 0.6 : 1 }}>Add person</button></div>
      </div>
    </Backdrop>
  );
}
const inp = (): CSSProperties => ({ background: V('bg2'), color: V('text'), border: `1px solid ${V('line')}`, borderRadius: 8, padding: '8px 10px', font: 'inherit', fontSize: 13 });
function Field({ l, children }: any) { return <div style={{ display: 'grid', gap: 6 }}><span style={label}>{l}</span>{children}</div>; }

function CompanyModal({ ci, company, roles, people, connectorNames, peopleNames, handlers, onClose }: any) {
  const [scraped, setScraped] = useState<any[] | null>(null);
  const [pending, start] = useTransition();
  const doExpand = () => start(async () => { const emp = await expandEmployees(ci); setScraped(emp.map((e) => ({ ...e, talkTo: false, outreach: 'none' }))); });
  const cycle = (eid: string) => setScraped((s) => s!.map((e) => { if (e.id !== eid) return e; const i = outreachOrder.indexOf(e.outreach); const nx = outreachOrder[(i + 1) % outreachOrder.length]; start(() => { logOutreach(eid, ci, nx); }); return { ...e, outreach: nx }; }));
  const toggle = (eid: string) => setScraped((s) => s!.map((e) => (e.id === eid ? { ...e, talkTo: !e.talkTo, outreach: e.talkTo ? 'none' : e.outreach } : e)));
  const sel = (val: string, opts: [string, string][], onChange: (v: string) => void, color?: string): any => (
    <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...inp(), padding: '4px 8px', fontSize: 12, color: color ?? V('text') }}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  );
  if (!company) return null;
  return (
    <Backdrop onClose={onClose}>
      <datalist id="connectors">{(connectorNames ?? []).map((n: string) => <option key={n} value={n} />)}</datalist>
      <datalist id="all-people">{(peopleNames ?? []).map((n: string, i: number) => <option key={n + i} value={n} />)}</datalist>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(660px,95vw)', maxHeight: '90vh', overflow: 'auto', background: V('panel'), border: `1px solid ${V('line')}`, borderRadius: 16, boxShadow: `0 30px 80px -26px rgba(20,40,80,.5)` }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${V('line')}`, background: `linear-gradient(180deg, ${V('panel2')}, transparent)`, position: 'sticky', top: 0, zIndex: 1 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: V('violet'), color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontWeight: 600 }}>{initials(company.name)}</div>
          <div style={{ flex: 1 }}><div style={{ fontFamily: 'var(--display)', fontSize: 24 }} dir="auto">{company.name}</div><div style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{[company.sector, company.stage, company.employees, company.funding].filter((x: string) => x && x !== '—').join(' · ')}</div></div>
          <button onClick={onClose} style={{ font: 'inherit', fontSize: 18, background: 'transparent', border: 'none', color: V('muted'), cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '18px 24px', display: 'grid', gap: 22 }}>
          {/* ── roles: status + my description ── */}
          <section><div style={{ display: 'flex', justifyContent: 'space-between' }}><div style={label}>Open roles &amp; my status</div>{company.careers && <a href={company.careers} target="_blank" style={{ color: V('cyan'), ...label }}>careers ↗</a>}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              {roles.map((r: Role) => (
                <div key={r.id} style={{ border: `1px solid ${V('lineSoft')}`, borderRadius: 9, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span dir="auto" style={{ flex: 1, fontWeight: 500 }}>{r.title}</span><span style={senChip}>{r.sen}</span>
                    {r.url && <a href={r.url} target="_blank" style={{ color: V('cyan') }}>job ↗</a>}
                    {sel(r.status, roleStatusOrder.map((s) => [s, roleStatusMeta[s].label]), (v) => handlers.changeRoleStatus(r.id, v), roleStatusMeta[r.status]?.color)}
                  </div>
                  <textarea defaultValue={r.note} onBlur={(e) => { if (e.target.value !== r.note) handlers.changeRoleNote(r.id, e.target.value); }} placeholder="My status / description for this role — e.g. הגשתי קוח באתר, מדבר עם עמית ב-21.7" dir="auto" style={{ ...inp(), width: '100%', marginTop: 8, minHeight: 42, resize: 'vertical', fontSize: 12.5 }} />
                </div>
              ))}
              {roles.length === 0 && <span style={{ color: V('faint') }}>No open roles tracked.</span>}
            </div>
          </section>

          {/* ── leads & contacts: editable ── */}
          <section><div style={label}>Leads &amp; contacts at {company.name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {people.map((p: Person) => (
                <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${V('lineSoft')}`, paddingBottom: 8 }}>
                  {p.linkedin ? <a href={p.linkedin} target="_blank" dir="auto" style={{ fontWeight: 600, color: V('text') }}>{p.name}</a> : <span dir="auto" style={{ fontWeight: 600 }}>{p.name}</span>}
                  <span style={{ ...chip(contactTypeMeta[p.ctype]?.color ?? V('muted')), fontSize: 10.5, padding: '2px 8px' }}>{p.ctype}</span>
                  <span style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{p.role}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                    <span style={{ ...label, letterSpacing: '.06em' }}>via</span>
                    <input list="connectors" defaultValue={p.via ?? ''} placeholder="cold" dir="auto" onBlur={(e) => { if ((e.target.value || '') !== (p.via ?? '')) handlers.changeContactVia(p.id, ci, e.target.value); }} style={{ ...inp(), padding: '4px 8px', fontSize: 12, width: 130 }} />
                    {sel(p.outreach ?? 'none', outreachOrder.map((s) => [s, outreachMeta[s].label]), (v) => handlers.changeContactStatus(p.id, ci, v), outreachMeta[p.outreach ?? 'none']?.color)}
                  </span>
                </div>
              ))}
              {people.length === 0 && <span style={{ color: V('faint') }}>No leads here yet — add one below.</span>}
            </div>
            <AddLeadForm ci={ci} onAdd={handlers.addLeadTo} />
          </section>

          {/* ── employees on LinkedIn (real scrape) ── */}
          <section><div style={label}>Employees on LinkedIn</div>
            {!scraped ? <div style={{ marginTop: 8 }}><button onClick={doExpand} disabled={pending} style={{ font: 'inherit', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: V('panel2'), color: V('text'), border: `1px solid ${V('line')}` }}>{pending ? '⟳ scraping…' : '⟳ Expand on employees'}</button><span style={{ color: V('faint'), marginLeft: 10, fontSize: 12.5 }}>Pulls PM &amp; HR people from LinkedIn.</span></div> : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {scraped.length === 0 && <span style={{ color: V('faint') }}>No public profiles found.</span>}
                {scraped.map((e) => (
                  <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button onClick={() => toggle(e.id)} style={{ font: 'inherit', fontSize: 11, padding: '3px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${e.talkTo ? 'transparent' : V('line')}`, background: e.talkTo ? V('cyan') : 'transparent', color: e.talkTo ? '#fff' : V('muted') }}>{e.talkTo ? '✓ Talk to' : '+ Talk to'}</button>
                    <span dir="auto" style={{ fontWeight: 600 }}>{e.name}</span><span style={{ ...chip(contactTypeMeta[e.ctype]?.color ?? V('muted')), fontSize: 10.5, padding: '2px 8px' }}>{e.ctype === 'pm' ? 'Product' : 'HR'}</span>
                    <span style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{e.role}</span>
                    {e.linkedin && <a href={e.linkedin} target="_blank" style={{ color: V('cyan') }}>in ↗</a>}
                    {e.talkTo && <button onClick={() => cycle(e.id)} style={{ marginLeft: 'auto', font: 'inherit', fontSize: 11, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${outreachMeta[e.outreach].color}`, background: 'transparent', color: outreachMeta[e.outreach].color }}>{outreachMeta[e.outreach].label}</button>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </Backdrop>
  );
}

function AddLeadForm({ ci, onAdd }: { ci: string; onAdd: (ci: string, input: any) => void }) {
  const [mode, setMode] = useState<'linkedin' | 'existing' | 'manual'>('linkedin');
  const [url, setUrl] = useState(''); const [name, setName] = useState(''); const [role, setRole] = useState('');
  const [connector, setConnector] = useState(''); const [cold, setCold] = useState(false); const [status, setStatus] = useState('none');
  const parsed = (() => { const slug = (url.split('/in/')[1] || '').split(/[/?#]/)[0]; const t = slug.split('-').filter((x) => /^[a-z]+$/i.test(x) && x.length > 1); return t.slice(0, 2).map((x) => cap(x.toLowerCase())).join(' '); })();
  const submit = () => { onAdd(ci, { mode: mode === 'linkedin' ? 'linkedin' : 'manual', url, name, role, connector: cold ? '' : connector, cold, status }); setUrl(''); setName(''); setRole(''); setConnector(''); setCold(false); setStatus('none'); };
  const canAdd = mode === 'linkedin' ? !!parsed : !!name.trim();
  const labels: Record<string, string> = { linkedin: 'LinkedIn URL', existing: 'I know them', manual: 'Manual' };
  return (
    <div style={{ marginTop: 12, border: `1px dashed ${V('line')}`, borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={label}>Add a lead</span><div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>{(['linkedin', 'existing', 'manual'] as const).map((m) => <button key={m} onClick={() => setMode(m)} style={pill(mode === m)}>{labels[m]}</button>)}</div></div>
      {mode === 'linkedin' ? (
        <div style={{ display: 'grid', gap: 4 }}><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/…" style={inp()} />{parsed && <span style={{ ...label, color: V('cyan'), letterSpacing: '.02em' }}>↳ {parsed}</span>}</div>
      ) : mode === 'existing' ? (
        <div style={{ display: 'grid', gap: 4 }}><input list="all-people" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type a person you already know — e.g. Odelia Israelevich" dir="auto" style={inp()} /><span style={{ ...label, letterSpacing: '.02em', color: V('faint') }}>links an existing person to this company (no duplicate)</span></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" dir="auto" style={inp()} /><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (optional)" dir="auto" style={inp()} /></div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input list="connectors" value={connector} disabled={cold} onChange={(e) => setConnector(e.target.value)} placeholder="who connects me…" dir="auto" style={{ ...inp(), width: 180, opacity: cold ? 0.5 : 1 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted'), cursor: 'pointer' }}><input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} /> cold approach</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inp(), padding: '6px 8px', fontSize: 12 }}>{outreachOrder.map((s) => <option key={s} value={s}>{outreachMeta[s].label}</option>)}</select>
        <button onClick={submit} disabled={!canAdd} style={{ marginLeft: 'auto', font: 'inherit', fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: V('cyan'), color: '#fff', border: 'none', opacity: canAdd ? 1 : 0.5 }}>+ Add lead</button>
      </div>
    </div>
  );
}
