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
import { join } from 'node:path';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

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

// A long build is routinely stopped by a usage limit and continued hours later.
// Nothing kept a structured trace of that: last-failure.md is overwritten by
// the next failure and REMOVED when the build completes, and a stage that
// eventually passes shows only `attempts: 2` with no reason. A finished run
// could not say whether it had been interrupted, or for how long — a measured
// run lost nine hours of wall clock and left no record of it.
test('a stop and its resume are recorded in the run manifest', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  // Fails the stack validator with a limit on the FIRST process, passes on the
  // second — the shape of a real stop-and-resume.
  await writeFile(join(bin, 'pi'), `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *Validate*)
    if [ -f "$PWD/.limited-once" ]; then printf 'VERDICT: PASS\\n';
    else : > "$PWD/.limited-once"; printf "You've hit your session limit · resets 12:30am\\n"; fi ;;
  *) fake_default "$*" ;;
esac
`);
  await chmod(join(bin, 'pi'), 0o755);
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Product: a thing\nscope: small\n');
  const env = { PATH: `${bin}:${process.env.PATH}` };

  const first = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(first.code, 1, first.output);

  const stopped = JSON.parse(await readFile(join(dir, '.gspec', 'build', 'run.json'), 'utf-8'));
  assert.equal(stopped.pauses?.length, 1, 'the stop must be recorded');
  assert.equal(stopped.pauses[0].limit, true, 'and classified as a usage limit, not a defect');
  assert.ok(stopped.pauses[0].at, 'with when it happened');
  assert.ok(!stopped.pauses[0].resumedAt, 'and no resume yet');

  const second = await runCli(['build', '--resume'], dir, env);
  assert.match(second.output, /Continuing a run that stopped .* on a usage limit/);

  const resumed = JSON.parse(await readFile(join(dir, '.gspec', 'build', 'run.json'), 'utf-8'));
  assert.ok(resumed.pauses[0].resumedAt, 'the resume closes the interruption');
  assert.equal(typeof resumed.pauses[0].waitedMs, 'number', 'and the wait is measurable');
  assert.match(second.output, /Interruptions/, 'the run reports what stopped it');
  assert.match(second.output, /usage limit/);
});
