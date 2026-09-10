// The orchestrator's wave plan is persisted once it is accepted. It used to be
// the one artifact of the implement stage that did not survive the run: the
// manifest held status/attempts/verdict/elapsed and a post-mortem asking "what
// was serialized?" had only the log to go on.
//
// Drives the exported helper with a fake ctx — no engine, no disk.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { recordWavePlan, formatWavePlan } from '../lib/build.js';

const fakeCtx = () => {
  const manifest = { stages: {} };
  let saves = 0;
  return {
    manifest,
    saves: () => saves,
    stageRecord: (id) => (manifest.stages[id] ??= { status: 'pending', attempts: 0, verdict: null }),
    saveManifest: async () => { saves += 1; },
  };
};

const waves = [
  [{ label: 'scaffold', instruction: 'Scaffold it.' }],
  [{ label: 'auth', instruction: 'Build auth.', plan: ['gspec/features/auth/tasks.md'] },
    { label: 'catalog', instruction: 'Build catalog.', plan: ['gspec/features/catalog/tasks.md'] }],
];

test('the manifest carries the plan once the wave loop starts', async () => {
  const ctx = fakeCtx();
  await recordWavePlan(ctx, 'implement', waves);
  const stored = ctx.manifest.stages.implement.plan;
  assert.deepEqual(stored, [
    [{ label: 'scaffold', plan: [] }],
    [{ label: 'auth', plan: ['gspec/features/auth/tasks.md'] }, { label: 'catalog', plan: ['gspec/features/catalog/tasks.md'] }],
  ]);
  assert.equal(ctx.saves(), 1, 'persisted, not just set in memory');
});

test('the instruction text is not persisted — label and plan files are the record', async () => {
  const ctx = fakeCtx();
  await recordWavePlan(ctx, 'implement', waves);
  assert.doesNotMatch(JSON.stringify(ctx.manifest), /Build auth\./);
});

test('--status renders the plan one wave per line', () => {
  const lines = formatWavePlan([[{ label: 'scaffold' }], [{ label: 'auth' }, { label: 'catalog' }]]);
  assert.deepEqual(lines, ['wave 1/2 — scaffold', 'wave 2/2 — auth, catalog']);
});

test('the implement stage records the plan after splitting scopes per feature', async () => {
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  const loop = src.match(/plan = await Promise\.all\(plan\.map\(\(wave\) => splitScopesByFeature[\s\S]{0,200}/)[0];
  assert.match(loop, /recordWavePlan\(ctx, stage\.id, plan\)/, 'the accepted (split) plan is what gets persisted');
  assert.match(src, /stages\?\.implement\?\.plan/, 'and --status reads it back');
});
