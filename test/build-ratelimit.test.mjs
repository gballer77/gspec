// Capacity exhaustion is not a transient fault.
//
// Both surface as a non-zero exit, but they want opposite responses: a dropped
// connection is worth retrying now; a session limit resets on a CLOCK, so a
// retry only spends another run on the same wall — which a measured run did,
// showing four implementer runs where two would have done. And the pause should
// say WAIT, not "something is broken".

import test from 'node:test';
import assert from 'node:assert/strict';
import { looksRateLimited, transientBackoffMs, MAX_TRANSIENT_RETRIES } from '../lib/build.js';

test('capacity messages the engines actually emit are recognized', () => {
  for (const t of [
    "You've hit your session limit · resets 1:30pm (America/Chicago)",  // observed verbatim
    'rate limit exceeded',
    'usage limit reached',
    'HTTP 429 Too Many Requests',
    'quota exhausted for this org',
  ]) assert.equal(looksRateLimited(t), true, `should be a limit: ${t}`);
});

test('an ordinary fault is NOT a limit — it must still be retried', () => {
  for (const t of [
    'API Error: Connection closed mid-response. The response above may be incomplete.',
    'ENOENT: no such file or directory',
    'the agent returned nothing',
    '',
    null,
  ]) assert.equal(looksRateLimited(t), false, `should not be a limit: ${t}`);
});

test('each transient retry waits longer than the last', () => {
  // A single fixed 30s pause was not enough: a measured run lost the build to
  // "Connection closed mid-response" on the first attempt AND on its retry 30s
  // later. The outage was wider than the one pause, so the waits escalate.
  const waits = Array.from({ length: MAX_TRANSIENT_RETRIES }, (_, i) => transientBackoffMs(i));
  assert.equal(waits.length, 3);
  assert.deepEqual(waits, [30_000, 120_000, 270_000]);
  for (let i = 1; i < waits.length; i++) assert.ok(waits[i] > waits[i - 1], 'each wait must grow');
});

test('the retry allowance is bounded — a broken prompt must still surface', () => {
  // Retrying forever turns a genuinely broken prompt into a run that looks hung,
  // which is a worse failure than the one the retries fix.
  assert.ok(MAX_TRANSIENT_RETRIES >= 2 && MAX_TRANSIENT_RETRIES <= 5, 'bounded and small');
});
