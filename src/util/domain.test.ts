import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, registrableDomain, sameDomain } from './domain.js';
import { normalizeCompanyPageUrl } from '../agents/people/verifyCompany.js';
import { buildQuery, presetsFor, customPreset, DEFAULT_ROLE_KEYS } from '../agents/people/roles.js';
import { parseProfiles } from '../agents/people/index.js';

describe('domain comparison', () => {
  test('subdomains and schemes collapse to the registrable domain', () => {
    assert.equal(registrableDomain('https://www.wiz.io'), 'wiz.io');
    assert.equal(registrableDomain('https://careers.wiz.io/jobs/1'), 'wiz.io');
    assert.equal(registrableDomain('wiz.io'), 'wiz.io');
    assert.equal(hostOf('https://www.wiz.io/careers'), 'wiz.io');
  });

  test('two-part suffixes are not mistaken for the registrable domain', () => {
    // Getting this wrong would make every .co.il company match every other.
    assert.equal(registrableDomain('https://jobs.acme.co.il'), 'acme.co.il');
    assert.equal(registrableDomain('https://acme.co.il'), 'acme.co.il');
    assert.equal(sameDomain('https://acme.co.il', 'https://other.co.il'), false);
  });

  test('same company across subdomains, different companies apart', () => {
    assert.equal(sameDomain('https://www.wiz.io', 'https://careers.wiz.io'), true);
    assert.equal(sameDomain('https://wiz.io', 'https://wiz-security.com'), false);

    // The real mismatch found in the company list: the searcher resolved
    // "NewCore" to a careers page on a different company's domain.
    assert.equal(sameDomain('https://nucor.com', 'https://newcore.com'), false);
  });

  test('junk in gives null out rather than a false match', () => {
    assert.equal(registrableDomain(''), null);
    assert.equal(registrableDomain('localhost'), null);
    assert.equal(registrableDomain('192.168.0.1'), null);
    assert.equal(sameDomain(null, null), false, 'two unknowns are not a match');
  });
});

describe('LinkedIn company page URLs', () => {
  test('canonicalized, and only company pages', () => {
    assert.equal(normalizeCompanyPageUrl('https://www.linkedin.com/company/Wiz-Io/'), 'https://www.linkedin.com/company/wiz-io');
    assert.equal(normalizeCompanyPageUrl('https://il.linkedin.com/company/wiz?trk=x'), 'https://www.linkedin.com/company/wiz');
    assert.equal(normalizeCompanyPageUrl('https://www.linkedin.com/in/dana-cohen'), null);
    assert.equal(normalizeCompanyPageUrl(null), null);
  });
});

describe('role presets', () => {
  test('defaults to product and HR, and honours a selection', () => {
    assert.deepEqual(presetsFor(undefined).map((p) => p.key), DEFAULT_ROLE_KEYS);
    assert.deepEqual(presetsFor([]).map((p) => p.key), DEFAULT_ROLE_KEYS);
    assert.deepEqual(presetsFor(['founders']).map((p) => p.key), ['founders']);
  });

  test('a custom title list becomes an ad-hoc preset', () => {
    assert.equal(customPreset([' Solutions Architect ', ''])!.terms[0], 'solutions architect');
    assert.equal(customPreset(['   ']), null);
  });

  test('queries quote multi-word terms and keep location optional', () => {
    const preset = presetsFor(['product'])[0];
    const q = buildQuery('Wiz', preset);
    assert.match(q, /site:linkedin\.com\/in "Wiz"/);
    assert.match(q, /"product manager"/);
    assert.doesNotMatch(q, /\(israel/, 'no location unless one is given');

    assert.match(buildQuery('Wiz', preset, 'israel'), /\(israel\)$/);
  });
});

describe('profile result filtering', () => {
  const results = [
    { title: 'Dana Cohen - Product Manager - Wiz | LinkedIn', url: 'https://www.linkedin.com/in/dana-cohen', description: 'Wiz' },
    { title: 'Someone Else - PM - Acme', url: 'https://www.linkedin.com/in/someone', description: 'Acme Corp' },
    { title: 'A Company Page', url: 'https://www.linkedin.com/company/wiz', description: 'Wiz' },
    { title: 'x'.repeat(80) + ' - PM - Wiz', url: 'https://www.linkedin.com/in/long', description: 'Wiz' },
  ];

  test('keeps profiles that mention the company, drops the rest', () => {
    const out = parseProfiles(results, 'Wiz', 'product');
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Dana Cohen');
    assert.equal(out[0].role, 'Product Manager');
    assert.equal(out[0].url, 'https://www.linkedin.com/in/dana-cohen', 'URL is canonicalized');
  });

  test('company pages and headline-length "names" are rejected', () => {
    const out = parseProfiles(results, 'Wiz', 'product');
    assert.equal(out.some((o) => o.url.includes('/company/')), false);
    assert.equal(out.some((o) => o.name.length > 60), false);
  });
});
