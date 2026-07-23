// Engine-resolution and preflight tests for `gspec build` — the regression
// suite for the "build silently assumed Claude in a Pi project and pinned the
// wrong engine into the run manifest" class of bug. All scenarios are
// deterministic: happy paths go through --dry-run (no engine CLI is spawned),
// failure paths exit before anything runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runCli, makeProject, cleanup, exists, seedInstall } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');

test('engine defaults to the installed target (pi) and dry-runs pi commands', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  const r = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /engine: pi/);
  assert.match(r.output, /would run: pi /, 'stages must run on pi, not claude');
});

test('installed target without agent files fails fast and pins nothing', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi'); // config only — no .pi/agents/

  const r = await runCli(['build', 'an idea'], dir);
  assert.equal(r.code, 1);
  assert.match(r.output, /not installed for engine "pi"/);
  assert.match(r.output, /npx gspec -t pi/);
  assert.ok(!(await exists(join(dir, RUN_JSON))), 'preflight failure must not write a run manifest');
});

test('non-engine install target (cursor) demands an explicit --engine', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'cursor');

  const r = await runCli(['build', 'an idea'], dir);
  assert.equal(r.code, 1);
  assert.match(r.output, /installed for "cursor"/);
  assert.match(r.output, /--engine/);
  assert.ok(!(await exists(join(dir, RUN_JSON))));
});

test('no config, no agents anywhere: engine-neutral fail-fast guidance', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));

  const r = await runCli(['build', 'an idea'], dir);
  assert.equal(r.code, 1);
  assert.match(r.output, /not installed for any build engine/);
  assert.match(r.output, /npx gspec -t <claude\|codex\|pi>/);
  assert.ok(!(await exists(join(dir, RUN_JSON))));
});

test('no config but one engine installed (pre-2.0.1 install): that engine is detected', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  // Agent files only — no .gspec/config.json, like an install from before 2.0.1.
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });
  const { rm } = await import('node:fs/promises');
  await rm(join(dir, '.gspec'), { recursive: true });

  const r = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Using engine "pi" \(its gspec agents are installed here\)/);
  assert.match(r.output, /engine: pi/);
});

test('no config and several engines installed: demands an explicit --engine', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', {
    agentFiles: ['.pi/agents/profile-writer.md', '.codex/agents/profile-writer.toml'],
  });
  const { rm } = await import('node:fs/promises');
  await rm(join(dir, '.gspec'), { recursive: true });

  const r = await runCli(['build', 'an idea'], dir);
  assert.equal(r.code, 1);
  assert.match(r.output, /more than one engine here \(codex, pi\)/);
  assert.match(r.output, /--engine/);
  assert.ok(!(await exists(join(dir, RUN_JSON))));
});

test('explicit --engine codex without install fails fast with the install command', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));

  const r = await runCli(['build', '--engine', 'codex', 'an idea'], dir);
  assert.equal(r.code, 1);
  assert.match(r.output, /not installed for engine "codex"/);
  assert.match(r.output, /npx gspec -t codex/);
});

test('unknown --engine is rejected', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));

  const r = await runCli(['build', '--engine', 'gemini', 'an idea'], dir);
  assert.equal(r.code, 1);
  assert.match(r.output, /unknown engine "gemini"/);
});

test('a run stays pinned to its engine — a conflicting --engine on resume is ignored', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  // First dry run creates a well-formed manifest pinned to pi.
  const first = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(first.code, 0, first.output);
  assert.ok(await exists(join(dir, RUN_JSON)));

  const resumed = await runCli(['build', '--resume', '--engine', 'codex', '--dry-run'], dir);
  assert.equal(resumed.code, 0, resumed.output);
  assert.match(resumed.output, /started on "pi" — ignoring --engine codex/);
  assert.match(resumed.output, /engine: pi/);
});

test('a second fresh build refuses to clobber an existing run', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });
  await runCli(['build', '--dry-run', 'an idea'], dir);

  const r = await runCli(['build', 'another idea'], dir);
  assert.equal(r.code, 1);
  assert.match(r.output, /A build run already exists/);
});
