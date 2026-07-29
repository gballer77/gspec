// Wave-plan parsing. The build-orchestrator returned valid JSON that named each
// wave — { "label": "Scaffold", "scopes": [...] } — and the parser, which
// demanded a bare array, dropped every scope and returned null. A ~855k-token
// plan with real dependency ordering was discarded SILENTLY, and the run fell
// back to unordered per-feature scopes. Take the scopes wherever they are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const parseBuildPlan = eval(`(function(){
  ${src.match(/function normalizePlanFiles[\s\S]*?\n}/)[0]}
  ${src.match(/function parseBuildPlan[\s\S]*?\n}\n/)[0]}
  return parseBuildPlan;
})()`);

const scope = { label: 'auth', instruction: 'Build auth.', plan: ['gspec/features/auth/tasks.md'] };

test('a wave may be a bare array (the documented shape)', () => {
  const plan = parseBuildPlan('```json\n' + JSON.stringify({ waves: [[scope]] }) + '\n```');
  assert.equal(plan.length, 1);
  assert.equal(plan[0][0].label, 'auth');
});

test('a wave may name itself and nest its scopes', () => {
  for (const key of ['scopes', 'tasks', 'items']) {
    const waves = [{ label: 'Scaffold', [key]: [scope] }];
    const plan = parseBuildPlan('```json\n' + JSON.stringify({ waves }) + '\n```');
    assert.ok(plan, `a wave keyed by "${key}" must parse`);
    assert.equal(plan[0][0].instruction, 'Build auth.');
  }
});

test('ordering across waves is preserved — it is the whole value of the plan', () => {
  const waves = [
    { label: 'scaffold', scopes: [{ ...scope, label: 'scaffold' }] },
    { label: 'features', scopes: [scope, { ...scope, label: 'billing' }] },
  ];
  const plan = parseBuildPlan('```json\n' + JSON.stringify({ waves }) + '\n```');
  assert.deepEqual(plan.map((w) => w.map((s) => s.label)), [['scaffold'], ['auth', 'billing']]);
});

test('genuinely unusable output still yields null so the fallback engages', () => {
  assert.equal(parseBuildPlan('I could not produce a plan.'), null);
  assert.equal(parseBuildPlan('```json\n{"waves":[]}\n```'), null);
  assert.equal(parseBuildPlan('```json\n{"waves":[{"label":"x","scopes":[{"label":"no instruction"}]}]}\n```'), null);
});
