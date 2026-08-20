import { previewSearch, sectorOptions } from '@/lib/data/search';
import { DEFAULT_PARAMS, type SearchParams } from '../../../src/db/searches.js';
import { SearchView } from './SearchView';

export const dynamic = 'force-dynamic';

/** Parameters live in the URL so a search is linkable and survives a reload. */
function paramsFrom(sp: Record<string, string | string[] | undefined>): SearchParams {
  const one = (k: string): string | null => {
    const v = sp[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const num = (k: string): number | null => {
    const v = one(k);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    ...DEFAULT_PARAMS,
    // Ids must be positive. `''.split(',')` yields [''], and Number('') is 0,
    // which passes Number.isInteger — so an absent parameter used to parse as
    // the list id 0 and scope every search to a sector that does not exist.
    sectors: (one('sectors') ?? '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
    titleKeywords: (one('titles') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    minYears: num('minYears'),
    maxYears: num('maxYears'),
    // Where you are looking is a standing preference, not something to re-enter
    // each time: an empty box falls back to DEFAULT_LOCATION rather than
    // quietly widening the search to the whole world.
    location: one('location') ?? DEFAULT_PARAMS.location,
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = paramsFrom(sp);
  const submitted = Object.keys(sp).length > 0;

  return (
    <SearchView
      sectors={sectorOptions()}
      params={params}
      preview={submitted ? previewSearch(params, {
        includeDismissed: sp.dismissed === '1',
        includeClosed: sp.closed === '1',
        newSince: typeof sp.since === 'string' ? sp.since : null,
      }) : null}
    />
  );
}
