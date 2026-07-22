// Unit tests for the task-immutability guard. Run: node --test plugin/hooks/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedBlocks, projectedContent, violations } from './gspec-task-immutability.mjs';

const PLAN = `---
feature: checkout
spec-version: v1
---

## Plan

- [x] **T1** **P0** Add the cart schema
  deps: none
  covers: "User can add items to a cart"
- [ ] **T2** [P] **P0** Build the cart API
  deps: T1
  covers: "User can view their cart"
- [x] **T3** **P1** Wire the checkout button
  deps: T2
  covers: "User can begin checkout"
`;

test('checkedBlocks captures only checked task blocks, verbatim', () => {
  const blocks = checkedBlocks(PLAN);
  assert.deepEqual([...blocks.keys()].sort(), ['1', '3']);
  assert.ok(blocks.get('1').startsWith('- [x] **T1**'));
  assert.ok(blocks.get('1').includes('covers: "User can add items to a cart"'));
  assert.ok(!blocks.has('2')); // unchecked → not frozen
});

test('appending a new task leaves checked blocks intact', () => {
  const added = PLAN + `- [ ] **T4** **P1** Rework checkout button\n  deps: T2\n  covers: "User can begin checkout"\n  supersedes: T3\n`;
  const result = projectedContent(PLAN, 'Write', { content: added });
  assert.deepEqual(violations(PLAN, result), []);
});

test('flipping an unchecked task to checked is allowed', () => {
  const result = projectedContent(PLAN, 'Edit', {
    old_string: '- [ ] **T2** [P] **P0** Build the cart API',
    new_string: '- [x] **T2** [P] **P0** Build the cart API',
  });
  assert.deepEqual(violations(PLAN, result), []);
});

test('editing a checked task body is a violation', () => {
  const result = projectedContent(PLAN, 'Edit', {
    old_string: 'covers: "User can add items to a cart"',
    new_string: 'covers: "User can add items to a wishlist"',
  });
  assert.deepEqual(violations(PLAN, result), ['1']);
});

test('unchecking a completed task is a violation', () => {
  const result = projectedContent(PLAN, 'Edit', {
    old_string: '- [x] **T3** **P1** Wire the checkout button',
    new_string: '- [ ] **T3** **P1** Wire the checkout button',
  });
  assert.deepEqual(violations(PLAN, result), ['3']);
});

test('deleting a checked task via a rewrite is a violation', () => {
  const rewritten = PLAN.replace(/- \[x\] \*\*T3\*\*[\s\S]*$/, '');
  const result = projectedContent(PLAN, 'Write', { content: rewritten });
  assert.deepEqual(violations(PLAN, result), ['3']);
});

test('reordering checked blocks without altering them is allowed', () => {
  const t1 = checkedBlocks(PLAN).get('1');
  const t3 = checkedBlocks(PLAN).get('3');
  // A rewrite that keeps both checked blocks verbatim, in a different order.
  const reordered = `---\nfeature: checkout\nspec-version: v1\n---\n\n## Plan\n\n${t3}\n${t1}\n`;
  const result = projectedContent(PLAN, 'Write', { content: reordered });
  assert.deepEqual(violations(PLAN, result), []);
});

test('MultiEdit that touches a checked task is a violation', () => {
  const result = projectedContent(PLAN, 'MultiEdit', {
    edits: [
      { old_string: 'deps: T1', new_string: 'deps: T1, T0' }, // unchecked T2 — fine on its own
      { old_string: 'Add the cart schema', new_string: 'Add the cart + wishlist schema' }, // checked T1 — violation
    ],
  });
  assert.deepEqual(violations(PLAN, result), ['1']);
});

test('a plan with no checked tasks freezes nothing', () => {
  const fresh = PLAN.replace(/\[x\]/g, '[ ]');
  assert.equal(checkedBlocks(fresh).size, 0);
});
