'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SearchHit, SearchPreview, SectorOption } from '@/lib/data/search';
import type { SearchParams } from '../../../src/db/searches.js';
import { V, card, chip, Empty, Field, ghostBtn, inp, label, PageHead, pill, primaryBtn, senChip } from '../_components/ui';

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
                title={`${s.companies} companies · ${s.crawled} already crawled`}
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

      {preview && <Results preview={preview} />}
    </>
  );
}

function Results({ preview }: { preview: SearchPreview }) {
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

      {uncrawled > 0 && (
        <div style={{ ...card, borderColor: V('amber'), padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ ...label, color: V('amber') }}>{uncrawled} companies have never been crawled</div>
          <p style={{ color: V('muted'), fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.6 }}>
            These results only cover companies already visited. To reach the rest, run{' '}
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>npm run job search</code>{' '}
            — it costs roughly one or two scrape credits per company, so it is a
            deliberate step rather than something this page does for you.
          </p>
        </div>
      )}

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
