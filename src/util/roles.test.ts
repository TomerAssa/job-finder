import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isProductManager, matchesTitle, matcherFromKeywords, yearsOverlap } from './roles.js';
import { listNameFromFile } from '../ingest/companyLists.js';

describe('the product-manager profile', () => {
  test('matches product management in its many flavours', () => {
    for (const t of [
      'Product Manager', 'Senior Product Manager', 'Group Product Manager',
      'Technical Product Manager', 'Product Owner', 'Head of Product',
      'VP Product', 'Director of Product', 'Chief Product Officer', 'AI Product Manager',
    ]) {
      assert.equal(isProductManager(t), true, t);
    }
  });

  test('rejects adjacent roles that also say "product"', () => {
    for (const t of [
      'Product Marketing Manager', 'Product Designer', 'Product Analyst',
      'Product Support Specialist', 'Project Manager', 'Program Manager',
      'Software Engineer', 'Data Scientist',
    ]) {
      assert.equal(isProductManager(t), false, t);
    }
  });
});

describe('general title matching', () => {
  test('a single-word term matches a whole word only', () => {
    const m = { include: ['pm'] };
    assert.equal(matchesTitle('PM, Growth', m), true);
    assert.equal(matchesTitle('PMO Lead', m), false, '"pm" must not match inside "pmo"');
  });

  test('multi-word terms match as a phrase, punctuation and case insensitive', () => {
    const m = { include: ['solutions architect'] };
    assert.equal(matchesTitle('Senior Solutions-Architect', m), true);
    assert.equal(matchesTitle('Architect of Solutions', m), false);
  });

  test('exclude wins over include', () => {
    const m = { include: ['engineer'], exclude: ['sales'] };
    assert.equal(matchesTitle('Backend Engineer', m), true);
    assert.equal(matchesTitle('Sales Engineer', m), false);
  });

  test('empty keywords fall back to the product-manager profile', () => {
    assert.equal(matchesTitle('Product Manager', matcherFromKeywords([])), true);
    assert.equal(matchesTitle('Product Marketing Manager', matcherFromKeywords(null)), false);
    // ...but explicit keywords replace it entirely.
    assert.equal(matchesTitle('Data Scientist', matcherFromKeywords(['data scientist'])), true);
  });
});

describe('years of experience', () => {
  const role = (minYears: number | null, maxYears: number | null) => ({ minYears, maxYears });

  test('overlapping ranges match, disjoint ones do not', () => {
    assert.equal(yearsOverlap(role(3, 6), { minYears: 5, maxYears: 8 }), true);
    assert.equal(yearsOverlap(role(3, 6), { minYears: 7, maxYears: 9 }), false);
    assert.equal(yearsOverlap(role(8, null), { minYears: null, maxYears: 5 }), false);
    assert.equal(yearsOverlap(role(2, 4), { minYears: 4, maxYears: null }), true, 'touching at the boundary counts');
  });

  test('a role that states no range is kept', () => {
    // Most listings omit it; filtering them out would hide the majority of real matches.
    assert.equal(yearsOverlap(role(null, null), { minYears: 5, maxYears: 8 }), true);
  });

  test('asking for no range keeps everything', () => {
    assert.equal(yearsOverlap(role(3, 6), {}), true);
    assert.equal(yearsOverlap(role(3, 6), { minYears: null, maxYears: null }), true);
  });

  test('an open-ended role range still compares correctly', () => {
    assert.equal(yearsOverlap(role(null, 3), { minYears: 2 }), true);
    assert.equal(yearsOverlap(role(10, null), { minYears: 12 }), true);
  });
});

describe('company list naming', () => {
  test('the export filename becomes a readable sector name', () => {
    assert.equal(
      listNameFromFile('Companies List Energy Tech 2026-07-06 1783342580908.csv'),
      'Energy Tech',
    );
    assert.equal(
      listNameFromFile('/x/Companies List  Aerospace, Defense & HLS 2026-07-06 1783342503172.csv'),
      'Aerospace, Defense & HLS',
    );
    assert.equal(listNameFromFile('my-companies.csv'), 'my-companies');
  });
});
