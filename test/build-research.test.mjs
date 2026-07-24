// Research-stage tests for `gspec build --research`: the competitive-research
// stage is opt-in (skipped without the flag), runs right after the profile
// (planner → one researcher per competitor → writer), skips itself when
// gspec/research.md already exists, and is pinned at run start (a --resume
// cannot add it). Offline like build-review-gate.test.mjs: a fake `pi` binary
// plays every stage agent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, exists } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');

const AGENTS = [
  'profile-writer',
  'research-planner', 'competitor-researcher', 'research-writer',
  'stack-writer', 'practices-writer', 'style-writer',
  'feature-planner', 'feature-writer', 'feature-validator',
  'architecture-writer', 'architecture-validator',
  'plan-decomposer', 'plan-validator',
  'build-orchestrator', 'implementer', 'implementation-validator',
  'codebase-inspector',
];

// Every validator passes; the research planner returns a two-competitor plan;
// each researcher fan-out appends a marker line so tests can count the fan-out.
const FAKE_PI = `#!/bin/sh
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *research-plan*) printf '\`\`\`json\\n{"focus":"core capabilities","competitors":[{"name":"Acme"},{"name":"Globex","context":"globex.example"}]}\\n\`\`\`\\n' ;;
  *"one research fan-out"*) echo teardown >> researcher-calls.log; printf 'teardown of one competitor\\n' ;;
  *) printf 'ok\\n' ;;
esac
`;

// A planner that finds nothing to research — the stage must skip, not guess.
const FAKE_PI_NO_COMPETITORS = FAKE_PI.replace(
  /\{"focus".*?\}\]\}/,
  '{"focus":"","competitors":[]}'
);

async function seedBuildProject(dir, fakePi = FAKE_PI) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API. Competitors: Acme, Globex.\n');
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

test('without --research the stage is skipped as not requested', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Competitive research — skipped/);

  const manifest = await manifestOf(dir);
  assert.equal(manifest.research, false);
  assert.equal(manifest.stages.research.status, 'skipped');
  assert.match(manifest.stages.research.reason, /--research/);
  assert.ok(!(await exists(join(dir, 'researcher-calls.log'))), 'no researcher may have been spawned');
});

test('--research runs the stage: one researcher per planned competitor, then done', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', '--research', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /competitive research: on/);
  assert.match(r.output, /researching 2 competitor\(s\): Acme, Globex/);
  assert.match(r.output, /✓ Competitive research — report/);

  const manifest = await manifestOf(dir);
  assert.equal(manifest.research, true);
  assert.equal(manifest.stages.research.status, 'done');

  const calls = (await readFile(join(dir, 'researcher-calls.log'), 'utf-8')).trim().split('\n');
  assert.equal(calls.length, 2, 'exactly one researcher run per competitor');
});

test('an existing gspec/research.md short-circuits the stage', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);
  await writeFile(join(dir, 'gspec', 'research.md'), 'already researched\n');

  const r = await runCli(['build', '--research', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Competitive research — skipped/);
  assert.equal((await manifestOf(dir)).stages.research.status, 'skipped');
  assert.ok(!(await exists(join(dir, 'researcher-calls.log'))), 'no researcher may have been spawned');
});

test('a planner that names no competitors skips the stage instead of guessing', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, FAKE_PI_NO_COMPETITORS);

  const r = await runCli(['build', '--research', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  const manifest = await manifestOf(dir);
  assert.equal(manifest.stages.research.status, 'skipped');
  assert.match(manifest.stages.research.reason, /no competitors/);
});

test('--research at resume time is ignored: the flag is pinned at run start', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const paused = await runCli(['build', 'an idea'], dir, env); // pauses at spec review
  assert.equal(paused.code, 0, paused.output);

  const resumed = await runCli(['build', '--resume', '--research'], dir, env);
  assert.equal(resumed.code, 0, resumed.output);
  assert.match(resumed.output, /ignoring it \(research is pinned at run start\)/);
  assert.match(resumed.output, /✓ Build complete/);
  assert.equal((await manifestOf(dir)).stages.research.status, 'skipped');
  assert.ok(!(await exists(join(dir, 'researcher-calls.log'))), 'no researcher may have been spawned');
});

test('--dry-run with --research shows the stage plan without fanning out', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  const r = await runCli(['build', '--dry-run', '--research', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Competitive research/);
  assert.match(r.output, /would fan out one competitor-researcher per planned competitor/);
});
