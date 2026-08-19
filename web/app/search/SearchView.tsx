'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SearchHit, SearchPreview, SectorOption } from '@/lib/data/search';
import type { SearchParams } from '../../../src/db/searches.js';
import { V, card, chip, Empty, ErrorNote, Field, ghostBtn, inp, label, PageHead, pill, primaryBtn, senChip } from '../_components/ui';

export function SearchView({
  sectors, params, preview,
}: {
  sectors: SectorOption[];
  params: SearchParams;
  preview: SearchPreview | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>(params.sectors);
  const [titles, setTitles] = useState(params.titleKeywords.join(', '));
  const [minYears, setMinYears] = useState(params.minYears?.toString() ?? '');
  const [maxYears, setMaxYears] = useState(params.maxYears?.toString() ?? '');
  const [location, setLocation] = useState(params.location ?? '');

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const run = () => {
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
        <PageHead title="Search" sub="Find open roles across a sector" />
        <Empty>
          No company lists loaded yet. Drop a &ldquo;Companies List …&rdquo; CSV export in{' '}
          <code>data/input/</code> and run <code>npm run job ingest-list &lt;file&gt;</code>.
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Search"
        sub="Pick a sector; narrow by title and experience if you want to"
      />

      <section style={{ ...card, padding: 20, display: 'grid', gap: 16 }}>
        <div>
          <div style={label}>Sector — required</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {sectors.map((s) => (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                style={pill(selected.includes(s.id), V('violet'))}
                title={`${s.companies} companies · ${s.crawled} already visited by the crawler`}
              >
                {s.name} <span style={{ opacity: 0.7 }}>({s.companies})</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 90px 90px minmax(0,1fr)', gap: 12, alignItems: 'end' }}>
          <Field l="Job title — optional">
            <input
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
              placeholder="product manager, product owner"
              dir="auto"
              style={inp()}
            />
          </Field>
          <Field l="Min years">
            <input value={minYears} onChange={(e) => setMinYears(e.target.value)} inputMode="numeric" placeholder="—" style={inp()} />
          </Field>
          <Field l="Max years">
            <input value={maxYears} onChange={(e) => setMaxYears(e.target.value)} inputMode="numeric" placeholder="—" style={inp()} />
          </Field>
          <Field l="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Israel"
              dir="auto"
              style={inp()}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={primaryBtn(selected.length === 0)} disabled={selected.length === 0} onClick={run}>
            Search
          </button>
          <span style={{ color: V('faint'), fontSize: 12, lineHeight: 1.6, flex: 1, minWidth: 280 }}>
            Leaving the title empty searches for product-management roles. A role that
            does not state its experience range is kept, not filtered out — most
            listings omit it. Asking for a country matches the cities in it, since
            listings rarely name one: &ldquo;Israel&rdquo; finds Tel Aviv, Herzliya and
            the rest. Type a city instead to narrow to it.
          </span>
        </div>
      </section>

      {preview && <Results preview={preview} sectors={selected} />}
    </>
  );
}

function Results({ preview, sectors }: { preview: SearchPreview; sectors: number[] }) {
  const { hits, uncrawled, companiesInScope, missingYearsData, yearsFilterActive } = preview;

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 20 }}>
          {hits.length} {hits.length === 1 ? 'role' : 'roles'} already found
        </span>
        <span style={{ ...label }}>
          across {companiesInScope} companies in scope
        </span>
      </div>

      {uncrawled > 0 && <Crawl uncrawled={uncrawled} sectors={sectors} />}

      {yearsFilterActive && missingYearsData > 0 && (
        <div style={{ ...card, borderColor: V('amber'), padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ ...label, color: V('amber') }}>
            the experience filter could not be applied to {missingYearsData} of these
          </div>
          <p style={{ color: V('muted'), fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.6 }}>
            They have no experience range on record, so they are shown rather than hidden.
            Reading a range out of a listing is a separate step —{' '}
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>npm run job enrich --all</code>{' '}
            fills it in for roles beyond product management.
          </p>
        </div>
      )}

      {hits.length === 0 ? (
        <Empty>Nothing matches yet in the companies already crawled.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hits.map((h) => <HitRow key={h.id} hit={h} />)}
        </div>
      )}
    </div>
  );
}

/**
 * Crawl the companies in scope that have not been visited.
 *
 * Deliberately a batch you size yourself. Crawling costs two to four credits per
 * company against a monthly cap, so the page states the estimate before you
 * commit and reports what the run actually cost afterwards — a button that
 * quietly spends money is the wrong default.
 */
function Crawl({ uncrawled, sectors }: { uncrawled: number; sectors: number[] }) {
  const router = useRouter();
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ crawled: number; newPositions: number; newTargetRoles: number; remaining: number } | null>(null);

  const batch = Math.min(limit, uncrawled);

  const crawl = async () => {
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
      if (!res.ok) throw new Error(body?.error ?? `Crawl failed (HTTP ${res.status})`);
      setResult(body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, borderColor: V('amber'), padding: '14px 16px', marginBottom: 14 }}>
      <div style={{ ...label, color: V('amber') }}>{uncrawled} companies here have never been crawled</div>
      <p style={{ color: V('muted'), fontSize: 12.5, margin: '6px 0 12px', lineHeight: 1.6 }}>
        These results only cover companies already visited. Crawling reads their careers
        pages and costs roughly two to four scrape credits each.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={crawl} disabled={busy} style={primaryBtn(busy)}>
          {busy ? `crawling ${batch}…` : `Crawl ${batch} now`}
        </button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted') }}>
          batch
          <input
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            inputMode="numeric"
            style={{ ...inp(), width: 62, padding: '5px 8px' }}
          />
        </label>
        <span style={{ color: V('faint'), fontSize: 12 }}>
          ≈ {batch * 2}–{batch * 4} credits · up to 60 per run, the rest from the CLI
        </span>
      </div>

      {busy && (
        <p style={{ color: V('faint'), fontSize: 12, margin: '10px 0 0' }}>
          This takes a while — a few seconds per company. Leave the tab open.
        </p>
      )}

      {error && <div style={{ marginTop: 12 }}><ErrorNote>{error}</ErrorNote></div>}

      {result && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <span style={chip(V('ok'))}>{result.crawled} companies crawled</span>
          <span style={chip(result.newPositions > 0 ? V('ok') : V('faint'))}>+{result.newPositions} positions</span>
          <span style={chip(result.newTargetRoles > 0 ? V('cyan') : V('faint'))}>+{result.newTargetRoles} matching your titles</span>
          <span style={chip(V('faint'))}>{result.remaining} left</span>
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
