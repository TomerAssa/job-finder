/**
 * Tests for recognising an LLM that cannot serve anything.
 *
 * This exists because of run 27: Gemini returned 402 ("prepayment credits are
 * depleted") partway through a 763-company crawl, the careers resolver caught
 * and discarded it, and 239 companies — all of them the cyber block, the
 * highest-yielding segment — were written down as having no careers page and
 * backed off for 45 days without one of them having been looked at.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isLlmUnavailable, LlmUnavailableError } from './provider.js';

describe('isLlmUnavailable', () => {
  test('recognises the error that actually caused the data loss', () => {
    assert.equal(
      isLlmUnavailable(
        new Error(
          'Gemini 402: {"error":{"code":402,"message":"Your prepayment credits are depleted.",' +
            '"status":"RESOURCE_EXHAUSTED"}}',
        ),
      ),
      true,
    );
  });

  test('recognises a rejected or missing key', () => {
    assert.equal(isLlmUnavailable(new LlmUnavailableError('Gemini key not set')), true);
    assert.equal(isLlmUnavailable(new Error('Gemini 401: API key not valid')), true);
    assert.equal(isLlmUnavailable(new Error('Gemini 403: PERMISSION_DENIED')), true);
  });

  test('a transient failure is not this, so a run carries on', () => {
    // These are already retried inside the provider. Treating them as fatal
    // would abort a whole sector over one slow page.
    assert.equal(isLlmUnavailable(new Error('Gemini 503 after 6 attempts (rate limit / overloaded)')), false);
    assert.equal(isLlmUnavailable(new Error('Gemini request failed: fetch timeout')), false);
    assert.equal(isLlmUnavailable(new Error('Gemini returned no candidates: {}')), false);
    assert.equal(isLlmUnavailable(new Error('Unexpected token < in JSON')), false);
  });

  test('does not throw on a non-error', () => {
    assert.equal(isLlmUnavailable(null), false);
    assert.equal(isLlmUnavailable('402'), false);
    assert.equal(isLlmUnavailable(undefined), false);
  });
});

describe('isLlmUnavailable — the Claude Code backend', () => {
  test('a usage limit or login problem is fatal, not an empty answer', () => {
    // The stopgap backend runs on the user's Claude subscription, so it has its
    // own way of running dry. Missing these would reproduce exactly the run-27
    // failure with a different provider.
    for (const msg of [
      'Claude Code cannot serve requests: Claude usage limit reached. Your limit will reset at 3pm.',
      'Claude Code cannot serve requests: Credit balance too low',
      'Claude Code cannot serve requests: Not authenticated. Please run `claude login`.',
      'Could not run "claude": spawn claude ENOENT. Install the Claude Code CLI',
    ]) {
      assert.equal(isLlmUnavailable(new Error(msg)), true, msg);
    }
  });

  test('a timeout or a bad reply stays retryable', () => {
    assert.equal(isLlmUnavailable(new Error('claude -p timed out after 120000ms')), false);
    assert.equal(isLlmUnavailable(new Error('claude -p returned unparseable output: <html>')), false);
  });
});
