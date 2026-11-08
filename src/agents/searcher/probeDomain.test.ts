/**
 * Tests for finding a careers page on a company's own domain.
 *
 * These use a fake fetcher — the point of this module is that it never needs a
 * search engine, so it should never need the network to test either.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  probeCareersOnDomain, looksLikeCareersPage, looksLikeNotFound, atsBoardUrl, CAREERS_PATHS,
} from './probeDomain.js';

const page = (body: string, title = 'Careers') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const filler = '<p>' + 'We build things for customers across many industries. '.repeat(20) + '</p>';

/** A fetcher serving a fixed map of URL -> html; anything else throws. */
const serve = (map: Record<string, string>) => {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (url: string) => {
      seen.push(url);
      if (url in map) return map[url];
      throw new Error(`404 ${url}`);
    },
  };
};

describe('looksLikeNotFound', () => {
  test('catches the site 404 that answers every path', () => {
    assert.equal(looksLikeNotFound(page(filler, 'Page not found | Votiro')), true);
    assert.equal(looksLikeNotFound(page(filler, 'Not Found')), true);
    assert.equal(looksLikeNotFound(page(filler, '404')), true);
  });

  test('an almost-empty body is not a careers page whatever it is titled', () => {
    assert.equal(looksLikeNotFound(page('<div></div>', 'Careers')), true);
  });

  test('a real page is not a 404', () => {
    assert.equal(looksLikeNotFound(page(`${filler}<h1>Open Positions</h1>`)), false);
  });
});

describe('looksLikeCareersPage', () => {
  test('accepts the usual careers-page phrasings', () => {
    for (const body of ['<h1>Open Positions</h1>', '<h2>Join our team</h2>', '<a>Apply now</a>', '<h1>Current Openings</h1>']) {
      assert.equal(looksLikeCareersPage(page(filler + body)), true, body);
    }
  });

  test('rejects a 404 and a page with no hiring language', () => {
    assert.equal(looksLikeCareersPage(page(filler, 'Page not found')), false);
    assert.equal(looksLikeCareersPage(page(`${filler}<p>Our leadership team and investors.</p>`)), false);
  });

  test('ignores hiring words that only appear inside scripts', () => {
    assert.equal(looksLikeCareersPage(page(`${filler}<script>var x="open positions"</script>`)), false);
  });
});

describe('probeCareersOnDomain', () => {
  test('returns the ATS board when the careers page links one', async () => {
    // The best outcome: a tokened board has a structured API, so no parsing.
    const s = serve({
      'https://acme.com/careers': page(`${filler}<a href="https://boards.greenhouse.io/acmecorp">Open Positions</a>`),
    });
    const r = await probeCareersOnDomain('https://acme.com', { fetch: s.fetch });
    assert.equal(r.careersUrl, 'https://boards.greenhouse.io/acmecorp');
    assert.equal(r.atsType, 'greenhouse');
    assert.equal(r.token, 'acmecorp');
    assert.equal(r.via, '/careers');
    assert.equal(r.requests, 1, 'the first path hit, so only one request was spent');
  });

  test('falls back to the careers page itself when no ATS is named', async () => {
    const s = serve({ 'https://acme.com/careers': page(`${filler}<h1>Current Openings</h1>`) });
    const r = await probeCareersOnDomain('https://acme.com', { fetch: s.fetch });
    assert.equal(r.careersUrl, 'https://acme.com/careers');
    assert.equal(r.atsType, 'generic');
  });

  test('tries later paths when the first does not exist', async () => {
    const s = serve({ 'https://acme.com/jobs': page(`${filler}<h1>Open Positions</h1>`) });
    const r = await probeCareersOnDomain('https://acme.com', { fetch: s.fetch });
    assert.equal(r.careersUrl, 'https://acme.com/jobs');
    assert.deepEqual(s.seen, ['https://acme.com/careers', 'https://acme.com/jobs']);
  });

  test('walks past a site that serves its 404 page with a 200', async () => {
    // Votiro and Sweet Security both do this: every path returns a page.
    const notFound = page(filler, 'Not Found');
    const s = serve({
      'https://acme.com/careers': notFound,
      'https://acme.com/jobs': notFound,
      'https://acme.com/careers/open-positions': page(`${filler}<h1>Join our team</h1>`),
    });
    const r = await probeCareersOnDomain('https://acme.com', { fetch: s.fetch, maxPaths: 3 });
    assert.equal(r.careersUrl, 'https://acme.com/careers/open-positions');
    assert.equal(r.requests, 3);
  });

  test('gives up without a verdict rather than guessing', async () => {
    const s = serve({});
    const r = await probeCareersOnDomain('https://acme.com', { fetch: s.fetch });
    assert.equal(r.careersUrl, null, 'no careers page found is reported as null, not invented');
    assert.equal(r.atsType, 'unknown');
    assert.equal(r.websiteUrl, 'https://acme.com');
  });

  test('never spends more requests than it is allowed', async () => {
    const s = serve({});
    const r = await probeCareersOnDomain('https://acme.com', { fetch: s.fetch, maxPaths: 2 });
    assert.equal(r.requests, 2);
    assert.ok(CAREERS_PATHS.length > 2, 'there are more paths than the cap, so the cap is doing something');
  });

  test('a malformed website is not probed at all', async () => {
    const s = serve({});
    const r = await probeCareersOnDomain('not a url', { fetch: s.fetch });
    assert.equal(r.careersUrl, null);
    assert.equal(r.requests, 0);
    assert.deepEqual(s.seen, []);
  });
});

