/**
 * Tests for deciding whose host a host is.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hostLabel, hostLooksLikeCompany, isJobBoardHost } from './hosts.js';
import { similarity } from './normalize.js';

const looks = (host: string | null, name: string) => hostLooksLikeCompany(host, name, similarity);

describe('hostLabel', () => {
  test('strips role subdomains and public suffixes', () => {
    assert.equal(hostLabel('www.acme.com'), 'acme');
    assert.equal(hostLabel('jobs.acme.co.il'), 'acme');
    assert.equal(hostLabel('careers.acme.io'), 'acme');
    assert.equal(hostLabel('acme.ai'), 'acme');
    assert.equal(hostLabel('www.jobs.alpha-omega.co.il'), 'alphaomega');
  });
});

describe('hostLooksLikeCompany', () => {
  test('accepts a company on its own domain', () => {
    assert.equal(looks('www.cyberark.com', 'CyberArk'), true);
    assert.equal(looks('acsense.com', 'Acsense'), true);
    assert.equal(looks('careers.pentera.io', 'Pentera Security'), true);
  });

  test('rejects the unrelated hosts the crawler actually stored', () => {
    // Every one of these is a real row from the database: the resolver keeps
    // the first non-social host a SERP returns, whoever it belongs to.
    assert.equal(looks('www.google.com', 'Aidoc'), false);
    assert.equal(looks('www.pgcareers.com', 'Alma Lasers'), false);
    assert.equal(looks('jobs.virginia.edu', 'Alpha Omega'), false);
    assert.equal(looks('www.greenhouse.com', 'Hazera'), false);
    assert.equal(looks('www.devjobs.co.il', 'ADAMA Agricultural Solutions'), false);
  });

  test('a one-word name does not match every host that contains it', () => {
    // The short-name trap: "rain" must not claim raincheck.com AND rainguard.io.
    assert.equal(looks('www.rainforest-alliance.org', 'Rain'), false);
    assert.equal(looks('rain.com', 'Rain'), true);
  });

  test('handles a missing or malformed host without throwing', () => {
    assert.equal(looks(null, 'Acme'), false);
    assert.equal(looks('', 'Acme'), false);
    assert.equal(looks('acme.com', ''), false);
  });
});

describe('isJobBoardHost', () => {
  test('catches the aggregators and venture boards found in this data', () => {
    for (const u of [
      'https://wellfound.com/company/acme',
      'https://builtin.com/company/acme',
      'https://www.secretjobs.ai/acme',
      'https://jobs.techaviv.com/companies/acme',
      'https://jobs.motion.vc/companies/acme',
      'https://www.dice.com/jobs',
    ]) {
      assert.equal(isJobBoardHost(u), true, u);
    }
  });

  test('leaves a company site and a real ATS board alone', () => {
    for (const u of ['https://acme.com/careers', 'https://boards.greenhouse.io/acme', 'https://acme.comeet.co']) {
      assert.equal(isJobBoardHost(u), false, u);
    }
  });
});

describe('hostLooksLikeCompany — the containment directions', () => {
  test('a shorter host that prefixes the name is the company dropping its generic words', () => {
    assert.equal(looks('pentera.io', 'Pentera Security'), true);
    assert.equal(looks('wiz.io', 'Wiz Security'), true);
  });

  test('a longer host is believed only when the extra is a generic corporate tail', () => {
    assert.equal(looks('entrosecurity.com', 'Entro'), true);
    assert.equal(looks('dreamgroup.com', 'Dream'), true);
    assert.equal(looks('rainforest-alliance.org', 'Rain'), false);
    assert.equal(looks('rainchecktravel.com', 'Rain'), false);
  });

  test('a host buried inside the name does not count', () => {
    // "ace" is inside "Palace Software" but palace.com is not ace's domain.
    assert.equal(looks('ace.com', 'Palace Software'), false);
  });
});
