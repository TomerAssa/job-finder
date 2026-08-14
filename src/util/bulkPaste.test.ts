import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkPaste } from './bulkPaste.js';
import { normalizeLinkedinUrl, nameFromSlug } from './linkedin.js';
import { normalizePhone } from './phone.js';
import { parseProfileTitle } from '../agents/people/enrichProfile.js';

describe('LinkedIn URL canonicalization', () => {
  test('the same profile in every shape it arrives in', () => {
    const want = 'https://www.linkedin.com/in/dana-cohen-1a2b3';
    for (const raw of [
      'https://www.linkedin.com/in/dana-cohen-1a2b3',
      'https://www.linkedin.com/in/dana-cohen-1a2b3/',
      'http://linkedin.com/in/dana-cohen-1a2b3',
      'https://il.linkedin.com/in/dana-cohen-1a2b3?originalSubdomain=il',
      'https://www.linkedin.com/pub/dana-cohen-1a2b3',
      '  https://www.linkedin.com/in/Dana-Cohen-1a2b3#about  ',
    ]) {
      assert.equal(normalizeLinkedinUrl(raw), want, raw);
    }
  });

  test('non-profile LinkedIn links are rejected', () => {
    assert.equal(normalizeLinkedinUrl('https://www.linkedin.com/company/wiz'), null);
    assert.equal(normalizeLinkedinUrl('https://www.linkedin.com/jobs/view/123'), null);
    assert.equal(normalizeLinkedinUrl('https://example.com/in/dana'), null);
  });

  test('a slug becomes a placeholder name, or nothing when it cannot', () => {
    assert.equal(nameFromSlug('https://www.linkedin.com/in/dana-cohen-1a2b3'), 'Dana Cohen');
    assert.equal(nameFromSlug('https://www.linkedin.com/in/9f3a21'), null);
  });
});

describe('phone canonicalization', () => {
  test('Israeli numbers in every shape become one E.164 string', () => {
    for (const raw of ['054-123-4567', '+972 54 123 4567', '00972541234567', '0541234567']) {
      assert.equal(normalizePhone(raw), '+972541234567', raw);
    }
  });

  test('things that are not phone numbers', () => {
    assert.equal(normalizePhone('https://linkedin.com/in/dana'), null);
    assert.equal(normalizePhone('Dana Cohen'), null);
    assert.equal(normalizePhone('12345'), null, 'too short to be a number');
    assert.equal(normalizePhone(''), null);
  });

  test('an explicit country code is respected', () => {
    assert.equal(normalizePhone('+1 415 555 0134'), '+14155550134');
  });
});

describe('bulk paste', () => {
  test('classifies a mixed paste and reports what it could not read', () => {
    const r = parseBulkPaste(`
https://www.linkedin.com/in/dana-cohen-1a2b3
054-123-4567
Yoni Levi, https://www.linkedin.com/in/yoni-levi-9
https://www.linkedin.com/company/wiz
just some words
    `);

    assert.equal(r.entries.length, 3);
    assert.equal(r.entries.filter((e) => e.kind === 'linkedin').length, 2);
    assert.equal(r.entries.filter((e) => e.kind === 'phone').length, 1);

    // A URL buried in a "Name, URL" line is still found.
    assert.equal(r.entries[2].linkedinUrl, 'https://www.linkedin.com/in/yoni-levi-9');

    assert.equal(r.rejected.length, 2);
    assert.match(r.rejected[0].reason, /not to a personal profile/);
    assert.equal(r.rejected[0].line, 5, 'rejections carry the line number');
  });

  test('duplicates inside one paste collapse', () => {
    const r = parseBulkPaste([
      'https://www.linkedin.com/in/dana-cohen-1a2b3',
      'https://il.linkedin.com/in/dana-cohen-1a2b3/?trk=x',
      '054-123-4567',
      '+972541234567',
    ].join('\n'));

    assert.equal(r.entries.length, 2);
    assert.equal(r.duplicatesInPaste, 2);
  });

  test('a profile URL containing digits is never read as a phone number', () => {
    const r = parseBulkPaste('https://www.linkedin.com/in/user-0541234567');
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].kind, 'linkedin');
  });

  test('phone-only rows get a placeholder that is obviously a placeholder', () => {
    const r = parseBulkPaste('054-123-4567');
    assert.equal(r.entries[0].placeholderName, 'Unknown (+972541234567)');
  });
});

describe('profile title parsing', () => {
  test('name, role and company come out of a LinkedIn page title', () => {
    assert.deepEqual(parseProfileTitle('Dana Cohen - Group Product Manager - Wiz | LinkedIn'), {
      name: 'Dana Cohen', role: 'Group Product Manager', company: 'Wiz',
    });
  });

  test('"Role at Company" collapses correctly', () => {
    assert.deepEqual(parseProfileTitle('Yoni Levi - Product Manager at Snyk | LinkedIn'), {
      name: 'Yoni Levi', role: 'Product Manager', company: 'Snyk',
    });
  });

  test('a bare name still yields a name', () => {
    assert.deepEqual(parseProfileTitle('Dana Cohen | LinkedIn'), {
      name: 'Dana Cohen', role: null, company: null,
    });
  });

  test('Hebrew titles survive', () => {
    const r = parseProfileTitle('יובל מונד - מנהל מוצר - Wiz | LinkedIn');
    assert.equal(r.name, 'יובל מונד');
    assert.equal(r.company, 'Wiz');
  });
});
