// Dist invariants for COMMAND bodies: on a target that cannot install the
// skill catalog (Codex — commands share the skills namespace, `emitSkills:
// false`), every skill a command's flow names in backticks must be inlined
// into that command's emitted body. The agents always got their persona
// (composeAgentBody); the command is the conversation with the user, and a
// dangling "the `gspec-engineer` skill applies" there is exactly the reported
// failure mode: an orchestrator that re-asks decisions the specs record.
//
// Requires dist/ to be built (npm test runs the build first via pretest).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { V2_COMMANDS, V2_SKILLS, MEMORY_SKILLS } from '../scripts/manifest.js';
import { REPO_ROOT } from './helpers.mjs';

const skillNames = new Set([...V2_SKILLS, ...MEMORY_SKILLS].map((s) => s.name));

const referencedSkills = (src) =>
  [...new Set([...src.matchAll(/`(gspec-[a-z-]+)`/g)].map((m) => m[1]))].filter((n) => skillNames.has(n));

test('codex commands inline every skill their source body names', async () => {
  const missing = [];
  for (const meta of V2_COMMANDS) {
    const src = await readFile(join(REPO_ROOT, 'plugin', meta.source), 'utf-8');
    const emitted = await readFile(join(REPO_ROOT, 'dist', 'codex', 'skills', meta.name, 'SKILL.md'), 'utf-8');
    for (const name of referencedSkills(src)) {
      if (!emitted.includes(`## ${name}`)) missing.push(`${meta.name} → ${name}`);
    }
  }
  assert.deepEqual(missing, [], `dist/codex command-skills with dangling skill references: ${missing.join(', ')}`);
});

test('codex /gspec-implement conversation carries the engineer persona and its spec-recall rule', async () => {
  const emitted = await readFile(join(REPO_ROOT, 'dist', 'codex', 'skills', 'gspec-implement', 'SKILL.md'), 'utf-8');
  assert.match(emitted, /Senior Engineer and Tech Lead/, 'the engineer persona must reach the orchestrating conversation');
  assert.match(emitted, /## gspec-orchestrator/, 'the fan-out judgment must reach the orchestrating conversation');
  assert.match(emitted, /The spec answers before the user does/, 'the spec-recall rule must ship with the persona');
});

test('the change-request protocol ships in the implement command on every v2 target', async () => {
  for (const path of ['dist/claude/commands/gspec-implement.md', 'dist/codex/skills/gspec-implement/SKILL.md']) {
    const emitted = await readFile(join(REPO_ROOT, path), 'utf-8');
    assert.match(emitted, /## Change requests — during and after the run/, `${path} must carry the change-request protocol`);
  }
});

test('claude commands stay lean — skills are preloadable there, never inlined', async () => {
  const emitted = await readFile(join(REPO_ROOT, 'dist', 'claude', 'commands', 'gspec-implement.md'), 'utf-8');
  assert.doesNotMatch(emitted, /# Reference — persona & conventions/, 'claude preloads skills; inlining would double them');
});
