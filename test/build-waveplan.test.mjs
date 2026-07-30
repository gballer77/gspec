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
  // Waves were offered but none held a usable scope — that IS a read failure.
  assert.equal(parseBuildPlan('```json\n{"waves":[{"label":"x","scopes":[{"label":"no instruction"}]}]}\n```'), null);
});

test('an empty plan is an answer, not unreadable output', () => {
  // Observed verbatim on a resume where all 88 tasks were already checked: the
  // orchestrator replied `{"waves": []}` and explained that no work remained.
  // Collapsing that to null made the one completely correct reply look exactly
  // like gibberish, and the driver logged it as a gap in its own parser.
  assert.deepEqual(parseBuildPlan('```json\n{"waves":[]}\n```'), []);
  assert.deepEqual(parseBuildPlan('{"waves":[]}'), []);
  // Still distinct from output that could not be read at all.
  assert.equal(parseBuildPlan('I could not produce a plan.'), null);
});

test('a wave that IS a scope (the flattened shape) parses', () => {
  // Third shape observed from the SAME agent across three runs. The lesson is
  // not "add another case" — it is that the meaning is stable (a wave is one or
  // more scopes) while the shape is not, so pin the meaning.
  const waves = [scope, { ...scope, label: 'billing' }];
  const plan = parseBuildPlan('```json\n' + JSON.stringify({ waves }) + '\n```');
  assert.deepEqual(plan.map((w) => w.map((s) => s.label)), [['auth'], ['billing']]);
});

test('all three observed shapes agree on the same plan', () => {
  const one = parseBuildPlan('```json\n' + JSON.stringify({ waves: [[scope]] }) + '\n```');
  const two = parseBuildPlan('```json\n' + JSON.stringify({ waves: [{ label: 'w', scopes: [scope] }] }) + '\n```');
  const three = parseBuildPlan('```json\n' + JSON.stringify({ waves: [scope] }) + '\n```');
  for (const p of [one, two, three]) {
    assert.equal(p.length, 1);
    assert.equal(p[0][0].instruction, 'Build auth.');
  }
});

test('the rejection message points at a file the driver actually writes', () => {
  // The old message said the output was "in the run log". It never was — a
  // grep across every run of a full dogfood build found zero copies. A pointer
  // at an empty place is worse than none: it stops the reader looking, and each
  // of the three parser gaps found so far cost a manual reproduction because the
  // rejected text was discarded the moment it was rejected.
  assert.match(src, /const UNPARSED_PLAN_PATH = join\(BUILD_DIR, 'unparsed-plan\.md'\)/);

  const branch = src.match(/its plan was unusable[\s\S]{0,400}/)[0];
  assert.match(branch, /UNPARSED_PLAN_PATH/, 'the message must name the file it wrote');
  assert.doesNotMatch(branch, /in the run log/, 'it must not point somewhere nothing is written');

  // and the write is in the same branch as the message, not merely somewhere.
  const write = src.match(/await writeFile\(join\(ctx\.cwd, UNPARSED_PLAN_PATH\)[\s\S]{0,80}/);
  assert.ok(write, 'the rejected reply must be written verbatim');
});