describe('atsBoardUrl', () => {
  test('builds the canonical board URL per ATS', () => {
    assert.equal(atsBoardUrl('greenhouse', 'acme'), 'https://boards.greenhouse.io/acme');
    assert.equal(atsBoardUrl('lever', 'acme'), 'https://jobs.lever.co/acme');
    assert.equal(atsBoardUrl('ashby', 'acme'), 'https://jobs.ashbyhq.com/acme');
    assert.equal(atsBoardUrl('comeet', 'acme'), null, 'comeet has no token-addressable board');
    assert.equal(atsBoardUrl('greenhouse', undefined), null);
  });
});

describe('a domain that has stopped being the company’s', () => {
  const branded = (title: string, body = '<h1>Open Positions</h1><a href="https://jobs.ashbyhq.com/menlosecurity">Apply</a>') =>
    `<html><head><title>${title}</title></head><body>${filler}${body}</body></html>`;

  test("reports the acquirer instead of the acquirer's job board", async () => {
    // This ordering is the point. votiro.com/careers serves Menlo Security's
    // Ashby board; a probe that looked for an embedded ATS first would hand
    // Votiro's row Menlo's board and file Menlo's openings under Votiro.
    const s = serve({ 'https://votiro.com/careers': branded('Life at Menlo - Careers | Menlo Security') });
    const r = await probeCareersOnDomain('https://votiro.com', { fetch: s.fetch, companyName: 'Votiro Cybersec' });
    assert.equal(r.acquiredBy, 'Menlo Security');
    assert.equal(r.careersUrl, null, "the buyer's board must not be claimed for the seller");
    assert.equal(r.atsType, 'unknown');
  });

  test("a company's own careers page is unaffected", async () => {
    const s = serve({ 'https://acme.com/careers': branded('Careers | Acme Security', '<h1>Open Positions</h1>') });
    const r = await probeCareersOnDomain('https://acme.com', { fetch: s.fetch, companyName: 'Acme Security' });
    assert.equal(r.acquiredBy, undefined);
    assert.equal(r.careersUrl, 'https://acme.com/careers');
  });

  test('without a company name the check is simply not run', async () => {
    const s = serve({ 'https://votiro.com/careers': branded('Life at Menlo - Careers | Menlo Security') });
    const r = await probeCareersOnDomain('https://votiro.com', { fetch: s.fetch });
    assert.equal(r.acquiredBy, undefined);
  });
});
