// The rung below "a writer fixes it": the driver repairs a mechanical
// violation itself when the fix is unique and lossless, then re-lints for
// free. Every lint round on a measured run was one of these.
//
// Pure: drives lib/auto-repair.js; the loop wiring is checked in source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { repairPlan, repairArch, repairDesign } from '../lib/auto-repair.js';
import { planLintViolations, parallelismViolations, designLintViolations } from '../plugin/hooks/floors/plan-lint.mjs';

const ARCH = `---
spec-version: v2
---

## Data

### Entity: IngredientLine
- **module:** api

### Entity: Order
- **module:** api

### Entity: Orders
- **module:** api

## API

### Endpoint: GET /recipes/:id
- **module:** api

### Rule: Pagination
- **module:** api

Every list endpoint is paginated.

## UI

### Screen: Recipe Detail
- **module:** web

## Logic

**Not Applicable** — none.
`;

const TASKS = `---
feature: x
---

## Plan

- [ ] **T1** **P0** Foundation
  - deps: none
  - arch: #entity-ingredientline
- [ ] **T2** [P] **P0** Endpoint
  - deps: T1
  - arch: [#endpoint-get-recipesid, #entity-ingredientline]
- [ ] **T3** [P] **P0** Screen
  - deps: T2
  - arch: #screen-recipedetail
- [ ] **T4** [P] **P1** Unknown
  - deps: T1
  - arch: #entity-nothing
- [x] **T5** **P1** Done already
  - deps: none
  - arch: #entity-ingredientline
`;

test('an anchor ref off by hyphenation is rewritten to the one heading it means', () => {
  const { text, repairs } = repairPlan(TASKS, ARCH);
  assert.match(text, /- arch: #entity-ingredient-line\n/);
  assert.match(text, /- arch: \[#endpoint-get-recipes-id, #entity-ingredient-line\]/);
  assert.match(text, /- arch: #screen-recipe-detail/);
  assert.ok(repairs.some((r) => /T1: arch reference "#entity-ingredientline" → #entity-ingredient-line/.test(r)));
  // After repair, the strict floor is clean for those refs.
  const left = planLintViolations('t', text, ARCH);
  assert.ok(!left.some((v) => /ingredientline|recipesid|recipedetail/.test(v)), left.join('\n'));
});

test('a ref matching nothing is left for the writer, and a checked task is never touched', () => {
  const { text, repairs } = repairPlan(TASKS, ARCH);
  // Nothing collapses to "entitynothing" → no repair. (Two headings can never
  // collapse to one loose slug — the arch floor rejects them as duplicates —
  // so "ambiguous" is not a case that can arise.)
  assert.match(text, /- arch: #entity-nothing\n/);
  assert.ok(!repairs.some((r) => /T4: arch/.test(r)));
  assert.ok(planLintViolations('t', text, ARCH).some((v) => /#entity-nothing/.test(v)), 'still a violation for the writer');
  // T5 is checked: its (broken) ref stays as history.
  assert.match(text, /\*\*T5\*\*[\s\S]*?- arch: #entity-ingredientline/);
});

test('a [P] on a task that depends on a [P] task loses the marker, never the other way', () => {
  const { text, repairs } = repairPlan(TASKS, ARCH);
  assert.match(text, /- \[ \] \*\*T2\*\* \[P\] \*\*P0\*\* Endpoint/, 'T2 depends on the non-[P] T1 — untouched');
  assert.match(text, /- \[ \] \*\*T3\*\* \*\*P0\*\* Screen/, 'T3 depended on [P] T2 — marker dropped');
  assert.ok(repairs.some((r) => /T3: dropped \[P\] — it depends on T2/.test(r)));
  assert.deepEqual(parallelismViolations('t', text), []);
});

test('a Rule filed under ## API moves to ## Logic, replacing its Not Applicable line', () => {
  const { text, repairs } = repairArch(ARCH);
  const api = text.slice(text.indexOf('## API'), text.indexOf('## UI'));
  const logic = text.slice(text.indexOf('## Logic'));
  assert.doesNotMatch(api, /### Rule: Pagination/);
  assert.match(logic, /### Rule: Pagination[\s\S]*Every list endpoint is paginated\./);
  assert.doesNotMatch(logic, /Not Applicable/);
  assert.ok(repairs.some((r) => /moved "### Rule: Pagination" from ## API to ## Logic/.test(r)));
  assert.match(repairs.join('\n'), /removed its "Not Applicable" line/);
});

test('a clean architecture is returned untouched', () => {
  const clean = ARCH.replace('### Rule: Pagination\n- **module:** api\n\nEvery list endpoint is paginated.\n\n', '');
  const { text, repairs } = repairArch(clean);
  assert.equal(text, clean);
  assert.deepEqual(repairs, []);
});

test('a screen section id off by hyphenation is renamed to the declared id', () => {
  const html = '<!-- spec-version: v2 -->\n<section id="screen-recipedetail"><h2>Detail</h2></section>\n<section id="screen-unknown"></section>\n';
  const { text, repairs } = repairDesign(html, ARCH);
  assert.match(text, /id="screen-recipe-detail"/);
  assert.match(text, /id="screen-unknown"/, 'an id matching nothing is left for the writer');
  assert.equal(repairs.length, 1);
  assert.ok(!designLintViolations('d', text, ARCH).some((v) => /recipedetail/.test(v)));
});

test('the loose comparison in the floors is the fallback behind the repair', () => {
  assert.deepEqual(planLintViolations('t', '- [ ] **T1** x\n  - arch: #entity-ingredientline\n', ARCH), []);
  assert.deepEqual(planLintViolations('t', '- [ ] **T1** x\n  - arch: #entity-nothing\n', ARCH).length, 1);
  const html = '<section id="screen-recipedetail"></section>';
  assert.deepEqual(designLintViolations('d', html, ARCH), []);
});

test('the lint loop tries the repair before spending a writer, and a free pass does not count as a round', async () => {
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  const fn = src.match(/async function lintUntilClean[\s\S]*?\n}\n/)[0];
  const repairAt = fn.indexOf('await repair(violations)');
  const writerAt = fn.indexOf('runWriterResilient(');
  assert.ok(repairAt > 0 && repairAt < writerAt);
  assert.match(fn, /repairedSignatures/, 'one repair pass per distinct signature');
  assert.match(fn, /r -= 1;/, 'a driver repair spends no round');
  assert.match(fn, /`\$\{stage\.id\}-autofix`/, 'recorded in the durable log as an autofix');
  assert.match(src, /repair: \(\) => autoRepairFeature\(ctx\.cwd, slug, stage\.file\)/, 'the per-feature stages opt in');
  assert.match(src, /-\(lint\|autofix\)\$/, 'autofix rounds are reported as mechanical, not QA');
});
