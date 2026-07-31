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

// An orchestrator that returns a real two-wave build plan, so the ORCHESTRATED
// implement path runs. Every other e2e fixture leaves the orchestrator babbling
// and the driver falls through to per-feature scopes — meaning the ordered path,
// in the most expensive stage in the system, had no end-to-end coverage at all.
const WAVE_PLAN = JSON.stringify({
  waves: [
    [{ label: 'user-auth', instruction: 'Build auth.', plan: ['gspec/features/user-auth/tasks.md'] }],
    [{ label: 'dashboard', instruction: 'Build the dashboard.', plan: ['gspec/features/dashboard/tasks.md'] }],
  ],
});
const FAKE_PI_WAVES = FAKE_PI.replace(
  '  *Validate*)',
  `  *"wave build-plan"*) printf '\`\`\`json\\n%s\\n\`\`\`\\n' '${WAVE_PLAN}' ;;\n  *Validate*)`,
);

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

// A fan-out used to print its stage header and then nothing until the whole
// stage finished — half an hour of silence on a real run, which is exactly what
// a STALLED stage looks like too. The log could not distinguish them, so the
// only way to tell a healthy run from a dead one was to inspect the driver's
// child processes by hand.
test('a multi-feature fan-out reports how far along it is, in both phases', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);

  // Write phase: one counted line per feature, denominator = the fan-out width.
  assert.match(r.output, /\[1\/2\] .*prd\.md/, 'the first written PRD is counted');
  assert.match(r.output, /\[2\/2\] .*prd\.md/, 'and so is the last, so "done" is visible');

  // Validate phase — the serial half, which reported nothing at all before.
  assert.match(r.output, /\[1\/2\] .*prd\.md — checking…/);
  assert.match(r.output, /\[2\/2\] .*prd\.md — checking…/);
});

test('a single feature is not dressed up as a fan-out', async (t) => {
  // "[1/1]" is noise: there is no progress to report through a stage that does
  // one thing, and a counter implies siblings that do not exist.
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, FAKE_PI_SINGLE);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);
  assert.doesNotMatch(r.output, /\[1\/1\]/);
});

// Implementation is the longest and most expensive stage — ~92% of a build's
// input, ~10 hours on a measured run — and it emitted nothing between its
// "orchestrated: N wave(s)" line and its gates.
test('the orchestrated implement path announces each wave and counts each scope', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, FAKE_PI_WAVES);

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.match(r.output, /orchestrated: 2 wave\(s\), 2 scope\(s\)/, 'sanity: the wave plan really parsed');

  // The wave is announced with what is in flight, so a stall names it.
  assert.match(r.output, /wave 1\/2 — building one scope: user-auth/);
  assert.match(r.output, /wave 2\/2 — building one scope: dashboard/);
  // And each scope is counted as it lands.
  assert.match(r.output, /\[1\/2\] user-auth — built/);
  assert.match(r.output, /\[2\/2\] dashboard — built/);
});

test('the per-feature fallback implement path counts its scopes too', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir); // orchestrator babbles → fallback

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.match(r.output, /no wave plan — falling back to 2 per-feature scopes/);
  // Serial here, so each is announced BEFORE it runs.
  assert.match(r.output, /\[1\/2\] (user-auth|dashboard) — building…/);
  assert.match(r.output, /\[2\/2\] (user-auth|dashboard) — building…/);
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
