// Fixes from the recipes-4 dogfood run, each pinned to what was observed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { filesNamedByCheckedTasks } from '../plugin/hooks/floors/implementation-lint.mjs';
import { forwardDepViolations } from '../plugin/hooks/floors/plan-lint.mjs';
import { namedTaskIds, instructionNamesSubset } from '../lib/scope-brief.js';
import { parseFindings, anchoredRevisionBlocks } from '../lib/revision-brief.js';
import { implementationLint, firstRunPrompt, revisePromptDetailed } from '../lib/build.js';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');

// --- implementation floor: globs and basenames ------------------------------------

test('a glob in a task is not a file the floor can demand', () => {
  const tasks = '- [x] **T1** Write fixtures `web/src/api/fixtures/pantry-*.json` and `web/src/a.ts`\n';
  assert.deepEqual(filesNamedByCheckedTasks(tasks), [{ id: 'T1', path: 'web/src/a.ts' }]);
});

test('a named path whose basename exists exactly once in the tree counts as present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-basename-'));
  try {
    await mkdir(join(dir, 'gspec', 'features', 'scaling'), { recursive: true });
    await mkdir(join(dir, 'web', 'src', 'recipe'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'features', 'scaling', 'tasks.md'), '---\nfeature: scaling\n---\n\n## Plan\n\n- [x] **T5** Add `web/src/recipes/scale-servings.ts`\n- [x] **T6** Add `web/src/recipes/missing.ts`\n');
    await writeFile(join(dir, 'web', 'src', 'recipe', 'scale-servings.ts'), 'export const x = 1;\n');
    const notes = [];
    const v = await implementationLint(dir, { render: false, log: (l) => notes.push(l) });
    assert.ok(!v.some((x) => /scale-servings/.test(x)), `resolved by basename, got: ${v.join(' | ')}`);
    assert.ok(v.some((x) => /missing\.ts does not exist/.test(x)), 'a file that exists nowhere is still missing');
    // Same directory, dotted prefix dropped: `recipes.routes.ts` named, `routes.ts` written.
    await mkdir(join(dir, 'api', 'src', 'resources', 'recipes'), { recursive: true });
    await writeFile(join(dir, 'api', 'src', 'resources', 'recipes', 'routes.ts'), 'export const r = 1;\n');
    await writeFile(join(dir, 'gspec', 'features', 'scaling', 'tasks.md'), '---\nfeature: scaling\n---\n\n## Plan\n\n- [x] **T3** Add the param in `api/src/resources/recipes/recipes.routes.ts`\n');
    const v2 = await implementationLint(dir, { render: false, log: (l) => notes.push(l) });
    assert.ok(!v2.some((x) => /recipes\.routes\.ts/.test(x)), `resolved by dropping the dotted prefix, got: ${v2.join(' | ')}`);
    assert.ok(notes.some((n) => /recipes\.routes\.ts resolved to api\/src\/resources\/recipes\/routes\.ts \(same directory, shorter name\)/.test(n)));
    assert.ok(notes.some((n) => /scale-servings\.ts resolved to web\/src\/recipe\/scale-servings\.ts/.test(n)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- first-run split: a range covering the whole plan is the whole feature -----------

const plan12 = ['---', 'feature: big', '---', '', '## Plan', '', ...Array.from({ length: 12 }, (_, i) => `- [ ] **T${i + 1}** Do ${i + 1}\n  - deps: ${i ? `T${i}` : 'none'}`)].join('\n');

test('named task ids expand ranges in every spelling', () => {
  assert.deepEqual([...namedTaskIds('tasks T1–T3 and T7')], ['T1', 'T2', 'T3', 'T7']);
  assert.deepEqual([...namedTaskIds('T2-T4')], ['T2', 'T3', 'T4']);
  assert.deepEqual([...namedTaskIds('T2..T3, T9 to T10')], ['T2', 'T3', 'T9', 'T10']);
  assert.equal(namedTaskIds('Implement the feature.').size, 0);
});

test('"all tasks T1–T12" over a 12-task plan is the whole feature and splits; "T1–T6" is a subset and does not', () => {
  assert.equal(instructionNamesSubset('Implement feature big, executing all tasks T1–T12.', plan12), false);
  assert.equal(instructionNamesSubset('Implement feature big, tasks T1–T6.', plan12), true);
  assert.equal(instructionNamesSubset('Implement feature big.', plan12), false);
  const plans = [{ rel: 'gspec/features/big/tasks.md', text: plan12 }];
  assert.match(firstRunPrompt('BASE', { instruction: 'Implement big, executing all tasks T1–T12.' }, plans), /group 1 of/);
  assert.equal(firstRunPrompt('BASE', { instruction: 'Implement big, tasks T1–T6.' }, plans), 'BASE');
});

// --- forward deps are a floor ----------------------------------------------------------

test('a dep on a later task is a violation; a checked task is exempt', () => {
  const t = '- [ ] **T7** x\n  - deps: T4, T8\n- [ ] **T8** y\n  - deps: T7\n- [x] **T9** z\n  - deps: T10\n';
  const v = forwardDepViolations('t', t);
  assert.equal(v.length, 1);
  assert.match(v[0], /T7 depends on T8, which comes later in the plan/);
  assert.match(src, /\.\.\.forwardDepViolations\(rel, tasks\)/, 'wired into the plan lint');
});

// --- verdict shapes -------------------------------------------------------------------------

test('severity synonyms are normalized to the contract\'s four', () => {
  const f = parseFindings('FINDINGS:\n- [MODERATE] a\n- [critical] b\n- [low] c\n- [nit] d\n');
  assert.deepEqual(f.map((x) => x.severity), ['major', 'blocker', 'minor', 'nit']);
});

test('an unprefixed anchor that lives in a sibling of the deliverable set is found there', () => {
  const verdict = 'VERDICT: FAIL\nFINDINGS:\n- [minor] Altitude — composition stated\n    evidence: "x"\n    anchor: ### Entity: CanonicalQuantity\n';
  const root = '# system\n\n## Module Boundaries\n\ntext\n';
  const api = '# api\n\n## Data\n\n### Entity: CanonicalQuantity\n- **module:** api\n\nA quantity.\n';
  const r = anchoredRevisionBlocks(verdict, root, { docs: { 'gspec/architecture/api.md': api } });
  assert.equal(r.unanchored.length, 0);
  assert.match(r.blocks[0], /gspec\/architecture\/api\.md → ### Entity: CanonicalQuantity/);
  assert.match(src, /typeof stage\.deliverables === 'function'[\s\S]{0,400}docs\[rel\] = text/, 'the driver loads the deliverable set');
});

test('both revision shapes ask for edit economy', () => {
  const stage = { title: 'x' };
  const verdict = 'VERDICT: FAIL\nFINDINGS:\n- [major] a — b\n    anchor: ## Data\n';
  const doc = '## Data\n\ntext\n';
  assert.match(revisePromptDetailed(stage, 't', [verdict], '', doc).prompt, /rewrite the file in ONE write rather than many small edits/);
  assert.match(revisePromptDetailed(stage, 't', [verdict], '', '').prompt, /rewrite the file in ONE write rather than many small edits/);
});

// --- render floor and plurals -------------------------------------------------------------

test('the render probe tries every loopback spelling, and one dead server skips the rest of the round', async () => {
  const rl = await readFile(join(REPO_ROOT, 'plugin', 'hooks', 'floors', 'render-lint.mjs'), 'utf-8');
  assert.match(rl, /http:\/\/localhost:\$\{port\}/);
  assert.match(rl, /http:\/\/\[::1\]:\$\{port\}/);
  assert.match(src, /did not answer\|could not launch\|could not be loaded[\s\S]{0,200}break;/);
});

test('countNoun pluralizes fix as fixes', () => {
  const fn = eval(`(function(){ ${src.match(/function countNoun[\s\S]*?\n}\n/)[0]} ${src.match(/function plural[\s\S]*?\n}\n/)[0]} return countNoun; })()`);
  assert.equal(fn(2, 'fix'), '2 fixes');
  assert.equal(fn(1, 'fix'), 'one fix');
  assert.equal(fn(3, 'stop'), '3 stops');
  assert.equal(fn(2, 'memory'), '2 memories');
});

test('every validator brief asks for the anchor line, and the engineer skill names the forward-dep floor', async () => {
  const { readdir } = await import('node:fs/promises');
  const agents = (await readdir(join(REPO_ROOT, 'plugin', 'agents'))).filter((f) => f.endsWith('-validator.md'));
  assert.equal(agents.length, 10);
  for (const a of agents) {
    const t = await readFile(join(REPO_ROOT, 'plugin', 'agents', a), 'utf-8');
    assert.match(t, /Every finding carries an `anchor:` line/, a);
  }
  const eng = await readFile(join(REPO_ROOT, 'plugin', 'skills', 'personas', 'gspec-engineer.md'), 'utf-8');
  assert.match(eng, /comes later in the plan — every dep points strictly backwards/);
});
