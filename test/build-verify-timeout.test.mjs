// verify.sh had no timeout, and a build sat on one for about an hour.
//
// The hang was `docker info` against an unavailable daemon — a step waiting on
// something that never arrives. Worse, a stalled run looked EXACTLY like a
// healthy one from the outside: the build log is silent either way while the
// script runs, so the only way to tell them apart was watching child processes
// for new output. That signal is what this encodes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { humanMs } from '../lib/build.js';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const fn = src.match(/function runVerify\(ctx\) \{[\s\S]*?\n\}/)[0];

test('the timeout is IDLE-based, not a total cap', () => {
  // A verify.sh that provisions a database and runs integration tests takes many
  // minutes legitimately — one measured at 11. A total cap kills working runs;
  // silence is what actually distinguishes stuck from busy.
  assert.match(src, /const VERIFY_IDLE_MS/);
  assert.match(fn, /bumpIdle/, 'output must restart the clock');
  const take = fn.match(/const take = [^\n]*/)[0];
  assert.match(take, /bumpIdle\(\)/, 'every chunk of output resets the idle timer');
});

test('there is still an absolute backstop', () => {
  // An idle timer alone never fires for a script that chatters while stuck.
  assert.match(src, /const VERIFY_MAX_MS/);
  assert.match(fn, /ran longer than/);
});

test('the whole process group is killed, not just bash', () => {
  // The hang is in a grandchild (docker, pnpm); killing bash alone orphans it.
  assert.match(fn, /detached: true/);
  assert.match(fn, /process\.kill\(-child\.pid, 'SIGTERM'\)/);
  assert.match(fn, /SIGKILL/, 'and force-kill if SIGTERM is ignored');
});

test('SIGTERM comes before SIGKILL so teardown can run', () => {
  // verify.sh typically provisions a disposable container; SIGKILL first leaks it.
  assert.ok(fn.indexOf("'SIGTERM'") < fn.indexOf("'SIGKILL'"));
});

test('a timeout is reported as an environment problem, not a code failure', () => {
  // Sending the implementer to "fix" a Docker outage is the failure mode this
  // whole class of bug keeps producing.
  assert.match(fn, /environment problem, not a code failure/);
  assert.match(fn, /non-blocking/, 'and it must say what to change');
  assert.match(fn, /timedOut: true/, 'and be machine-distinguishable');
});

test('output collected before the hang is preserved', () => {
  // It names the step that stuck — the single most useful fact available.
  assert.match(fn, /output: `\$\{output\}/);
});

test('a duration never reads as "0 minutes"', () => {
  assert.equal(humanMs(10 * 60_000), '10 minutes');
  assert.equal(humanMs(60_000), '1 minute');
  assert.equal(humanMs(3_000), '3 seconds');
  assert.equal(humanMs(500), '1 seconds');
});
