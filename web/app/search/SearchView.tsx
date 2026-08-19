'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SearchHit, SearchPreview, SectorOption } from '@/lib/data/search';
import type { SearchParams } from '../../../src/db/searches.js';
import { V, card, chip, Empty, ErrorNote, Field, ghostBtn, inp, label, PageHead, pill, primaryBtn, senChip } from '../_components/ui';

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
    params.sectors.length ? params.sectors : sectors.filter((s) => s.unvisited > 0).slice(0, 1).map((s) => s.id),
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
                style={pill(selected.includes(s.id), s.unvisited > 0 ? V('violet') : V('faint'))}
                title={`${s.companies} companies · ${s.visited} already visited`}
              >
                {s.name}{' '}
                <span style={{ opacity: 0.75 }}>
                  {s.unvisited > 0 ? `${s.unvisited} new` : 'done'}
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
          budget={budget}
          onDone={() => { loadBudget(); router.refresh(); }}
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

function Crawl({ sectors, unvisited, budget, onDone }: {
  sectors: number[];
  unvisited: number;
  budget: Budget | null;
  onDone: () => void;
}) {
  const [limit, setLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { visited: number; newPositions: number; newTargetRoles: number; enriched: number; remaining: number; creditsUsed: number | null } | null
  >(null);

  const batch = Math.max(0, Math.min(limit, unvisited));
  const perCompany = budget?.perCompany ?? 3;
  const estimate = Math.round(batch * perCompany);
  const overBudget = budget?.remaining != null && estimate > budget.remaining;

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/search/crawl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sectors, limit: batch }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Search failed (HTTP ${res.status})`);
      setResult(body);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={primaryBtn(busy || batch === 0 || overBudget)} disabled={busy || batch === 0 || overBudget} onClick={run}>
          {busy ? `searching ${batch} companies…` : batch === 0 ? 'Nothing new to visit' : `Search ${batch} new companies`}
        </button>

        {batch > 0 && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted') }}>
            batch
            <input
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              inputMode="numeric"
              style={{ ...inp(), width: 62, padding: '5px 8px' }}
            />
          </label>
        )}

        {batch > 0 && (
          <span style={{ ...label, color: overBudget ? V('red') : V('faint') }}>
            ≈ {estimate.toLocaleString()} credits
            {budget?.basis === 'measured' ? ' (from your own runs)' : ' (rough)'}
            {unvisited > batch && ` · ${(unvisited - batch).toLocaleString()} more after this`}
          </span>
        )}
      </div>

      {overBudget && (
        <span style={{ color: V('red'), fontSize: 12.5 }}>
          That batch would cost more than the {budget?.remaining?.toLocaleString()} credits left
          this month. Lower the batch, or raise BRIGHTDATA_MONTHLY_LIMIT.
        </span>
      )}

      {busy && (
        <span style={{ color: V('faint'), fontSize: 12 }}>
          A few seconds per company, then the new roles are read for experience and location.
          Leave the tab open.
        </span>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {result && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={chip(V('ok'))}>{result.visited} companies visited</span>
          <span style={chip(result.newTargetRoles > 0 ? V('cyan') : V('faint'))}>
            +{result.newTargetRoles} matching roles
          </span>
          <span style={chip(V('faint'))}>+{result.newPositions} positions total</span>
          {result.enriched > 0 && <span style={chip(V('faint'))}>{result.enriched} read for years &amp; location</span>}
          {result.creditsUsed != null && <span style={chip(V('amber'))}>{result.creditsUsed} credits spent</span>}
          <span style={chip(V('faint'))}>{result.remaining.toLocaleString()} companies left</span>
        </div>
      )}
    </div>
  );
}

function Results({ preview }: { preview: SearchPreview }) {
  const { hits, missingYearsData, yearsFilterActive } = preview;

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 20 }}>
          {hits.length} matching {hits.length === 1 ? 'role' : 'roles'} found so far
        </span>
        <Link href="/jobs" style={{ ...label, color: V('cyan'), textDecoration: 'none' }}>
          track these in Jobs →
        </Link>
      </div>

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
  return (
    <div style={{ ...card, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Link href={`/companies/${hit.companyId}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none', color: V('text') }}>
        <span style={{ width: 14, color: V('amber') }}>{hit.paths > 0 ? '★' : ''}</span>
        <b style={{ minWidth: 150 }} dir="auto">{hit.companyName}</b>
        <span style={{ flex: 1, minWidth: 0 }} dir="auto">{hit.title}</span>
        {hit.sector && <span style={{ ...chip(V('violet')), fontSize: 10.5 }} dir="auto">{hit.sector}</span>}
        <span style={senChip}>{hit.seniority}</span>
        {(hit.minYears != null || hit.maxYears != null) && (
          <span style={{ ...label, minWidth: 54 }}>{hit.minYears ?? '?'}–{hit.maxYears ?? '?'} yrs</span>
        )}
        <span style={{ ...label, minWidth: 90 }} dir="auto">{hit.location}</span>
        <span style={chip(hit.paths > 0 ? V('ok') : V('red'))}>
          {hit.paths > 0 ? `${hit.paths} ${hit.paths === 1 ? 'path' : 'paths'}` : 'no path'}
        </span>
      </Link>
      {hit.url && <a href={hit.url} target="_blank" rel="noreferrer" style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>job ↗</a>}
    </div>
  );
}
