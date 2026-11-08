/**
 * Tests for guessing a company's ATS board slug.
 *
 * The whole value of this path is precision: it costs nothing, so it can be
 * tried for every company, which means a sloppy match would mis-file openings
 * at scale rather than once.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { slugCandidates, probeAtsBySlug } from './atsSlug.js';
import type { AtsType, FoundPosition } from './types.js';

const job = (title: string): FoundPosition => ({ title, location: 'Tel Aviv, Israel' });

/** Boards serving a fixed slug→jobs map; everything else 404s like the real APIs. */
const boards = (map: Partial<Record<string, FoundPosition[]>>, types: AtsType[] = ['greenhouse']) => {
  const asked: string[] = [];
  const list = types.map(
    (t) =>
      [
        t,
        async (slug: string) => {
          asked.push(`${t}:${slug}`);
          const hit = map[`${t}:${slug}`];
          if (!hit) throw new Error(`404 ${t}/${slug}`);
          return hit;
        },
      ] as [AtsType, (s: string) => Promise<FoundPosition[]>],
  );
  return { asked, list };
};

describe('slugCandidates', () => {
  test('builds the forms a company actually registers', () => {
    const s = slugCandidates('SURF Security');
    assert.ok(s.includes('surfsecurity'));
    assert.ok(s.includes('surf-security'));
    assert.ok(s.includes('surf'), 'the generic word is droppable');
  });

  test('drops the filler words but keeps the distinctive ones', () => {
    assert.ok(slugCandidates('Quantum Machines').includes('quantummachines'));
    const s = slugCandidates('Zafran Security Technologies');
    assert.ok(s.includes('zafran'));
  });

  test('ignores slugs too short to be meaningful', () => {
    assert.deepEqual(slugCandidates('AI'), []);
    assert.deepEqual(slugCandidates(''), []);
  });
});

describe('probeAtsBySlug', () => {
  test('finds the board and returns the openings it already fetched', async () => {
    const b = boards({ 'greenhouse:surfsecurity': [job('Product Manager')] });
    const r = await probeAtsBySlug('SURF Security', { boards: b.list });
    assert.equal(r.careersUrl, 'https://boards.greenhouse.io/surfsecurity');
    assert.equal(r.atsType, 'greenhouse');
    assert.equal(r.token, 'surfsecurity');
    assert.equal(r.positions.length, 1, 'the API call is not repeated by the caller');
  });

  test('tries several ATSes and several slugs', async () => {
    const b = boards({ 'lever:zafran': [job('Solutions Engineer')] }, ['greenhouse', 'lever']);
    const r = await probeAtsBySlug('Zafran Security', { boards: b.list });
    assert.equal(r.atsType, 'lever');
    assert.equal(r.token, 'zafran');
    assert.ok(b.asked.length > 1, 'it kept asking after the first 404');
  });

  test('an empty board is not claimed', async () => {
    // A board that answers with no jobs tells us nothing about whose it is,
    // and claiming it would record a careers URL nobody verified.
    const b = boards({ 'greenhouse:surfsecurity': [] });
    const r = await probeAtsBySlug('SURF Security', { boards: b.list });
    assert.equal(r.careersUrl, null);
  });

  test('never asks for a slug the company could not own', async () => {
    // The guard that matters. "Rain" must not reach raincheck's board, and a
    // short name must not claim every longer one that starts the same way.
    const b = boards({ 'greenhouse:palantir': [job('Forward Deployed Engineer')] });
    const r = await probeAtsBySlug('Pala Security', { boards: b.list });
    assert.equal(r.careersUrl, null);
    assert.ok(
      !b.asked.some((a) => a.endsWith(':palantir')),
      'a slug that is not this company was never tried',
    );
  });

  test('reports a clean miss rather than throwing', async () => {
    const b = boards({});
    const r = await probeAtsBySlug('Nobody At All', { boards: b.list });
    assert.equal(r.careersUrl, null);
    assert.equal(r.positions.length, 0);
    assert.ok(r.calls > 0, 'it did try');
  });

  test('a company with no usable slug costs nothing', async () => {
    const b = boards({});
    const r = await probeAtsBySlug('AI', { boards: b.list });
    assert.equal(r.calls, 0);
    assert.deepEqual(b.asked, []);
  });
});

describe('rebrand slugs', () => {
  test("finds a board under the company's rebranded short name", async () => {
    // SURF Security runs its Greenhouse board as "surfai". Nothing derived from
    // the registered name produces that, and it cost an afternoon to find by hand.
    const b = boards({ 'greenhouse:surfai': [job('Senior Software Engineer')] });
    const r = await probeAtsBySlug('SURF Security', { boards: b.list });
    assert.equal(r.token, 'surfai');
    assert.equal(r.careersUrl, 'https://boards.greenhouse.io/surfai');
  });

  test('a rebrand guess still has to pass the ownership rule', async () => {
    // "palantirai" must not be reachable from "Pala Security".
    const b = boards({ 'greenhouse:palantirai': [job('Forward Deployed Engineer')] });
    const r = await probeAtsBySlug('Pala Security', { boards: b.list });
    assert.equal(r.careersUrl, null);
  });
});
