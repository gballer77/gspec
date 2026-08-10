// Upgrading an existing project onto the current spec format.
//
// Both guards here come from migrating a real v1 repo (a Next.js product with 8
// built features) and watching what the installer left behind.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { runCli, makeProject, cleanup, exists } from './helpers.mjs';

const skill = async (dir, name, body = 'x') => {
  await mkdir(join(dir, '.claude', 'skills', name), { recursive: true });
  await writeFile(join(dir, '.claude', 'skills', name, 'SKILL.md'), body, 'utf-8');
};

test('the v1 planner skill is removed on upgrade, not left to write v1 layout back', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  // gspec-tasks told the agent to write gspec/features/<slug>.tasks.md — the exact
  // flat path /gspec-migrate exists to retire. Surviving an upgrade, it can undo a
  // migration one "break this feature into tasks" at a time.
  await skill(dir, 'gspec-tasks');

  await runCli(['install', '-t', 'claude'], dir);

  assert.equal(
    await exists(join(dir, '.claude', 'skills', 'gspec-tasks', 'SKILL.md')),
    false,
    'gspec-tasks must not survive an upgrade',
  );
});

test('a v1 skill name that v2 still emits is kept, not deleted', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  // gspec-architect is in both rosters. Pruning by name alone would delete the
  // skill the install just wrote.
  await skill(dir, 'gspec-architect', 'stale');

  await runCli(['install', '-t', 'claude'], dir);

  assert.equal(
    await exists(join(dir, '.claude', 'skills', 'gspec-architect', 'SKILL.md')),
    true,
    'a skill the current build emits must be overwritten in place, never removed',
  );
});

test('the pre-v2 layout warning names the folder specs actually move to', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await mkdir(join(dir, 'gspec', 'features'), { recursive: true });
  await writeFile(join(dir, 'gspec', 'features', 'billing.md'), '# Billing\n', 'utf-8');
  await writeFile(join(dir, 'gspec', 'features', 'billing.tasks.md'), '# Tasks: Billing\n', 'utf-8');

  const { output } = await runCli(['install', '-t', 'claude'], dir);

  // This warning is the only prompt telling a user migration exists. Pointing it
  // at gspec/tasks/ — a directory /gspec-migrate deletes — sent them the wrong way.
  assert.match(output, /gspec\/features\/<slug>\//, 'must name the v2 destination');
  assert.doesNotMatch(
    output,
    /plans under gspec\/tasks\//,
    'gspec/tasks/ is itself a legacy location, never the destination',
  );
  assert.match(output, /\/gspec-migrate/, 'must still surface the migrate command');
});
