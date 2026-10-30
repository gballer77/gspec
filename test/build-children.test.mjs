// No subprocess outlives the build, and no engine run can hang it forever.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { track, killAll, liveCount } from '../lib/children.js';
import { spawnCapture, engineTimeoutMs, ENGINE_TIMEOUT_MS_DEFAULT, ENGINE_TIMEOUT_EXIT } from '../lib/engines.js';

const sleeper = (opts = {}) => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', ...opts });

test('killAll stops every tracked child, including a detached process group', async () => {
  const plain = track(sleeper());
  const grouped = track(sleeper({ detached: true }), { group: true });
  assert.equal(liveCount(), 2);
  assert.equal(killAll('SIGTERM'), 2);
  await Promise.all([once(plain, 'exit'), once(grouped, 'exit')]);
  assert.equal(liveCount(), 0, 'exited children forget themselves');
});

test('an engine run past its time limit is stopped and reported as a timeout, not left hanging', async () => {
  const started = Date.now();
  const r = await spawnCapture(process.execPath, ['-e', 'process.stdout.write("partial"); setInterval(() => {}, 1000)'], { cwd: process.cwd(), timeoutMs: 300, killGraceMs: 200 });
  assert.equal(r.code, ENGINE_TIMEOUT_EXIT);
  assert.equal(r.timedOut, true);
  assert.match(r.text, /^partial/);
  assert.match(r.text, /GSPEC_ENGINE_TIMEOUT_MIN/);
  assert.ok(Date.now() - started < 5_000);
  assert.equal(liveCount(), 0);
});

test('a run that finishes in time is untouched', async () => {
  const r = await spawnCapture(process.execPath, ['-e', 'process.stdout.write("VERDICT: PASS")'], { cwd: process.cwd(), timeoutMs: 30_000 });
  assert.deepEqual(r, { code: 0, text: 'VERDICT: PASS' });
});

test('the limit defaults to four hours and is set in minutes by GSPEC_ENGINE_TIMEOUT_MIN', () => {
  assert.equal(engineTimeoutMs({}), ENGINE_TIMEOUT_MS_DEFAULT);
  assert.equal(engineTimeoutMs({ GSPEC_ENGINE_TIMEOUT_MIN: '90' }), 90 * 60_000);
  assert.equal(engineTimeoutMs({ GSPEC_ENGINE_TIMEOUT_MIN: 'soon' }), ENGINE_TIMEOUT_MS_DEFAULT);
  assert.equal(engineTimeoutMs({ GSPEC_ENGINE_TIMEOUT_MIN: '-5' }), ENGINE_TIMEOUT_MS_DEFAULT);
});

test('the crash handler stops children before it stamps the run crashed', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../lib/build.js', import.meta.url), 'utf-8');
  const fatal = src.slice(src.indexOf('const fatal = (what, detail) =>'));
  assert.ok(fatal.indexOf("killAll('SIGTERM')") > 0 && fatal.indexOf("killAll('SIGTERM')") < fatal.indexOf("writeStatusSync(cwd, 'crashed'"));
  assert.match(src, /track\(spawn\('bash', \['verify\.sh'\][^\n]*\{ group: true \}\)/);
});
