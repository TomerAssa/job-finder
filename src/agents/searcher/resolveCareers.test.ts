/**
 * Tests for careers-URL acceptance. Pure functions only — no network, no DB.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tokenMatches, isJobBoardHost } from './resolveCareers.js';
import { normalizeCompany } from '../../util/normalize.js';

const matches = (company: string, slug: string) => tokenMatches(normalizeCompany(company), slug);

describe('matching an ATS slug to a company', () => {
  test('accepts an exact slug', () => {
    assert.equal(matches('Entro Security', 'entro'), true);
    assert.equal(matches('Orca Security', 'orca'), true);
  });

  test('accepts a slug that extends the company name (brand or parent group)', () => {
    // The slug may be longer than the name's distinctive word: a company can
    // board under its group. This is the documented "dreamgroup" case.
    assert.equal(matches('Dream Security', 'dreamgroup'), true);
    assert.equal(matches('Mend', 'mend-io'), true);
  });

  test('rejects a slug that is merely a PREFIX of the company name', () => {
    // The direction that caused the damage: slug "rain" was accepted for three
    // different companies, so one board's 41 roles were filed under each.
    assert.equal(matches('RainCheck AI', 'rain'), false);
    assert.equal(matches('Rainguard AI', 'rain'), false);
    assert.equal(matches('Specters', 'specter'), false);
    assert.equal(matches('SpecterX', 'specter'), false);
  });

  test('still rejects unrelated brands', () => {
    assert.equal(matches('Cybool', 'cyble'), false);
    assert.equal(matches('Celestya', 'celestia'), false);
    assert.equal(matches('SQRR', 'squareup'), false);
    assert.equal(matches('Entro Security', 'palantir'), false);
  });

  test('two different companies can no longer claim one slug', () => {
    // The property that actually matters, stated directly.
    const claimants = ['RainCheck AI', 'Rainguard AI', 'Rein Security'].filter((c) => matches(c, 'rain'));
    assert.deepEqual(claimants, [], 'no company should win a bare "rain" slug by prefix');
  });
});

describe('refusing job boards as a careers page', () => {
  test('rejects aggregators and social profiles', () => {
    for (const u of [
      'https://www.linkedin.com/jobs/cyble-jobs-worldwide',
      'https://www.linkedin.com/company/sqrr',
      'https://www.glassdoor.com/Jobs/example.htm',
      'https://www.indeed.com/cmp/example/jobs',
      'https://www.dice.com/company/example',
      'https://wellfound.com/company/indeni',
      'https://allremote.jobs/company/anonybit',
      'https://www.secretjobs.ai/companies/cognni',
      'https://jobs.techaviv.com/companies/cyabra',
    ]) {
      assert.equal(isJobBoardHost(u), true, u);
    }
  });

  test('rejects venture-portfolio job boards, which list other companies', () => {
    for (const u of [
      'https://jobs.insightpartners.com/companies/mate-security-2',
      'https://jobs.initialized.com/jobs/pax',
      'https://portfoliojobs.decibel.vc/jobs/push-security',
      'https://jobs.jvpvc.com/jobs/nslcomm',
      'https://jobs.f2vc.com/jobs/breeze-security',
    ]) {
      assert.equal(isJobBoardHost(u), true, u);
    }
  });

  test('leaves real ATS boards and company sites alone', () => {
    for (const u of [
      'https://jobs.ashbyhq.com/orca',
      'https://jobs.lever.co/biocatch',
      'https://boards.greenhouse.io/example',
      'https://jobs.smartrecruiters.com/FirstPointMobileGuard',
      'https://www.comeet.com/jobs/example',
      'https://bis.wd3.myworkdayjobs.com/External',
      'https://www.wiz.io/careers',
      'https://cydome.zohorecruit.com/jobs/Careers',
    ]) {
      assert.equal(isJobBoardHost(u), false, u);
    }
  });
});
