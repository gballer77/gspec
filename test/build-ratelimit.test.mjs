// Capacity exhaustion is not a transient fault.
//
// Both surface as a non-zero exit, but they want opposite responses: a dropped
// connection is worth retrying now; a session limit resets on a CLOCK, so a
// retry only spends another run on the same wall — which a measured run did,
// showing four implementer runs where two would have done. And the pause should
// say WAIT, not "something is broken".

import test from 'node:test';
import assert from 'node:assert/strict';
import { looksRateLimited } from '../lib/build.js';

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
