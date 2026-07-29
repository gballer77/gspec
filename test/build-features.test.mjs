// Features-stage tests for `gspec build`: the stage decomposes the brief with
// the feature-planner and fans out one feature-writer per planned feature —
// the headless counterpart of /gspec-feature's scope assessment (design §8:
// features runs feature-writer ×N). A planner that returns a single feature
// writes one PRD; a planner that returns nothing usable falls back to a single
// monolithic feature-writer call (never zero PRDs). Offline like
// build-research.test.mjs: a fake `pi` binary plays every stage agent, and each
// feature-writer invocation appends to writer-calls.log so the fan-out is
// counted. The build pauses at the spec-review gate (exit 0) after planning.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, exists, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');

const AGENTS = STAGE_AGENTS;

// The planner returns a two-feature breakdown; each feature-writer fan-out
// appends a marker line so tests can count the fan-out; every validator passes.
// Order matters — the planner prompt uniquely contains "feature-plan", the
// decomposed writer prompt uniquely contains "decomposed set", and the fallback
// writer prompt uniquely contains "feature PRD for this idea".
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *feature-plan*) printf '\`\`\`json\\n{"features":[{"slug":"user-auth","title":"User auth","brief":"sign in","priority":"P0","dependencies":[]},{"slug":"dashboard","title":"Dashboard","brief":"see stuff","priority":"P1","dependencies":["user-auth"]}]}\\n\`\`\`\\n' ;;
  *"decomposed set"*) deliver "$*"; echo writer >> writer-calls.log; printf 'wrote one PRD\\n' ;;
  *"feature PRD for this idea"*) deliver "$*"; echo fallback >> writer-calls.log; printf 'wrote the PRD\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// A planner that identifies exactly one feature — the single-feature idea.
const FAKE_PI_SINGLE = FAKE_PI.replace(
  /\{"features".*?\}\]\}/,
  '{"features":[{"slug":"only-thing","title":"Only thing","brief":"just this","priority":"P0"}]}'
);

// A planner that returns nothing usable — the driver must fall back to a single
// feature-writer call rather than emitting zero PRDs.
const FAKE_PI_NOPLAN = FAKE_PI.replace('*feature-plan*)', '*feature-plan*) printf \'no plan here\\n\' ;;\n  *__never__*)');

// A planner that proposes more features than the cap — MAX_FEATURES (24) is the
// backstop, and the extras are dropped with a logged warning, not silently.
const manyFeatures = Array.from({ length: 26 }, (_, i) =>
  `{"slug":"feat-${i + 1}","title":"F${i + 1}","brief":"b","priority":"P1"}`).join(',');
const FAKE_PI_MANY = FAKE_PI.replace(/\{"features".*?\}\]\}/, `{"features":[${manyFeatures}]}`);

async function seedBuildProject(dir, fakePi = FAKE_PI) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo app with auth and a dashboard.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), fakePi);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

async function manifestOf(dir) {
  return JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
}

async function writerCalls(dir) {
  if (!(await exists(join(dir, 'writer-calls.log')))) return [];
  return (await readFile(join(dir, 'writer-calls.log'), 'utf-8')).trim().split('\n').filter(Boolean);
}

test('the features stage decomposes the brief and fans out one writer per feature', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output); // pauses at the spec-review gate
  assert.match(r.output, /decomposed into 2 feature\(s\): user-auth, dashboard/);
  assert.match(r.output, /Paused for spec review/);

  assert.equal((await manifestOf(dir)).stages.features.status, 'done');
  const calls = await writerCalls(dir);
  assert.equal(calls.length, 2, 'exactly one feature-writer run per planned feature');
  assert.ok(calls.every((c) => c === 'writer'), 'the decomposed writer path ran, not the fallback');
});

test('a single-feature plan writes exactly one PRD', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, FAKE_PI_SINGLE);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output); // exit 2 = paused at the spec-review gate, not complete
  assert.match(r.output, /decomposed into 1 feature\(s\): only-thing/);
  assert.equal((await writerCalls(dir)).length, 1);
});

test('an unusable plan falls back to a single monolithic writer call (never zero PRDs)', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, FAKE_PI_NOPLAN);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output); // exit 2 = paused at the spec-review gate, not complete
  assert.doesNotMatch(r.output, /decomposed into/);
  const calls = await writerCalls(dir);
  assert.equal(calls.length, 1, 'the fallback single writer ran');
  assert.equal(calls[0], 'fallback');
  assert.equal((await manifestOf(dir)).stages.features.status, 'done');
});

test('a plan exceeding the cap is trimmed to MAX_FEATURES writers, drop logged', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, FAKE_PI_MANY);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output); // exit 2 = paused at the spec-review gate, not complete
  assert.match(r.output, /26 features planned.*writing the first 24/);
  assert.match(r.output, /dropping: feat-25, feat-26/);
  assert.equal((await writerCalls(dir)).length, 24, 'exactly MAX_FEATURES writers ran');
});

test('--dry-run shows the decompose-and-fan-out plan without spawning writers', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  const r = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /would decompose the brief \(feature-planner\), then fan out one feature-writer per planned feature/);
  assert.ok(!(await exists(join(dir, 'writer-calls.log'))), 'no writer may have been spawned');
});
