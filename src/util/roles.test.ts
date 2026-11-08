import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isProductManager, matchesTitle, matcherFromKeywords, yearsOverlap } from './roles.js';
import { listNameFromFile } from '../ingest/companyLists.js';

describe('the product-manager profile', () => {
  test('matches product management in its many flavours', () => {
    for (const t of [
      'Product Manager',
      'Technical Product Manager', 'Product Owner', 'AI Product Manager',
      'Associate Product Manager', 'Product Lead',
      // Increasingly how startups advertise a hands-on PM role.
      'Product Builder', 'Founding Product Manager',
    ]) {
      assert.equal(isProductManager(t), true, t);
    }
  });

  test('excludes the executive tier', () => {
    // Not reachable at the experience level this search targets, and they crowd
    // out the roles that are.
    for (const t of [
      'VP Product', 'VP of Product', 'Vice President, Product', 'Head of Product',
      'Director of Product', 'Director, Product Management', 'Chief Product Officer', 'CPO',
    ]) {
      assert.equal(isProductManager(t), false, t);
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

describe('the widened target profile', () => {
  test('matches the solutions family', () => {
    for (const t of [
      'Solutions Engineer', 'Solution Engineer', 'Staff Solutions Engineer',
      'Solutions Architect', 'Cloud Solutions Architect',
      'Solutions Consultant', 'Solutions Manager',
    ]) {
      assert.equal(isProductManager(t), true, t);
    }
  });

  test('matches customer success and the CSM abbreviation', () => {
    for (const t of ['Customer Success Manager', 'CSM', 'Customer Success Engineer']) {
      assert.equal(isProductManager(t), true, t);
    }
    // Single words match whole words only, so the abbreviation cannot match inside another.
    assert.equal(isProductManager('CSManager Platform'), false);
  });

  test('matches a technical product manager', () => {
    assert.equal(isProductManager('Technical Product Manager'), true);
    // "Senior" is now an exclude, so only the plain form survives — see the
    // seniority block below.
    assert.equal(isProductManager('Senior Technical Product Manager'), false);
  });

  test('matches automation roles but not QA test automation', () => {
    for (const t of ['Automation Engineer', 'Automation Developer', 'AI Automation Manager']) {
      assert.equal(isProductManager(t), true, t);
    }
    // The word is the same; the career is not. These were the real titles in
    // the scraped data that a bare "automation" term would have swept in.
    for (const t of [
      'QA Automation Tester', 'Software Engineer - Test Automation',
      'Automation QA Engineer', 'Junior Software Developer – Test Automation',
    ]) {
      assert.equal(isProductManager(t), false, t);
    }
  });

  test('matches forward deployed engineering, below principal level', () => {
    assert.equal(isProductManager('Forward Deployed Engineer'), true);
    assert.equal(isProductManager('Forward Deployed Software Engineer'), true);
    // Was asserted to match. The seniority ceiling now wins: "principal is
    // always too senior for me". Most forward-deployed postings in this data
    // are Principal/Staff/Senior, so this narrows that avenue a lot — reverse
    // by excluding the phrase 'principal product' instead of bare 'principal'.
    assert.equal(isProductManager('Principal Software Engineer, Applied AI (Forward Deployed)'), false);
  });

  test('still refuses the executive tier and the adjacent product roles', () => {
    for (const t of [
      'VP Product', 'Chief Product Officer', 'Director of Product',
      'Product Marketing Manager', 'Product Designer', 'Program Manager',
    ]) {
      assert.equal(isProductManager(t), false, t);
    }
  });
});

describe('seniority and geography exclusions', () => {
  test('drops anything senior', () => {
    for (const t of [
      'Senior Product Manager', 'Senior Solutions Engineer',
      'Senior Data Product Manager, AI', 'Sr. Product Manager',
      'Senior Enterprise Solution Architect',
    ]) {
      assert.equal(isProductManager(t), false, t);
    }
  });

  test('drops team leads and partner roles', () => {
    for (const t of [
      'Automation Team Lead', 'Product Team Leader',
      'Senior Partner Solutions Architect', 'Partner Solutions Manager',
    ]) {
      assert.equal(isProductManager(t), false, t);
    }
  });

  test('drops roles whose title places them outside Israel', () => {
    // Real titles from the scraped data. Regions, not countries, are what
    // titles actually carry.
    for (const t of [
      'CSM EMEA', 'Senior Pre-Sales Solution Engineer - APAC',
      'Customer Success Manager - International',
      'Automation Team Lead, India', 'Product Manager - Germany',
    ]) {
      assert.equal(isProductManager(t), false, t);
    }
  });

  test('keeps the plain roles that remain', () => {
    for (const t of [
      'Product Manager', 'Technical Product Manager', 'Product Manager, AI',
      'Solutions Engineer', 'Customer Success Manager', 'Automation Engineer',
      'Product Manager - Data Security', 'Product Manager (Israel)',
    ]) {
      assert.equal(isProductManager(t), true, t);
    }
  });
});

describe('the seniority ceiling on product roles', () => {
  test('refuses principal and group product', () => {
    // "They are always too senior for me." Both were include terms until the
    // Palo Alto Networks principal roles came through on run 27.
    for (const t of [
      'Principal Product Manager',
      'Principal Product Manager (Cortex Platform)',
      'Principal Product Manager - Application Security',
      'Group Product Manager',
    ]) {
      assert.equal(isProductManager(t), false, t);
    }
  });

  test('refuses them even when another target term is in the title', () => {
    // An exclude, not just a missing include: otherwise "solutions" or
    // "customer success" would carry a principal role through.
    assert.equal(isProductManager('Principal Solutions Architect'), false);
    assert.equal(isProductManager('Principal Customer Success Manager'), false);
  });

  test('still keeps the plain and staff-level product roles', () => {
    assert.equal(isProductManager('Product Manager'), true);
    assert.equal(isProductManager('Technical Product Manager'), true);
    assert.equal(isProductManager('Staff Product Manager'), true);
  });
});
