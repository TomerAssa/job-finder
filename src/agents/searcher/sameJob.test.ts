import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSameJob, postingId } from './sameJob.js';

const gh = (id: string) => `https://job-boards.greenhouse.io/armissecurity/jobs/${id}`;

describe('same job detection', () => {
  test('different titles are never the same job', () => {
    assert.equal(isSameJob({ title: 'Product Manager', url: null, source: 'llm' },
                           { title: 'Senior Product Manager', url: null, source: 'llm' }), false);
  });

  test('title matching ignores case and spacing', () => {
    assert.equal(isSameJob({ title: 'Product  Manager', url: null, source: 'llm' },
                           { title: 'product manager', url: null, source: 'llm' }), true);
  });

  test('a sighting without a URL is the same posting seen weakly', () => {
    // Dream Security: the same role extracted twice, once without a link.
    assert.equal(isSameJob({ title: 'Senior Product Manager', url: 'https://x.com/jobs/9', source: 'llm' },
                           { title: 'Senior Product Manager', url: null, source: 'llm' }), true);
  });

  test('two extractors reading one careers page agree on one job', () => {
    // Axonius: found by both LinkedIn and JSON-LD, with different URLs.
    assert.equal(isSameJob({ title: 'Principal Product Manager', url: 'https://linkedin.com/jobs/1', source: 'linkedin' },
                           { title: 'Principal Product Manager', url: 'https://axonius.com/careers/2', source: 'jsonld' }), true);
  });

  test('the same board id under different slugs is one job', () => {
    // GK8 publishes one Comeet posting under two account slugs.
    assert.equal(isSameJob(
      { title: 'Senior Product Manager', url: 'https://www.comeet.com/jobs/gk8bygalaxy/E8.000/senior-product-manager/17.764', source: 'comeet' },
      { title: 'Senior Product Manager', url: 'https://www.comeet.com/jobs/galaxy/E8.000/senior-product-manager/17.764', source: 'comeet' },
    ), true);
  });

  test('different board ids from one board are two real openings', () => {
    // Armis genuinely advertises two roles under one title.
    assert.equal(isSameJob({ title: 'Sr Staff Inbound Product Manager', url: gh('6105740004'), source: 'greenhouse' },
                           { title: 'Sr Staff Inbound Product Manager', url: gh('6105741004'), source: 'greenhouse' }), false);
  });

  test('posting ids come from the numeric tail, not a title slug', () => {
    assert.equal(postingId('https://x.com/jobs/senior-product-manager'), null);
    assert.equal(postingId('https://x.com/jobs/17.764'), '17.764');
    assert.equal(postingId('https://x.com/jobs/6105740004/?utm=x'), '6105740004');
    assert.equal(postingId(null), null);
  });
});
