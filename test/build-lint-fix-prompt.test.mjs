// A lint fix is a one-line edit that used to cost a full writer run, because
// the brief said "fix these problems in <file>" and the writer re-read the
// whole document to find the line. The brief now carries the offending lines
// with a little context and says to edit in place.
//
// Pure: drives lib/lint-fix.js; no engine, no disk.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lintFixPrompt, violationContext } from '../lib/lint-fix.js';

const ARCH = `---
spec-version: v2
feature: checkout
---

# Checkout architecture

## Data

### Entity: Order
- **module:** api
- **defined-in:** gspec/features/checkout/arch.md

Prose about orders that a fix must not need to read.

## API

### Endpoint: post /orders
- **module:** api

## UI

**Not Applicable** — headless.

## Logic

**Not Applicable** — CRUD only.
`;

const TASKS = `---
feature: checkout
---

## Plan

- [ ] **T1** Create the order model in \`src/order.ts\`
  - deps: none
  - covers: "User can place an order"
  - arch: #entity-order
- [ ] **T2** [P] Wire the endpoint
  - deps: T1
  - covers: "User can place an order"
  - arch: #endpoint-post-orders
- [ ] **T3** [P] Add the route test
  - deps: T2
  - arch: #entity-ordr
`;

test('the context slice is the offending line with ±3 lines, numbered', () => {
  const v = 'gspec/features/checkout/arch.md: heading "### Endpoint: post /orders" does not match the anchor grammar for ## API (### Endpoint: <METHOD> </path>)';
  const ctx = violationContext(ARCH, v);
  assert.ok(ctx, 'the quoted heading must be located');
  const hit = ctx.lines.find((l) => l.includes('### Endpoint: post /orders'));
  assert.ok(hit, 'the slice contains the offending line');
  assert.equal(ctx.lines.length, 7, 'three lines either side');
  assert.match(ctx.lines[0], /^\s*\d+ \| /, 'lines are numbered');
});

test('the prompt inlines the slice and not the whole document', () => {
  const v = 'gspec/features/checkout/arch.md: heading "### Endpoint: post /orders" does not match the anchor grammar for ## API (### Endpoint: <METHOD> </path>)';
  const p = lintFixPrompt('gspec/features/checkout/arch.md', [v], ARCH);
  assert.match(p, /does not match the anchor grammar/, 'the violation text is carried');
  assert.match(p, /### Endpoint: post \/orders/, 'the offending line is inlined');
  assert.doesNotMatch(p, /Prose about orders/, 'a line outside the radius is not sent');
  assert.doesNotMatch(p, /### Entity: Order/, 'the rest of the document is not sent');
  assert.match(p, /Edit in place at the lines shown/);
  assert.match(p, /do not re-read the whole document/);
  assert.match(p, /Change nothing else\./, 'the convergence guard survives');
});

test('a task id is located by its bold marker in the plan', () => {
  const v = 'gspec/features/checkout/tasks.md: T3 is marked [P] but depends on T2, which is also [P] — tasks marked to run alongside each other cannot depend on one another, so one of the markers is not honest';
  const ctx = violationContext(TASKS, v);
  assert.ok(ctx);
  assert.ok(ctx.lines.some((l) => l.includes('**T3**')), 'the slice is around T3, the task the message is about');
});

test('an anchor quoted by the message is located in the plan', () => {
  const v = 'gspec/features/checkout/tasks.md: task anchor "#entity-ordr" does not resolve to a heading in arch.md';
  const p = lintFixPrompt('gspec/features/checkout/tasks.md', [v], TASKS);
  assert.match(p, /arch: #entity-ordr/);
});

test('a message nothing can locate degrades to the message alone', () => {
  const v = 'gspec/features/checkout/arch.md: missing the "## Data" section — all four of Data, API, UI, Logic must be present';
  const ctx = violationContext('# nothing here\n', v);
  assert.equal(ctx, null);
  const p = lintFixPrompt('gspec/features/checkout/arch.md', [v], '# nothing here\n');
  assert.match(p, /missing the "## Data" section/);
  assert.doesNotMatch(p, /lines \d+–\d+ of/);
  assert.match(p, /Locate each by the text it quotes/);
});

test('no document text at all is the old prompt', () => {
  const p = lintFixPrompt('gspec/style.md or gspec/style.html', ['gspec/style.html is missing its first-line "<!-- spec-version: v2 -->" comment.'], '', { extraGuidance: ['extra line'] });
  assert.match(p, /Fix these mechanical problems in gspec\/style\.md or gspec\/style\.html/);
  assert.match(p, /- gspec\/style\.html is missing/);
  assert.match(p, /extra line/);
  assert.doesNotMatch(p, /```/);
});
