// A continued implementer run is briefed on its remaining tasks and the spec
// sections they cite, not the whole feature folder. Input is transcript ×
// turns, and every continuation used to re-send the whole-feature brief even
// when one task remained.
//
// Pure: drives lib/scope-brief.js and the exported prompt builders. The I/O
// wrapper is exercised against a temp fixture tree; no engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remainingBriefFor, formatRemainingBrief, remainingTaskBrief, taskGroups, firstRunGroupBrief, parsePlanTasks } from '../lib/scope-brief.js';
import { continuationPrompt, firstRunPrompt } from '../lib/build.js';

const ARCH = `---
spec-version: v2
feature: checkout
module: api, web
---

## Data

### Entity: Order
- **module:** api
- **defined-in:** gspec/features/checkout/arch.md

### Entity: Coupon
- **module:** api
- **uses:** gspec/architecture/api.md

## API

### Endpoint: POST /orders
- **module:** api
- **defined-in:** gspec/features/checkout/arch.md

## UI

### Screen: Cart
- **module:** web
- **defined-in:** gspec/features/checkout/arch.md

### Component: CouponField
- **module:** web
- **defined-in:** gspec/features/checkout/arch.md

## Logic

### Rule: Totals
- **module:** api
- **amends:** gspec/architecture/api.md
`;

const TASKS = `---
feature: checkout
---

## Plan

- [x] **T1** Create the order model in \`src/order.ts\`
  - deps: none
  - covers: "User can place an order"
  - arch: #entity-order
- [x] **T2** Wire the endpoint
  - deps: T1
  - arch: #endpoint-post-orders
- [ ] **T3** Render the cart screen in \`src/cart.tsx\`
  - deps: T2
  - covers: "User sees the cart"
  - arch: [UI > ### Screen: Cart]
- [ ] **T4** [P] Apply coupon totals
  - deps: T2
  - arch: #rule-totals, #entity-coupon
`;

test('the brief lists only unchecked ids, only the anchors they cite, only the modules those anchors live in', () => {
  const b = remainingBriefFor({ tasksRel: 'gspec/features/checkout/tasks.md', tasksText: TASKS, archRel: 'gspec/features/checkout/arch.md', archText: ARCH });
  assert.deepEqual(b.tasks.map((t) => t.id), ['T3', 'T4']);
  assert.deepEqual(b.tasks[0].anchors, ['screen-cart']);
  assert.deepEqual(b.tasks[1].anchors, ['rule-totals', 'entity-coupon']);
  // Sections in file order; the checked tasks' anchors (Order, POST /orders)
  // and the uncited CouponField are absent.
  assert.deepEqual(b.sections, ['### Entity: Coupon', '### Screen: Cart', '### Rule: Totals']);
  assert.deepEqual(b.files.sort(), ['gspec/architecture/api.md', 'gspec/architecture/web.md']);
  assert.equal(b.empty, false);
});

test('a module nothing cites is not listed', () => {
  const onlyWeb = TASKS.replace('- [ ] **T4** [P] Apply coupon totals\n  - deps: T2\n  - arch: #rule-totals, #entity-coupon\n', '');
  const b = remainingBriefFor({ tasksRel: 't', tasksText: onlyWeb, archRel: 'a', archText: ARCH });
  assert.deepEqual(b.files, ['gspec/architecture/web.md']);
  assert.deepEqual(b.sections, ['### Screen: Cart']);
});

test('a fully-checked plan yields an empty brief', () => {
  const done = TASKS.replaceAll('- [ ]', '- [x]');
  const b = remainingBriefFor({ tasksRel: 't', tasksText: done, archRel: 'a', archText: ARCH });
  assert.equal(b.empty, true);
  assert.deepEqual(b.tasks, []);
  assert.equal(formatRemainingBrief(b), '');
});

