// `--notify <cmd>` runs on every pause, failure, crash and completion. 691
// minutes of a measured build were spent waiting for a human who had not
// been told a gate had opened.
//
// Drives lib/notify.js with real shell commands (cheap, no engine); the
// wiring is checked against the driver's source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notify, notifySync, notifyEnv, NOTIFY_STATES } from '../lib/notify.js';
import { REPO_ROOT } from './helpers.mjs';

const payload = { state: 'paused_review', stage: 'Spec review', reason: 'awaiting spec review', idea: 'a thing', cwd: process.cwd() };

test('the payload becomes GSPEC_* environment variables', () => {
  assert.deepEqual(notifyEnv(payload), {
    GSPEC_STATE: 'paused_review', GSPEC_STAGE: 'Spec review', GSPEC_REASON: 'awaiting spec review', GSPEC_IDEA: 'a thing', GSPEC_CWD: process.cwd(),
  });
  assert.equal(notifyEnv({}).GSPEC_STATE, '', 'a missing field is an empty string, never "undefined"');
});

test('the command runs with the payload in its environment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-notify-'));
  try {
    const out = join(dir, 'seen');
    const r = await notify(`printf '%s|%s|%s' "$GSPEC_STATE" "$GSPEC_STAGE" "$GSPEC_REASON" > "${out}"`, { ...payload, cwd: dir });
    assert.deepEqual(r, { ran: true, code: 0, timedOut: false });
    assert.equal(await readFile(out, 'utf-8'), 'paused_review|Spec review|awaiting spec review');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failing command does not throw, and reports its code', async () => {
  const r = await notify('exit 3', payload);
  assert.equal(r.ran, true);
  assert.equal(r.code, 3);
  const missing = await notify('definitely-not-a-command-xyz 2>/dev/null', payload);
  assert.equal(missing.ran, true);
  assert.notEqual(missing.code, 0);
});

test('a command that hangs is killed at the timeout', async () => {
  const r = await notify('sleep 5', payload, { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
});

test('no command is a no-op', async () => {
  assert.deepEqual(await notify('', payload), { ran: false });
  assert.deepEqual(await notify(undefined, payload), { ran: false });
  assert.deepEqual(notifySync('   ', payload), { ran: false });
});

test('the sync variant (crash path) has the same contract', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-notify-'));
  try {
    const out = join(dir, 'seen');
    const r = notifySync(`printf '%s' "$GSPEC_STATE" > "${out}"`, { ...payload, state: 'crashed', cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(await readFile(out, 'utf-8'), 'crashed');
    assert.equal(notifySync('exit 2', payload).code, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the driver notifies on every pause, failure, crash and completion — and not on running', async () => {
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  for (const state of ['paused_review', 'failed', 'complete']) {
    assert.match(src, new RegExp(`writeStatus\\(cwd, '${state}', \\{[^\\n]*notify: notifyCmd`), `${state} carries the command`);
  }
  assert.match(src, /writeStatusSync\(cwd, 'crashed', \{[^\n]*notify: notifyCmd/, 'the crash path too');
  assert.doesNotMatch(src, /writeStatus\(cwd, 'running', \{[^\n]*notify:/, 'running is not a notification');
  assert.match(src, /limit: looksRateLimited\(result\.detail \|\| result\.reason \|\| ''\) \}\);/, 'a usage-limit failure is marked so the state reads paused_limit');
  assert.ok(NOTIFY_STATES.has('paused_limit'));
  assert.match(src, /projectConfig\.notify \?\? globalConfig\.notify/, 'sourced from the config when the flag is absent');
});
