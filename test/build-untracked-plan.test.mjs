// A plan file with no task checkboxes is untracked, not finished.
//
// The orchestrator handed a scaffold scope `plan: ["gspec/architecture.md"]`.
// That file has no checkboxes, so the unchecked count was zero, and the
// driver skipped the scaffold as "every task already checked" — a silent
// no-op on the one scope the rest of the build depended on. The catalog run
// happened to scaffold on its own; nothing guaranteed it would.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const loop = src.match(/async function runImplementScope[\s\S]*?\n}\n/)[0];

test('a scope whose plan carries no tasks runs once instead of being skipped', () => {
  assert.match(loop, /const counts = await planCounts\(ctx\.cwd, files\);/);
  assert.match(loop, /if \(!counts\.tasks\) \{/);
  assert.match(loop, /carry no task checkboxes[\s\S]{0,120}running once/);
  // The untracked branch runs the agent; it does not return { code: 0, text: '' }.
  const branch = loop.match(/if \(!counts\.tasks\) \{[\s\S]*?\n  \}/)[0];
  assert.match(branch, /return runAgent\(stage\.agent, await promptFor\(1\)/);
  assert.doesNotMatch(branch, /text: ''/);
});

test('the all-checked skip still applies only when there were tasks to check', () => {
  const skipAt = loop.indexOf('every task already checked');
  const guardAt = loop.indexOf('if (!counts.tasks)');
  assert.ok(guardAt > 0 && guardAt < skipAt, 'the no-tasks guard runs before the all-checked skip');
  assert.match(loop, /let remaining = counts\.unchecked;/);
});

test('planCounts distinguishes task lines from unchecked ones and tolerates a missing file', () => {
  const fn = src.match(/async function planCounts[\s\S]*?\n}\n/)[0];
  assert.match(fn, /\\\[\[ xX\]\\\]/, 'counts checked and unchecked boxes');
  assert.match(fn, /catch \{ continue; \}/, 'an unreadable plan contributes nothing');
});