test('the rendered brief names the tasks, sections and files, and says not to re-read the rest', () => {
  const b = remainingBriefFor({ tasksRel: 'gspec/features/checkout/tasks.md', tasksText: TASKS, archRel: 'gspec/features/checkout/arch.md', archText: ARCH });
  const text = formatRemainingBrief(b);
  assert.match(text, /Remaining tasks in gspec\/features\/checkout\/tasks\.md:/);
  assert.match(text, /T3 — Render the cart screen/);
  assert.match(text, /T4 \[P\] — Apply coupon totals/);
  assert.match(text, /Read these sections of gspec\/features\/checkout\/arch\.md only:/);
  assert.match(text, /### Screen: Cart/);
  assert.doesNotMatch(text, /### Entity: Order/, 'a section a checked task cited is not sent');
  assert.match(text, /gspec\/architecture\/api\.md/);
  assert.match(text, /do not re-read it/);
});

test('the I/O wrapper reads the sibling arch.md and lists only module files that exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-scope-brief-'));
  try {
    await mkdir(join(dir, 'gspec', 'features', 'checkout'), { recursive: true });
    await mkdir(join(dir, 'gspec', 'architecture'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'features', 'checkout', 'tasks.md'), TASKS);
    await writeFile(join(dir, 'gspec', 'features', 'checkout', 'arch.md'), ARCH);
    await writeFile(join(dir, 'gspec', 'architecture', 'api.md'), '# api\n');
    // web.md deliberately absent
    const [b] = await remainingTaskBrief(dir, ['gspec/features/checkout/tasks.md']);
    assert.deepEqual(b.tasks.map((t) => t.id), ['T3', 'T4']);
    assert.deepEqual(b.files, ['gspec/architecture/api.md']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the continuation prompt carries the remaining brief and the never-redo rule, not the read list', () => {
  const stage = { title: 'Implementation' };
  const scope = { label: 'checkout', instruction: 'Implement feature checkout.', plan: ['gspec/features/checkout/tasks.md'] };
  const base = 'BASE PROMPT\nYour specs for this scope are exactly these — do not read other specs:\n  gspec/features/checkout/prd.md\n  gspec/practices.md';
  const briefs = [remainingBriefFor({ tasksRel: 'gspec/features/checkout/tasks.md', tasksText: TASKS, archRel: 'gspec/features/checkout/arch.md', archText: ARCH })];
  const p = continuationPrompt(stage, 'the intake brief', scope, briefs, base);
  assert.match(p, /Continue ONLY this scope/);
  assert.match(p, /never redo, uncheck, or renumber completed tasks/);
  assert.match(p, /Remaining tasks in/);
  assert.match(p, /the intake brief/);
  assert.doesNotMatch(p, /BASE PROMPT/);
  assert.doesNotMatch(p, /do not read other specs/, 'the whole-folder read list is not re-sent');
});

test('with nothing to say, the continuation falls back to the old whole-brief shape', () => {
  const p = continuationPrompt({ title: 'Implementation' }, 'b', { instruction: 'x' }, [], 'BASE PROMPT');
  assert.match(p, /^BASE PROMPT\n\nA prior implementer run/);
});

// --- task groups for a large first run ---------------------------------------

const bigPlan = (n) => ['---', 'feature: big', '---', '', '## Plan', '',
  ...Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    // T1 is the barrier; T2..T5 fan out from it in parallel; the rest chain.
    const deps = id === 1 ? 'none' : id <= 5 ? 'T1' : `T${id - 1}`;
    const p = id >= 2 && id <= 5 ? '[P] ' : '';
    return `- [ ] **T${id}** ${p}Do thing ${id}\n  - deps: ${deps}`;
  })].join('\n');

test('a plan at or under the threshold is not grouped', () => {
  assert.deepEqual(taskGroups(bigPlan(8), 8), []);
  assert.equal(firstRunGroupBrief('t', bigPlan(8)), '');
});

test('a large plan is layered by deps, [P] siblings together, chunks capped at the threshold', () => {
  const groups = taskGroups(bigPlan(12), 8);
  assert.deepEqual(groups[0], ['T1'], 'the barrier is its own layer');
  assert.deepEqual(groups[1], ['T2', 'T3', 'T4', 'T5'], 'the [P] fan-out lands together');
  assert.deepEqual(groups.flat(), Array.from({ length: 12 }, (_, i) => `T${i + 1}`), 'every unchecked task lands exactly once');
  for (const g of groups) assert.ok(g.length <= 8);
});

test('checked tasks are neither grouped nor counted toward the threshold', () => {
  const plan = bigPlan(12).replace('- [ ] **T1**', '- [x] **T1**').replace('- [ ] **T2**', '- [x] **T2**');
  const groups = taskGroups(plan, 8);
  assert.ok(!groups.flat().includes('T1'));
  assert.deepEqual(groups[0], ['T3', 'T4', 'T5'], 'deps on checked tasks are satisfied');
});

test('the first-run brief names group 1 and tells the run to stop', () => {
  const brief = firstRunGroupBrief('gspec/features/big/tasks.md', bigPlan(12));
  assert.match(brief, /THIS RUN: group 1 of \d+ of a 12-task plan/);
  assert.match(brief, /T1 — Do thing 1/);
  assert.doesNotMatch(brief, /T6 — Do thing 6/);
  assert.match(brief, /return immediately/);
});

test('firstRunPrompt splits only a whole-feature scope on a large plan, never a scaffold or a task-ranged scope', () => {
  const plans = [{ rel: 'gspec/features/big/tasks.md', text: bigPlan(12) }];
  const whole = { label: 'big', instruction: 'Implement feature big.' };
  assert.match(firstRunPrompt('BASE', whole, plans), /group 1 of/);
  assert.equal(firstRunPrompt('BASE', whole, plans, { scaffold: true }), 'BASE');
  assert.equal(firstRunPrompt('BASE', { ...whole, instruction: 'Implement big, tasks T1–T6.' }, plans), 'BASE');
  assert.equal(firstRunPrompt('BASE', whole, [{ rel: 't', text: bigPlan(5) }]), 'BASE', 'a small plan is briefed whole');
  assert.equal(firstRunPrompt('BASE', whole, []), 'BASE');
});

test('parsePlanTasks tolerates bracketed and kinded arch refs', () => {
  const [, , t3] = parsePlanTasks(TASKS);
  assert.deepEqual(t3.anchors, ['screen-cart']);
});
