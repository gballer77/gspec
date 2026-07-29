// Terminal-state tests for `gspec build`: the regression suite for "the build
// died and nothing told me". A run can end four ways and each must be
// distinguishable WITHOUT reading the log — by exit code (0 complete, 1 failed,
// 2 paused for review, 3 crashed), by .gspec/build/status.json, and by
// `gspec build --status`, which reports the state and exits with its code.
//
// Offline like the other build tests: a fake `pi` binary first on PATH plays
// every stage agent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, exists, seedInstall, isolatedHome, REPO_ROOT, FAKE_ENGINE_SH } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');
const STATUS_JSON = join('.gspec', 'build', 'status.json');
const LAST_FAILURE = join('.gspec', 'build', 'last-failure.md');

const AGENTS = [
  'profile-writer', 'profile-validator', 'stack-writer', 'practices-writer', 'style-writer',
  'feature-planner', 'feature-writer', 'feature-validator',
  'architecture-writer', 'architecture-validator',
  'plan-decomposer', 'plan-validator',
  'build-orchestrator', 'implementer', 'implementation-validator',
  'codebase-inspector',
];

// Everything passes; every writer delivers.
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// The architecture validator blocks, so the run pauses on a real failure.
const FAKE_PI_FAIL = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *"Validate the Architecture"*) printf 'VERDICT: FAIL\\n- [blocker] no Modules table\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// The profile writer never returns — a stand-in for a stage that is genuinely
// still working, so the run can be signalled mid-stage.
const FAKE_PI_HANG = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *'"Product profile" stage'*) sleep 30 ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// A writer that reports success and writes nothing — what an engine does when
// it hits an auth failure, a rate limit, or a usage cap in headless mode.
const FAKE_PI_EMPTY_WRITER = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *'"Product profile" stage'*) printf 'API Error: credit balance too low\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// A project ready to run headlessly. `seedFoundations` pre-seeds the foundation
// specs (skip-if-present) so a run reaches the later stages cheaply; leave it
// off when the test is about the profile stage itself.
async function seedProject(dir, fakePi = FAKE_PI, { seedFoundations = true } = {}) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  if (seedFoundations) {
    for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
      await writeFile(join(dir, 'gspec', f), 'seeded\n');
    }
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), fakePi);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

async function statusOf(dir) {
  return JSON.parse(await readFile(join(dir, STATUS_JSON), 'utf-8'));
}

// ---------------------------------------------------------------------------
// The exit-code contract
// ---------------------------------------------------------------------------

test('a completed run exits 0 and records state "complete"', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);

  const status = await statusOf(dir);
  assert.equal(status.state, 'complete');
  assert.equal(status.exitCode, 0);
  assert.equal(status.engine, 'pi');
});

test('the spec-review pause exits 2 — a watcher cannot read it as success', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);
  assert.match(r.output, /Paused for spec review/);
  assert.match(r.output, /exit 2 — "paused for review", not "complete"/i);

  const status = await statusOf(dir);
  assert.equal(status.state, 'paused_review');
  assert.equal(status.exitCode, 2);
  assert.equal(status.stage, 'review');
});

test('a failed gate exits 1 and records the stage and reason', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI_FAIL);

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(r.code, 1, r.output);

  const status = await statusOf(dir);
  assert.equal(status.state, 'failed');
  assert.equal(status.exitCode, 1);
  assert.equal(status.stage, 'architecture');
  assert.match(status.reason, /QA gate did not pass/);
});

// ---------------------------------------------------------------------------
// `gspec build --status` — the one deterministic question a watcher can ask
// ---------------------------------------------------------------------------

test('--status reports a completed run and exits 0', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);
  await runCli(['build', '--no-review', 'an idea'], dir, env);

  const s = await runCli(['build', '--status'], dir, env);
  assert.equal(s.code, 0, s.output);
  assert.match(s.output, /gspec build — complete/);
});

test('--status reports a paused run and exits 2, pointing at the resume', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);
  await runCli(['build', 'an idea'], dir, env);

  const s = await runCli(['build', '--status'], dir, env);
  assert.equal(s.code, 2, s.output);
  assert.match(s.output, /paused for spec review/);
  assert.match(s.output, /gspec build --resume/);
});

