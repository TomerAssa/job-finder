'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SearchHit, SearchPreview, SectorOption } from '@/lib/data/search';
import type { SearchParams } from '../../../src/db/searches.js';
import { setRoleStatus } from '@/lib/actions';
import { V, card, chip, Empty, ErrorNote, Field, ghostBtn, inp, label, PageHead, pill, primaryBtn, seg, senChip } from '../_components/ui';

interface Budget {
  used: number;
  cap: number;
  remaining: number | null;
  usageKnown: boolean;
  perCompany: number;
  basis: 'measured' | 'estimate';
}

/**
 * Search is for finding roles that are not in the database yet.
 *
 * Filtering what has already been found belongs in Jobs — arriving here and
 * being shown the same list again is the wrong answer to "search". So the
 * primary action visits companies nobody has looked at, and everything the crawl
 * needs (parameters, cost, budget) is on this page rather than in a terminal.
 */
export function SearchView({
  sectors, params, preview,
}: {
  sectors: SectorOption[];
  params: SearchParams;
  preview: SearchPreview | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>(
    params.sectors.length
      ? params.sectors
      : sectors.filter((s) => s.unvisited + s.due > 0).slice(0, 1).map((s) => s.id),
  );
  const [titles, setTitles] = useState(params.titleKeywords.join(', '));
  const [minYears, setMinYears] = useState(params.minYears?.toString() ?? '');
  const [maxYears, setMaxYears] = useState(params.maxYears?.toString() ?? '');
  const [location, setLocation] = useState(params.location ?? '');
  const [budget, setBudget] = useState<Budget | null>(null);

  const loadBudget = () => {
    fetch('/api/credits').then((r) => r.json()).then(setBudget).catch(() => setBudget(null));
  };
  useEffect(loadBudget, []);

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const chosen = sectors.filter((s) => selected.includes(s.id));
  const unvisited = chosen.reduce((n, s) => n + s.unvisited, 0);
  const due = chosen.reduce((n, s) => n + s.due, 0);
  const fresh = chosen.reduce((n, s) => n + s.fresh, 0);

  const applyFilters = () => {
    const q = new URLSearchParams();
    if (selected.length) q.set('sectors', selected.join(','));
    if (titles.trim()) q.set('titles', titles);
    if (minYears.trim()) q.set('minYears', minYears);
    if (maxYears.trim()) q.set('maxYears', maxYears);
    if (location.trim()) q.set('location', location);
    q.set('go', '1');
    router.push(`/search?${q.toString()}`);
  };

  if (sectors.length === 0) {
    return (
      <>
        <PageHead title="Search" sub="Find roles nobody has looked for yet" />
        <Empty>
          No company lists loaded yet. Add one on the <Link href="/setup" style={{ color: V('cyan') }}>setup page</Link>.
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Search"
        sub="Visit companies nobody has looked at yet. To filter roles already found, use Jobs."
        right={<BudgetChip budget={budget} />}
      />

      <section style={{ ...card, padding: 20, display: 'grid', gap: 16 }}>
        <div>
          <div style={label}>Where to look</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {sectors.map((s) => (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                style={pill(selected.includes(s.id), s.unvisited + s.due > 0 ? V('violet') : V('faint'))}
                title={`${s.companies} companies · ${s.unvisited} never visited · ${s.due} due for a re-check · ${s.fresh} checked recently`}
              >
                {s.name}{' '}
                <span style={{ opacity: 0.75 }}>
                  {s.unvisited + s.due > 0
                    ? [s.unvisited > 0 ? `${s.unvisited} new` : null, s.due > 0 ? `${s.due} due` : null]
                        .filter(Boolean)
                        .join(' · ')
                    : 'up to date'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 90px 90px minmax(0,1fr)', gap: 12, alignItems: 'end' }}>
          <Field l="Job title">
            <input value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="product manager, product builder" dir="auto" style={inp()} />
          </Field>
          <Field l="Min years">
            <input value={minYears} onChange={(e) => setMinYears(e.target.value)} inputMode="numeric" placeholder="—" style={inp()} />
          </Field>
          <Field l="Max years">
            <input value={maxYears} onChange={(e) => setMaxYears(e.target.value)} inputMode="numeric" placeholder="—" style={inp()} />
          </Field>
          <Field l="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Israel" dir="auto" style={inp()} />
          </Field>
        </div>

        <Crawl
          sectors={selected}
          unvisited={unvisited}
          due={due}
          fresh={fresh}
          budget={budget}
          onDone={(runStartedAt) => {
            loadBudget();
            // Re-query with the run's start time so whatever it found is marked
            // and floated to the top instead of being lost among hundreds.
            const q = new URLSearchParams(window.location.search);
            if (selected.length) q.set('sectors', selected.join(','));
            if (titles.trim()) q.set('titles', titles);
            q.set('since', runStartedAt);
            q.set('go', '1');
            router.replace(`/search?${q.toString()}`);
            router.refresh();
          }}
        />

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${V('lineSoft')}`, paddingTop: 14 }}>
          <button style={ghostBtn} onClick={applyFilters} disabled={selected.length === 0}>
            Show what I already have
          </button>
          <span style={{ color: V('faint'), fontSize: 12, lineHeight: 1.6, flex: 1, minWidth: 260 }}>
            Title, years and location narrow the results below. They do not change what gets
            visited — a crawl reads every careers page it can reach, and the filters are
            applied to what comes back.
          </span>
        </div>
      </section>

      {preview && <Results preview={preview} />}
    </>
  );
}

function BudgetChip({ budget }: { budget: Budget | null }) {
  if (!budget) return null;
  if (!budget.usageKnown) {
    return <span style={{ ...chip(V('amber')), fontSize: 10.5 }}>budget unknown — Redis is not running</span>;
  }
  const pct = budget.cap > 0 ? Math.min(100, Math.round((budget.used / budget.cap) * 100)) : 0;
  const tone = pct > 90 ? V('red') : pct > 70 ? V('amber') : V('ok');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 190 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...label }}>
        <span>scrape budget</span>
        <span style={{ color: tone }}>{budget.remaining?.toLocaleString()} left</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: V('bg2'), overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
      </div>
      <div style={{ ...label, color: V('faint') }}>
        {budget.used.toLocaleString()} of {budget.cap.toLocaleString()} used this month
      </div>
    </div>
  );
}

interface CrawlRun {
  id: number;
  status: 'running' | 'done' | 'stopped' | 'error';
  companies_done: number;
  companies_total: number;
  positions_added: number;
  roles_added: number;
  positions_closed: number;
  credits_used: number;
  error: string | null;
  started_at: string;
}

/**
 * Start a crawl and watch it.
 *
 * The work outlives the request that starts it, so this starts a run, then
 * polls. A whole sector is twenty minutes; holding a request open for that is
 * not an option, and neither is leaving the user staring at a button that gave
 * no sign it did anything.
 */
function Crawl({ sectors, unvisited, due, fresh, budget, onDone }: {
  sectors: number[];
  unvisited: number;
  due: number;
  fresh: number;
  budget: Budget | null;
  onDone: (runStartedAt: string) => void;
}) {
  const [mode, setMode] = useState<'all' | 'companies' | 'credits'>('all');
  const [companies, setCompanies] = useState(60);
  const [credits, setCredits] = useState(500);
  const [force, setForce] = useState(false);
  const [run, setRun] = useState<CrawlRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const pool = force ? unvisited + due + fresh : unvisited + due;
  const perCompany = budget?.perCompany ?? 3;

  const planned =
    mode === 'all' ? pool
    : mode === 'companies' ? Math.min(companies, pool)
    : Math.min(Math.floor(credits / perCompany), pool);
  const estimate = Math.round(planned * perCompany);
  const overBudget = budget?.remaining != null && estimate > budget.remaining;

  // Pick up a run already in flight — a reload, or another tab, should not lose it.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/search/run');
        const body = await res.json();
        if (!alive) return;
        const r: CrawlRun | null = body.run ?? null;
        setRun(r);
        if (r?.status === 'running') setTimeout(poll, 2000);
        else if (r) onDone(r.started_at);
      } catch {
        /* transient; the next tick retries */
      }
    };
    poll();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRun = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/search/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sectors,
          targetCompanies: mode === 'all' ? null : planned,
          creditLimit: mode === 'credits' ? credits : null,
          force,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Could not start (HTTP ${res.status})`);
      setRun(body.run);
      pollUntilDone(body.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const pollUntilDone = (id: number) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/search/run?id=${id}`);
        const body = await res.json();
        const r: CrawlRun | null = body.run ?? null;
        setRun(r);
        if (r?.status === 'running') setTimeout(tick, 2000);
        else if (r) onDone(r.started_at);
      } catch {
        setTimeout(tick, 4000);
      }
    };
    setTimeout(tick, 1200);
  };

  const stop = async () => {
    if (!run) return;
    await fetch(`/api/search/run?id=${run.id}`, { method: 'DELETE' }).catch(() => {});
  };

  const running = run?.status === 'running';
  const pct = run && run.companies_total > 0
    ? Math.min(100, Math.round((run.companies_done / run.companies_total) * 100))
    : 0;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!running && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', gap: 2, background: V('panel2'), border: `1px solid ${V('line')}`, borderRadius: 8, padding: 2 }}>
              {([['all', 'Everything due'], ['companies', 'By companies'], ['credits', 'By credits']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setMode(k)} style={seg(mode === k)}>{l}</button>
              ))}
            </div>

            {mode === 'companies' && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted') }}>
                visit
                <input value={companies} onChange={(e) => setCompanies(Math.max(1, Number(e.target.value) || 1))} inputMode="numeric" style={{ ...inp(), width: 72, padding: '5px 8px' }} />
                companies
              </label>
            )}
            {mode === 'credits' && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted') }}>
                spend up to
                <input value={credits} onChange={(e) => setCredits(Math.max(1, Number(e.target.value) || 1))} inputMode="numeric" style={{ ...inp(), width: 82, padding: '5px 8px' }} />
                credits
              </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={primaryBtn(starting || planned === 0 || overBudget)} disabled={starting || planned === 0 || overBudget} onClick={startRun}>
              {starting ? 'starting…' : planned === 0 ? 'Everything here was checked recently' : `Search ${planned.toLocaleString()} companies`}
            </button>
            {planned > 0 && (
              <span style={{ ...label, color: overBudget ? V('red') : V('faint') }}>
                ≈ {estimate.toLocaleString()} credits
                {budget?.basis === 'measured' ? ' (from your own runs)' : ' (rough)'}
                {' · runs in the background, roughly '}
                {Math.max(1, Math.round((planned * 2.5) / 60))} min
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...label, color: V('faint') }}>
              {unvisited.toLocaleString()} never visited · {due.toLocaleString()} due for a
              re-check · {fresh.toLocaleString()} checked recently
            </span>
            {fresh > 0 && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted'), cursor: 'pointer' }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                include the {fresh.toLocaleString()} checked recently
              </label>
            )}
          </div>

          {overBudget && (
            <span style={{ color: V('red'), fontSize: 12.5 }}>
              That would cost more than the {budget?.remaining?.toLocaleString()} credits left
              this month. Narrow it, or raise BRIGHTDATA_MONTHLY_LIMIT.
            </span>
          )}
        </>
      )}

      {run && (
        <div style={{ ...card, borderColor: running ? V('cyan') : V('lineSoft'), padding: '12px 14px', display: 'grid', gap: 9 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...label, color: running ? V('cyan') : V('faint') }}>
              {running ? 'searching' : run.status === 'stopped' ? 'stopped' : run.status === 'error' ? 'failed' : 'finished'}
            </span>
            <span style={{ fontSize: 13 }}>
              {run.companies_done.toLocaleString()} of {run.companies_total.toLocaleString()} companies
            </span>
            {running && <span style={{ ...label, color: V('faint') }}>{pct}%</span>}
            {running && (
              <button style={{ ...ghostBtn, marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }} onClick={stop}>
                Stop
              </button>
            )}
          </div>

          <div style={{ height: 6, borderRadius: 999, background: V('bg2'), overflow: 'hidden' }}>
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: running ? V('cyan') : V('ok'),
                transition: 'width .4s ease',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={chip(run.roles_added > 0 ? V('cyan') : V('faint'))}>+{run.roles_added} matching roles</span>
            <span style={chip(V('faint'))}>+{run.positions_added} positions</span>
            {run.positions_closed > 0 && <span style={chip(V('faint'))}>{run.positions_closed} no longer posted</span>}
            <span style={chip(V('amber'))}>{run.credits_used} credits</span>
          </div>

          {run.error && <ErrorNote>{run.error}</ErrorNote>}
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

function Results({ preview }: { preview: SearchPreview }) {
  const { hits, missingYearsData, yearsFilterActive, dismissed, closed } = preview;
  const router = useRouter();
  const newCount = hits.filter((h) => h.isNew).length;

  /** Toggle a flag in the URL, so what is being shown stays linkable. */
  const toggleParam = (key: string) => {
    const q = new URLSearchParams(window.location.search);
    if (q.get(key) === '1') q.delete(key);
    else q.set(key, '1');
    router.push(`/search?${q.toString()}`);
  };
  const showing = (key: string) =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get(key) === '1';

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 20 }}>
          {hits.length} matching {hits.length === 1 ? 'role' : 'roles'} found so far
        </span>
        {newCount > 0 && (
          <span style={{ ...chip(V('cyan')), fontSize: 10.5 }}>{newCount} from your last search</span>
        )}
        <Link href="/jobs" style={{ ...label, color: V('cyan'), textDecoration: 'none' }}>
          track these in Jobs →
        </Link>
      </div>

      {(dismissed > 0 || closed > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <span style={{ ...label, color: V('faint') }}>hidden</span>
          {dismissed > 0 && (
            <button onClick={() => toggleParam('dismissed')} style={pill(showing('dismissed'), V('red'))}>
              {dismissed} you dismissed
            </button>
          )}
          {closed > 0 && (
            <button onClick={() => toggleParam('closed')} style={pill(showing('closed'), V('faint'))}>
              {closed} no longer posted
            </button>
          )}
        </div>
      )}

      {yearsFilterActive && missingYearsData > 0 && (
        <div style={{ ...card, borderColor: V('amber'), padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ ...label, color: V('amber') }}>
            the experience filter could not be applied to {missingYearsData} of these
          </div>
          <p style={{ color: V('muted'), fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.6 }}>
            Their listings never state a range, so they are shown rather than hidden.
          </p>
        </div>
      )}

      {hits.length === 0 ? (
        <Empty>Nothing matches yet. Search more companies above, or widen the filters.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hits.map((h) => <HitRow key={h.id} hit={h} />)}
        </div>
      )}
    </div>
  );
}

function HitRow({ hit }: { hit: SearchHit }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [hidden, setHidden] = useState(false);

  // Dismissing is optimistic: the row disappears at once and the count in the
  // "hidden" bar picks it up on the next render. Waiting for a round trip to
  // clear one row makes triaging a long list feel broken.
  const dismiss = () => {
    setHidden(true);
    start(() => {
      setRoleStatus(hit.id, 'rejected');
      router.refresh();
    });
  };

  if (hidden) return null;

  return (
    <div style={{ ...card, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, borderColor: hit.isNew ? V('cyan') : V('line') }}>
      <Link href={`/companies/${hit.companyId}?role=${hit.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none', color: V('text') }}>
        <span style={{ width: 14, color: V('amber') }}>{hit.paths > 0 ? '★' : ''}</span>
        <b style={{ minWidth: 150 }} dir="auto">{hit.companyName}</b>
        <span style={{ flex: 1, minWidth: 0 }} dir="auto">{hit.title}</span>
        {hit.sector && <span style={{ ...chip(V('violet')), fontSize: 10.5 }} dir="auto">{hit.sector}</span>}
        <span style={senChip}>{hit.seniority}</span>
        {(hit.minYears != null || hit.maxYears != null) && (
          <span style={{ ...label, minWidth: 54 }}>{hit.minYears ?? '?'}–{hit.maxYears ?? '?'} yrs</span>
        )}
        <span style={{ ...label, minWidth: 90 }} dir="auto">{hit.location}</span>
        {hit.isNew && <span style={{ ...chip(V('cyan')), fontSize: 10.5 }}>new</span>}
        {hit.dismissed && <span style={{ ...chip(V('red')), fontSize: 10.5 }}>dismissed</span>}
        {hit.closed && <span style={{ ...chip(V('faint')), fontSize: 10.5 }}>gone</span>}
        <span style={chip(hit.paths > 0 ? V('ok') : V('red'))}>
          {hit.paths > 0 ? `${hit.paths} ${hit.paths === 1 ? 'path' : 'paths'}` : 'no path'}
        </span>
      </Link>
      {hit.url && <a href={hit.url} target="_blank" rel="noreferrer" style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>job ↗</a>}
      {!hit.dismissed && (
        <button
          onClick={dismiss}
          title="Not relevant — hide it from searches"
          style={{ font: 'inherit', fontSize: 12, lineHeight: 1, padding: '5px 9px', borderRadius: 7, cursor: 'pointer', background: 'transparent', color: V('faint'), border: `1px solid ${V('line')}` }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
