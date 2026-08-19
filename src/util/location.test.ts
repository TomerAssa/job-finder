import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { countryKey, matchesLocation } from './location.js';

const role = (location: string | null, isIsrael: number | null = null) => ({ location, isIsrael });

describe('location matching', () => {
  test('an empty request matches everything', () => {
    assert.equal(matchesLocation(role('London'), ''), true);
    assert.equal(matchesLocation(role(null), null), true);
  });

  test('asking for Israel catches the many ways a listing writes it', () => {
    // Every one of these appears verbatim in the scraped data.
    for (const loc of [
      'Tel Aviv', 'tel aviv', 'Tel Aviv-Yafo', 'Tel Aviv-Yafo, Tel Aviv District, Israel',
      'Tel Aviv District, Israel', 'Israel', 'Herzliya', 'תל אביב',
    ]) {
      assert.equal(matchesLocation(role(loc), 'Israel'), true, loc);
    }
  });

  test('and excludes places that are not', () => {
    for (const loc of ['london', 'New York, NY', 'usa', 'Remote - EMEA', 'Berlin']) {
      assert.equal(matchesLocation(role(loc), 'Israel'), false, loc);
    }
  });

  test('the enriched flag beats the location line', () => {
    // A listing whose text says nothing useful, but which enrichment read in full.
    assert.equal(matchesLocation(role('Remote', 1), 'Israel'), true);
    // ...and one the flag says is elsewhere, whatever the city line hints.
    assert.equal(matchesLocation(role('Tel Aviv office, hiring in NYC', 0), 'Israel'), false);
  });

  test('an unenriched role with no location does not silently pass', () => {
    assert.equal(matchesLocation(role(null, null), 'Israel'), false);
  });

  test('a city request is a plain text match', () => {
    assert.equal(matchesLocation(role('Tel Aviv-Yafo'), 'tel aviv'), true);
    assert.equal(matchesLocation(role('Herzliya'), 'tel aviv'), false);
    // A city request must not pull in the whole country.
    assert.equal(matchesLocation(role('Haifa', 1), 'tel aviv'), false);
  });

  test('country detection', () => {
    assert.equal(countryKey('Israel'), 'israel');
    assert.equal(countryKey('ISRAEL '), 'israel');
    assert.equal(countryKey('ישראל'), 'israel');
    assert.equal(countryKey('Tel Aviv'), null, 'a city is not a country');
  });
});
