// Unit tests for the feature-folder lint. These are the checks the agent
// validators no longer have to spend a run discovering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archLintViolations, designLintViolations, planLintViolations,
  originAnchors, slugifyAnchor,
} from './plan-lint.mjs';

const ARCH = `---
spec-version: v2
feature: checkout
module: api
---

## Data

### Entity: Order
- **module:** api
- **defined-in:** gspec/features/checkout/arch.md

## API

### Endpoint: POST /orders
- **defined-in:** gspec/features/checkout/arch.md

## UI

### Screen: Cart
- **defined-in:** gspec/features/checkout/arch.md

## Logic

**Not Applicable** — no rules beyond CRUD.
`;

test('a well-formed arch.md is clean', () => {
  assert.deepEqual(archLintViolations('a/arch.md', ARCH), []);
});

test('every one of the four sections must be accounted for', () => {
  const missing = ARCH.replace(/## Logic[\s\S]*$/, '');
  const v = archLintViolations('a/arch.md', missing);
  assert.equal(v.length, 1);
  assert.match(v[0], /missing the "## Logic" section/);
});

test('anchor grammar is enforced per section', () => {
  const v = archLintViolations('a/arch.md', ARCH.replace('### Entity: Order', '### The Order Entity'));
  assert.match(v[0], /does not match the anchor grammar for ## Data/);

  // An endpoint under Data is a real misfile, not just a typo.
  const misfiled = archLintViolations('a/arch.md', ARCH.replace('### Entity: Order', '### Endpoint: GET /orders'));
  assert.match(misfiled[0], /anchor grammar for ## Data/);
});

test('a Not Applicable section that then specifies itself is flagged', () => {
  const v = archLintViolations('a/arch.md', ARCH.replace(
    '**Not Applicable** — no rules beyond CRUD.',
    '**Not Applicable** — no rules.\n\n### Rule: Sneaky\n'));
  assert.match(v[0], /marked Not Applicable but still defines/);
});

test('duplicate anchors within a file are flagged', () => {
  const dup = ARCH.replace('## API\n', '### Entity: Order\n\n## API\n');
  assert.ok(archLintViolations('a/arch.md', dup).some((m) => /duplicate anchor/.test(m)));
});

test('two origins for one anchor across features is caught deterministically', () => {
  // The backstop for the race the serial fan-out prevents: durable feature
  // folders cannot tolerate two definitions silently disagreeing.
  const other = ARCH.replaceAll('gspec/features/checkout/arch.md', 'gspec/features/billing/arch.md');
  const v = archLintViolations('gspec/features/checkout/arch.md', ARCH,
    { 'gspec/features/billing/arch.md': other });
  assert.ok(v.some((m) => /also defined as an origin/.test(m)), v.join('\n'));

  // The same anchor as a DELTA elsewhere is correct and must not be flagged.
  const delta = other
    .replaceAll('- **defined-in:** gspec/features/billing/arch.md', '- **amends:** gspec/features/checkout/arch.md');
  assert.deepEqual(
    archLintViolations('gspec/features/checkout/arch.md', ARCH, { 'gspec/features/billing/arch.md': delta })
      .filter((m) => /origin/.test(m)), []);
});

test('originAnchors distinguishes origins from deltas', () => {
  assert.deepEqual(originAnchors(ARCH).map(([, k]) => k), ['origin', 'origin', 'origin']);
});

test('design screens must match the architecture in both directions', () => {
  const good = '<!-- spec-version: v2 -->\n<section id="screen-cart"><h2>Cart</h2></section>';
  assert.deepEqual(designLintViolations('a/design.html', good, ARCH), []);

  const missing = '<!-- spec-version: v2 -->\n<p>nothing</p>';
  assert.match(designLintViolations('a/design.html', missing, ARCH)[0], /no <section id="screen-cart">/);

  const extra = good + '\n<section id="screen-ghost"></section>';
  assert.match(designLintViolations('a/design.html', extra, ARCH)[0], /has no matching "### Screen:"/);
});

test('a design that reaches the network cannot render standalone', () => {
  const remote = '<section id="screen-cart"><img src="https://cdn.example.com/a.png"></section>';
  assert.ok(designLintViolations('a/design.html', remote, ARCH).some((m) => /must render standalone/.test(m)));
});

test('unchecked task anchors must resolve; checked ones are exempt', () => {
  const tasks = `---
feature: checkout
---

## Plan

- [ ] **T1** build the order model
  - arch: #entity-order
- [ ] **T2** build the ghost
  - arch: #entity-ghost
`;
  const v = planLintViolations('a/tasks.md', tasks, ARCH);
  assert.equal(v.length, 1);
  assert.match(v[0], /#entity-ghost/);

  // A CHECKED task's anchors freeze with it and may point at something a later
  // feature superseded — never a finding, or every mature plan fails QA.
  const done = tasks.replace('- [ ] **T2**', '- [x] **T2**');
  assert.deepEqual(planLintViolations('a/tasks.md', done, ARCH), []);
});

test('slugifyAnchor keeps the anchor KIND — that is what makes fragments unambiguous', () => {
  // A task's `arch: #entity-order` names the whole heading, so an entity and a
  // screen sharing a name still slug differently.
  assert.equal(slugifyAnchor('### Entity: Order'), 'entity-order');
  assert.equal(slugifyAnchor('### Screen: Order'), 'screen-order');
  assert.equal(slugifyAnchor('### Endpoint: POST /orders'), 'endpoint-post-orders');
  // design.html ids are built from the screen NAME alone, prefixed by the caller.
  assert.equal(slugifyAnchor('Order Confirmation'), 'order-confirmation');
});

test('component coverage is NOT enforced here — it cannot be done reliably', () => {
  // A designer writes semantic CSS (`class="item-card"`), not the
  // architecture's identifier (`LibraryItemCard`). Matching them is guesswork,
  // and this lint BLOCKS — a wrong guess stops a build over a correct file.
  // Verified against real output before removing it.
  const arch = ARCH.replace('### Screen: Cart', '### Component: LibraryItemCard');
  assert.deepEqual(designLintViolations('a/design.html', '<div class="item-card"></div>', arch), []);
});

test('documentation ABOUT the markup is not markup', () => {
  // This one failed a real build: a design commented "one <section id=\"screen-*\">
  // per arch.md ### Screen:" and the lint reported `screen-*` as an orphan id.
  const design = [
    '<!-- REQUIRED: one <section id="screen-*"> per "### Screen:" -->',
    '<section id="screen-cart"><h2>Cart</h2></section>',
  ].join('\n');
  assert.deepEqual(designLintViolations('a/design.html', design, ARCH), []);
});

test('a commented-out remote reference is not a remote reference', () => {
  const design = '<!-- <img src="https://cdn.example.com/a.png"> -->\n<section id="screen-cart"></section>';
  assert.deepEqual(designLintViolations('a/design.html', design, ARCH), []);
});

test('a design may carry its own scaffolding sections', () => {
  // Only ids CLAIMING to be a screen/component are held to the mapping — a
  // token swatch or legend is the design's own business.
  const design = '<section id="screen-cart"></section>\n<section id="token-palette"></section>';
  assert.deepEqual(designLintViolations('a/design.html', design, ARCH), []);
});

test('a <style> block is not markup either', () => {
  // The second false positive from the same run: prose inside a CSS comment
  // ("No <section id=\"screen-*\"> wraps this content.") sat in a <style> block,
  // so HTML-comment stripping alone did not reach it.
  const design = [
    '<style>/* one <section id="screen-*"> per "### Screen:" */ .x{color:red}</style>',
    '<section id="screen-cart"></section>',
  ].join('\n');
  assert.deepEqual(designLintViolations('a/design.html', design, ARCH), []);
});

test('an arch: reference is normalized, not dictated', () => {
  // Real plans referenced anchors four different ways, all meaning the same
  // block. A pattern that accepted only "#entity-order" matched NONE of 88 real
  // lines and reported every file clean — verifying nothing.
  const arch = ARCH;
  const forms = [
    'arch: #entity-order',
    'arch: ### Entity: Order',
    'arch: Data > ### Entity: Order',
    'arch: Entity: Order',
    'arch: Data (intro, notes) > ### Entity: Order',        // comma inside an aside
    'arch: Entity: Order (amends gspec/features/x/arch.md)', // provenance aside
  ];
  for (const f of forms) {
    const tasks = `## Plan\n\n- [ ] **T1** do it\n  ${f}\n`;
    assert.deepEqual(planLintViolations('a/tasks.md', tasks, arch), [], `should resolve: ${f}`);
  }
});

test('multiple anchors split on either separator, and a bad one still fails', () => {
  const ok = '## Plan\n\n- [ ] **T1** x\n  arch: Entity: Order; ### Endpoint: POST /orders\n';
  assert.deepEqual(planLintViolations('a/tasks.md', ok, ARCH), []);

  const bad = '## Plan\n\n- [ ] **T1** x\n  arch: Entity: Order, Entity: Ghost\n';
  const v = planLintViolations('a/tasks.md', bad, ARCH);
  assert.equal(v.length, 1);
  assert.match(v[0], /Ghost/);
});