test('--status reports a failed run and exits 1, pointing at the verdict', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI_FAIL);
  await runCli(['build', '--no-review', 'an idea'], dir, env);

  const s = await runCli(['build', '--status'], dir, env);
  assert.equal(s.code, 1, s.output);
  assert.match(s.output, /gspec build — failed at "Architecture"/);
  assert.match(s.output, /last-failure\.md/);
});

test('--status in a project with no run says so and exits non-zero', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));

  const s = await runCli(['build', '--status'], dir);
  assert.notEqual(s.code, 0);
  assert.match(s.output, /No gspec build run here/);
});

test('--status falls back to the manifest for a run started before status.json existed', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI_FAIL);
  await runCli(['build', '--no-review', 'an idea'], dir, env);
  // A pre-2.7.0 run left a manifest and no status file.
  const { rm } = await import('node:fs/promises');
  await rm(join(dir, STATUS_JSON));

  const s = await runCli(['build', '--status'], dir, env);
  assert.equal(s.code, 1, s.output);
  assert.match(s.output, /failed at "Architecture"/);
});

// ---------------------------------------------------------------------------
// Crash safety — the failure mode that used to leave no trace at all
// ---------------------------------------------------------------------------

test('a signalled run records "crashed" and exits 3 instead of vanishing', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI_HANG, { seedFoundations: false });
  const HOME = await isolatedHome();

  const child = spawn(process.execPath, [join(REPO_ROOT, 'bin', 'gspec.js'), 'build', '--no-review', 'an idea'], {
    cwd: dir,
    env: { ...process.env, ...env, HOME, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  // Wait until the run is genuinely inside the profile stage. 'exit', not
  // 'close': the fake's own sleeping child still holds the inherited stderr, so
  // waiting for the pipes to close would wait out the sleep.
  const exited = new Promise((resolve) => child.on('exit', resolve));
  for (let i = 0; i < 100; i++) {
    if (await exists(join(dir, STATUS_JSON))) {
      const s = await statusOf(dir);
      if (s.state === 'running' && s.stage === 'profile') break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill('SIGTERM');
  const code = await exited;

  assert.equal(code, 3, output);
  assert.match(output, /interrupted \(SIGTERM\)/);
  assert.match(output, /did NOT finish/);

  const status = await statusOf(dir);
  assert.equal(status.state, 'crashed');
  assert.equal(status.exitCode, 3);
  assert.equal(status.stage, 'profile');
  // The why survives the terminal, as it does for every other failure.
  assert.ok(await exists(join(dir, LAST_FAILURE)), 'a crash writes last-failure.md');
  assert.match(await readFile(join(dir, LAST_FAILURE), 'utf-8'), /SIGTERM/);
});

test('--status reports a run whose process is gone as crashed, and records it', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);
  await runCli(['build', 'an idea'], dir, env); // leaves a real manifest

  // A run killed with SIGKILL: nothing got to update the state, so it still
  // claims to be running — under a pid that no longer exists.
  const status = await statusOf(dir);
  await writeFile(join(dir, STATUS_JSON), JSON.stringify({
    ...status, state: 'running', exitCode: null, stage: 'architecture', stageTitle: 'Architecture', pid: 2147480000,
  }, null, 2) + '\n');

  const s = await runCli(['build', '--status'], dir, env);
  assert.equal(s.code, 3, s.output);
  assert.match(s.output, /crashed at "Architecture"/);
  assert.match(s.output, /died without reporting/);
  // Recorded, so the next reader agrees with this one.
  assert.equal((await statusOf(dir)).state, 'crashed');
});

// ---------------------------------------------------------------------------
// A writer that "succeeds" without writing anything
// ---------------------------------------------------------------------------

test('a writer that exits 0 with no deliverable fails the stage with the real reason', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI_EMPTY_WRITER, { seedFoundations: false });

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(r.code, 1, r.output);
  // Retried once before giving up…
  assert.match(r.output, /exited 0 but produced no deliverable — retrying once/);
  // …and the failure names the WRITER, not the validator that would otherwise
  // have been blamed for a document nobody wrote.
  assert.match(r.output, /profile-writer exited 0 twice without producing its deliverable/);
  assert.equal((await statusOf(dir)).stage, 'profile');
  assert.ok(!(await exists(join(dir, 'gspec', 'profile.md'))), 'nothing was written');
  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(manifest.stages.profile.status, 'failed');
});
