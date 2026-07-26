// Per-agent model configuration for `gspec build`. The `models` map in
// .gspec/config.json (project) / ~/.gspec/config.json (global) assigns a model
// to each build agent by selector — exact agent name, role tier, or default —
// resolved most-specific-first with the project file overriding the global one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall } from './helpers.mjs';
import { resolveModel, roleOf, modelSelectors } from '../lib/config.js';

// ---------------------------------------------------------------------------
// roleOf — how an agent maps to a role tier.
// ---------------------------------------------------------------------------

test('roleOf classifies each agent family', () => {
  assert.equal(roleOf('stack-validator'), 'qa');
  assert.equal(roleOf('implementation-validator'), 'qa');
  assert.equal(roleOf('architecture-writer'), 'writer');
  assert.equal(roleOf('research-writer'), 'writer');
  assert.equal(roleOf('feature-planner'), 'planner');
  assert.equal(roleOf('plan-decomposer'), 'planner');
  assert.equal(roleOf('build-orchestrator'), 'planner');
  assert.equal(roleOf('implementer'), 'implementer');
  assert.equal(roleOf('competitor-researcher'), 'researcher');
  assert.equal(roleOf('codebase-inspector'), 'inspector');
  assert.equal(roleOf('something-unknown'), null);
});

// ---------------------------------------------------------------------------
// resolveModel — most-specific-wins, project breaks ties within a level.
// ---------------------------------------------------------------------------

test('an exact agent-name entry wins over role and default', () => {
  const project = { models: { 'architecture-writer': 'P-agent', writer: 'P-writer', default: 'P-def' } };
  assert.equal(resolveModel('architecture-writer', { project }), 'P-agent');
});

test('an agent-name entry beats a role entry even across scopes (most specific wins)', () => {
  // The chosen precedence: global agent-specific beats project role-level.
  const project = { models: { writer: 'P-writer' } };
  const global = { models: { 'architecture-writer': 'G-agent' } };
  assert.equal(resolveModel('architecture-writer', { project, global }), 'G-agent');
});

test('project breaks the tie at the same specificity level', () => {
  const project = { models: { writer: 'P-writer' } };
  const global = { models: { writer: 'G-writer', 'architecture-writer': undefined } };
  assert.equal(resolveModel('architecture-writer', { project, global }), 'P-writer');
});

test('a role entry wins over default; default is the last resort', () => {
  const project = { models: { qa: 'P-qa', default: 'P-def' } };
  assert.equal(resolveModel('stack-validator', { project }), 'P-qa');   // role
  assert.equal(resolveModel('feature-planner', { project }), 'P-def');  // no planner entry → default
});

test('project default overrides global default', () => {
  const project = { models: { default: 'P-def' } };
  const global = { models: { default: 'G-def' } };
  assert.equal(resolveModel('implementer', { project, global }), 'P-def');
});

test('global config applies when the project sets nothing', () => {
  const global = { models: { default: 'G-def', qa: 'G-qa' } };
  assert.equal(resolveModel('feature-validator', { global }), 'G-qa');
  assert.equal(resolveModel('implementer', { global }), 'G-def');
});

test('no matching selector resolves to null (engine/CLI default)', () => {
  assert.equal(resolveModel('stack-writer', {}), null);
  assert.equal(resolveModel('stack-writer'), null);
  // A role that does not match falls through to default — and there is none here.
  assert.equal(resolveModel('implementer', { project: { models: { writer: 'x' } } }), null);
});

test('modelSelectors overlays project over global for display', () => {
  const merged = modelSelectors({ models: { writer: 'P' } }, { models: { writer: 'G', qa: 'G-qa' } });
  assert.deepEqual(merged, { writer: 'P', qa: 'G-qa' });
});

// ---------------------------------------------------------------------------
// Integration — a configured model reaches the engine's --model flag.
// ---------------------------------------------------------------------------

const AGENTS = [
  'profile-writer', 'stack-writer', 'practices-writer', 'style-writer',
  'feature-planner', 'feature-writer', 'feature-validator',
  'architecture-writer', 'architecture-validator',
  'plan-decomposer', 'plan-validator',
  'build-orchestrator', 'implementer', 'implementation-validator',
  'codebase-inspector',
];

// Fake pi that appends its argv to $ARGV_LOG so the test can see which --model
// each invocation received, then behaves (validators PASS, everyone else ok).
const FAKE_PI_DUMP = `#!/bin/sh
printf '%s\\n' "$@" >> "$ARGV_LOG"
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) printf 'ok\\n' ;;
esac
`;

test('per-agent model config is passed to the engine as --model', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  // Project config: distinct model strings per tier so we can spot each in argv.
  await writeFile(join(dir, '.gspec', 'config.json'), JSON.stringify({
    target: 'pi',
    models: { qa: 'MODEL-QA', writer: 'MODEL-WRITER', default: 'MODEL-DEF' },
  }) + '\n');
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI_DUMP);
  await chmod(join(bin, 'pi'), 0o755);
  const argvLog = join(dir, 'argv.log');

  const r = await runCli(['build', '--no-review', 'an idea'], dir, {
    PATH: `${bin}:${process.env.PATH}`, ARGV_LOG: argvLog,
  });
  assert.equal(r.code, 0, r.output);
  // The run header advertises the assignments.
  assert.match(r.output, /models: .*qa→MODEL-QA/);

  const argv = await readFile(argvLog, 'utf-8');
  assert.match(argv, /--model/);
  assert.match(argv, /MODEL-QA/);      // a validator ran on the qa model
  assert.match(argv, /MODEL-WRITER/);  // a writer ran on the writer model
  assert.match(argv, /MODEL-DEF/);     // a planner/implementer fell through to default
});
