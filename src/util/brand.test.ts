/**
 * Tests for reading whose brand a page carries.
 *
 * The cases are taken from real pages: an acquired company's domain keeps
 * resolving and keeps returning 200, it just serves the acquirer.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkBrand, looksAcquired, titleSegments, brandCandidates, looksLikeBrandName } from './brand.js';

const page = (title: string, siteName?: string) =>
  `<html><head><title>${title}</title>` +
  (siteName ? `<meta property="og:site_name" content="${siteName}">` : '') +
  `</head><body><p>Some content on the page.</p></body></html>`;

describe('titleSegments', () => {
  test('splits on the separators sites actually use', () => {
    assert.deepEqual(titleSegments('Life at Menlo - Careers | Menlo Security'), [
      'Life at Menlo', 'Careers', 'Menlo Security',
    ]);
    assert.deepEqual(titleSegments('Careers – Acme'), ['Careers', 'Acme']);
  });

  test('leaves a hyphenated name alone', () => {
    assert.deepEqual(titleSegments('Bio-Rad Laboratories'), ['Bio-Rad Laboratories']);
  });
});

describe('brandCandidates', () => {
  test('prefers og:site_name over the title', () => {
    const c = brandCandidates(page('Careers', 'Menlo Security'));
    assert.equal(c[0], 'Menlo Security');
  });
});

describe('checkBrand', () => {
  test("a company's own page is not a mismatch", () => {
    assert.equal(checkBrand(page('Careers | Votiro'), 'Votiro Cybersec').mismatch, false);
    assert.equal(checkBrand(page('Acsense - Open Positions'), 'Acsense').mismatch, false);
  });

  test('the distinctive first word is enough', () => {
    // "Votiro Cybersec" on a page titled only "Votiro" is still their page.
    assert.equal(checkBrand(page('Votiro'), 'Votiro Cybersec').mismatch, false);
  });

  test('reads the acquirer off a page that no longer names the company', () => {
    // Both of these are real titles served from the acquired company's domain.
    const menlo = checkBrand(page('Life at Menlo - Careers | Menlo Security'), 'Votiro Cybersec');
    assert.equal(menlo.mismatch, true);
    assert.equal(menlo.successor, 'Menlo Security');

    const pan = checkBrand(page('Idira | The Identity Security Platform - Palo Alto Networks'), 'CyberArk');
    assert.equal(pan.mismatch, true);
    assert.equal(pan.successor, 'Palo Alto Networks');
  });

  test('a generic page name is not read as an acquirer', () => {
    // "Careers" is a page type. Naming it as the successor would be a lie with
    // a confident shape, which is the worst kind.
    for (const t of ['Careers', 'Page not found', 'Open Positions', 'Home']) {
      const r = checkBrand(page(t), 'Acme Security');
      assert.equal(r.successor, null, t);
    }
  });

  test('a page with no brand strings at all is not a mismatch', () => {
    // Absence of evidence: say nothing rather than guess.
    const r = checkBrand('<html><body>hello</body></html>', 'Acme');
    assert.equal(r.mismatch, false);
    assert.equal(r.successor, null);
  });

  test('a long sentence is not a brand', () => {
    const r = checkBrand(
      page('We are a leading provider of cloud security solutions for modern enterprises worldwide'),
      'Acme Security',
    );
    assert.equal(r.successor, null);
  });
});

describe('looksAcquired', () => {
  test('fires only when another organisation is actually named', () => {
    assert.ok(looksAcquired(page('Life at Menlo - Careers | Menlo Security'), 'Votiro'));
    // Mismatch, but nobody named: not actionable on its own.
    assert.equal(looksAcquired(page('Careers'), 'Acme Security'), null);
    assert.equal(looksAcquired(page('Acme Security - Careers'), 'Acme Security'), null);
  });

  test('a rebrand that keeps the name is not an acquisition', () => {
    // SURF Security runs as "Surf AI"; the name is still there.
    assert.equal(looksAcquired(page('Surf AI | Careers'), 'SURF Security'), null);
  });
});

describe('looksLikeBrandName', () => {
  test('accepts company names', () => {
    for (const n of ['Menlo Security', 'Palo Alto Networks', 'Rubrik', 'CrowdStrike', 'Bio-Rad']) {
      assert.equal(looksLikeBrandName(n), true, n);
    }
  });

  test('rejects the taglines a dry run actually offered as acquirers', () => {
    // "7Ci -> Secure. At The Core." was a real proposed flag.
    for (const n of [
      'Secure. At The Core.',
      'The Identity Security Platform for the AI era',
      'Fast, simple, secure',
      'Protecting what matters, everywhere',
      '2026',
      '—',
    ]) {
      assert.equal(looksLikeBrandName(n), false, n);
    }
  });
});

describe('the whole-page check refuses a tagline as a successor', () => {
  test('a marketing title yields no acquirer', () => {
    const html = '<html><head><title>7Ci - Secure. At The Core.</title></head><body><p>Lots of content here indeed.</p></body></html>';
    assert.equal(looksAcquired(html, 'Acme Security'), null);
  });
});
