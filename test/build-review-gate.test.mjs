// Spec-review gate tests for `gspec build`: the run must pause (exit 0, not a
// failure) once every spec is written and before any code is generated, so the
// user gets a second human touchpoint to review/edit gspec/ — resumable with
// --resume (the approval) and skippable with --no-review. Offline like
// build-failure.test.mjs: a fake `pi` binary plays every stage agent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');

const AGENTS = [
  'profile-writer', 'stack-writer', 'practices-writer', 'style-writer',
  'feature-writer', 'feature-validator',
  'architecture-writer', 'architecture-validator',
  'plan-decomposer', 'plan-validator',
  'build-orchestrator', 'implementer', 'implementation-validator',
  'codebase-inspector',
];

// Every validator passes; every other agent just exits 0.
const FAKE_PI = `#!/bin/sh
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *) printf 'ok\\n' ;;
esac
`;

async function seedBuildProject(dir) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

async function manifestOf(dir) {
  return JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
}

test('the build pauses for spec review before implementation — exit 0, nothing implemented', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Paused for spec review/);
  assert.match(r.output, /gspec build --resume/);
  assert.ok(!r.output.includes('Build complete'), 'a paused run must not report completion');

  const manifest = await manifestOf(dir);
  assert.equal(manifest.stages.review.status, 'paused');
  assert.equal(manifest.stages.plan.status, 'skipped'); // no PRDs in this fixture
  assert.equal(manifest.stages.implement.status, 'pending', 'implementation must not have started');
});

test('--resume from the paused gate is the approval: the run continues to completion', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const paused = await runCli(['build', 'an idea'], dir, env);
  assert.equal(paused.code, 0, paused.output);

  const resumed = await runCli(['build', '--resume'], dir, env);
  assert.equal(resumed.code, 0, resumed.output);
  assert.match(resumed.output, /Spec review — approved/);
  assert.match(resumed.output, /✓ Build complete/);

  const manifest = await manifestOf(dir);
  assert.equal(manifest.stages.review.status, 'done');
  assert.equal(manifest.stages.review.verdict, 'approved');
  assert.equal(manifest.stages.implement.status, 'done');
});

test('--no-review on a fresh run skips the gate and runs straight through', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Spec review — skipped \(--no-review\)/);
  assert.match(r.output, /✓ Build complete/);
  assert.equal((await manifestOf(dir)).stages.review.status, 'skipped');
});

test('--no-review at resume time is honored too (blow past a gate you are paused on)', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  await runCli(['build', 'an idea'], dir, env); // pauses at the gate
  const resumed = await runCli(['build', '--resume', '--no-review'], dir, env);
  assert.equal(resumed.code, 0, resumed.output);
  assert.match(resumed.output, /✓ Build complete/);
});

test('resuming a pre-gate manifest (no review entry) does not crash — it pauses for review', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  await runCli(['build', 'an idea'], dir, env); // creates a well-formed manifest, paused at review
  const manifest = await manifestOf(dir);
  delete manifest.stages.review; // simulate a manifest written before the gate existed
  await writeFile(join(dir, RUN_JSON), JSON.stringify(manifest, null, 2) + '\n');

  const resumed = await runCli(['build', '--resume'], dir, env);
  assert.equal(resumed.code, 0, resumed.output);
  assert.match(resumed.output, /Paused for spec review/);
  assert.equal((await manifestOf(dir)).stages.review.status, 'paused');
});

test('--dry-run shows the gate in the stage plan without pausing', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  const r = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Spec review — would pause here for review/);
  assert.match(r.output, /Reconcile audit/, 'the dry run must print stages past the gate');
});
