// Unit tests for the feature-folder lint. These are the checks the agent
// validators no longer have to spend a run discovering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archLintViolations, designLintViolations, planLintViolations,
  originAnchors, anchorRefs, anchorModules, duplicateOrigins, containedAnchors,
  slugifyAnchor, TASK_FIELD, coversQuotes,
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

// The `uses:` stub is what makes a shared anchor's home movable for free: the
// heading stays in the feature's own arch.md, so planLint and designLint keep
// resolving against it unchanged. Classifying it as an origin would make every
// consumer of a spine anchor a duplicate origin — the exact opposite of the job.
test('a uses: stub is its own kind, not an origin', () => {
  const stub = `### Rule: Progressive Enhancement Contract
- **module:** site
- **uses:** gspec/architecture/site.md
`;
  assert.deepEqual(originAnchors(stub).map(([, k]) => k), ['use']);

  // Two features BOTH using one spine anchor is the normal case, not a clash.
  const a = ARCH.replace('## Logic\n\n**Not Applicable** — no rules beyond CRUD.\n', `## Logic\n\n${stub}`);
  const b = a.replaceAll('gspec/features/checkout/arch.md', 'gspec/features/billing/arch.md');
  assert.deepEqual(
    archLintViolations('gspec/features/checkout/arch.md', a, { 'gspec/features/billing/arch.md': b })
      .filter((m) => /Progressive Enhancement/.test(m)),
    []);
});

// C8. Every REFERENCE to an anchor resolves through slugifyAnchor, so a
// punctuation variant is already one anchor to tasks.md and design.html. A `===`
// compare reported that pair clean — a duplicate origin passing in silence.
test('anchor identity is the slug, so a punctuation variant is still a clash', () => {
  const hyphenated = ARCH
    .replace('### Entity: Order', '### Entity: OrderX')  // keep Data unique
    .replace('### Screen: Cart', '### Screen: Shopping Cart');
  const other = ARCH
    .replace('### Entity: Order', '### Entity: OrderX')
    .replace('### Screen: Cart', '### Screen: Shopping-Cart')
    .replaceAll('gspec/features/checkout/arch.md', 'gspec/features/billing/arch.md');

  const v = archLintViolations('gspec/features/checkout/arch.md', hyphenated,
    { 'gspec/features/billing/arch.md': other });
  assert.ok(v.some((m) => /same anchor once slugified/.test(m)), v.join('\n'));

  // …and within one file, too.
  const inFile = ARCH.replace('## API\n', '### Entity: order\n\n## API\n');
  assert.ok(archLintViolations('a/arch.md', inFile).some((m) => /same anchor once slugified/.test(m)));
});

test('anchorRefs carries the target path, which is what O3 turns on', () => {
  const t = `### Screen: Lesson
- **module:** site
- **amends:** gspec/architecture/site.md
`;
  assert.deepEqual(anchorRefs(t), [['### Screen: Lesson', 'delta', 'gspec/architecture/site.md']]);
});

// The ANCHOR carries the module, not the feature: a feature spanning api and web
// declares anchors in both, so feature frontmatter cannot be the unit.
test('anchorModules reads the per-block module line', () => {
  const mods = anchorModules(ARCH);
  assert.equal(mods.get('### Entity: Order'), 'api');
  assert.equal(mods.get('### Screen: Cart'), undefined, 'a block that says nothing claims nothing');
});

test('duplicateOrigins is the work list, keyed by slug across every file', () => {
  const a = '### Rule: Seeded Randomness\n- **defined-in:** a.md\n';
  const b = '### Rule: Seeded-Randomness\n- **defined-in:** b.md\n';
  const c = '### Rule: Something Else\n- **defined-in:** c.md\n';
  const dupes = duplicateOrigins({ 'a.md': a, 'b.md': b, 'c.md': c });
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].slug, 'rule-seeded-randomness');
  assert.deepEqual(dupes[0].sites.map((s) => s.rel), ['a.md', 'b.md']);
});

// Regression: the `]` closing a bracketed `arch:` list rode on the FINAL element
// after the split and defeated the provenance-aside strip, which is anchored to
// end-of-string. A bare anchor survived the same bracket (slugifyAnchor drops it
// as punctuation), so this only ever bit refs carrying a `(…)` aside — which is
// every cross-tier reference, the one thing the two-tier split added. It fired
// nine times in one file on a dogfood build, all false, and the free self-heal
// "fixed" them by abandoning the bracketed format.
test('a bracketed arch: list resolves its last entry, provenance aside and all', () => {
  const arch = '### Endpoint: POST /borrowers\n### Rule: Error Response Contract\n';
  const task = (refs) => `- [ ] **T1** add the endpoint\n  - arch: ${refs}\n`;

  assert.deepEqual(planLintViolations('t.md',
    task('[Endpoint: POST /borrowers, Rule: Error Response Contract (api.md)]'), arch), []);
  // The unbracketed form a self-heal falls back to still works.
  assert.deepEqual(planLintViolations('t.md',
    task('Endpoint: POST /borrowers, Rule: Error Response Contract (api.md)'), arch), []);
  // A single bracketed ref, which is where the bracket and the aside collide.
  assert.deepEqual(planLintViolations('t.md',
    task('[Rule: Error Response Contract (api.md)]'), arch), []);
  // …and the check must still CATCH a genuinely unresolvable anchor, or the fix
  // has just turned it off.
  assert.equal(planLintViolations('t.md', task('[Rule: Nonexistent Thing (api.md)]'), arch).length, 1);
});

// The containment half of "one definition per shared concept" — mechanical, and
// the shape every later writer in build #3 actually used: prefix the canonical
// name with your own feature's name instead of amending it.
test('containedAnchors flags a name that swallows another whole', () => {
  const files = {
    'one.md': '### Rule: Progressive Enhancement Contract\n- **defined-in:** one.md\n',
    'two.md': '### Rule: Glossary Progressive Enhancement Contract\n- **defined-in:** two.md\n',
    'three.md': '### Rule: Accessibility Baseline\n- **defined-in:** three.md\n',
  };
  const hits = containedAnchors(files);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rel, 'two.md', 'the WIDER name is the one that should have amended');
  assert.equal(hits[0].contains.rel, 'one.md');

  // Order carries meaning in a name, and a different kind is a different thing.
  assert.deepEqual(containedAnchors({
    'a.md': '### Rule: Contract Enhancement\n- **defined-in:** a.md\n',
    'b.md': '### Rule: Enhancement Contract Extra\n- **defined-in:** b.md\n',
  }), []);
  // An Endpoint name is a URL PATH, and paths nest by design. Every hit on a
  // dogfood build was this false positive, and all three were fed to the resolve
  // barrier as signal on a run where it had no real work.
  assert.deepEqual(containedAnchors({
    'a.md': '### Endpoint: GET /books\n- **defined-in:** a.md\n',
    'b.md': '### Endpoint: GET /books/:id\n- **defined-in:** b.md\n',
  }), []);
  // Same file means one writer named both, so there was no canonical anchor to
  // amend — the failure this check exists for is a LATER writer prefixing an
  // EARLIER feature's name.
  assert.deepEqual(containedAnchors({
    'a.md': '### Rule: Enhancement Contract\n- **defined-in:** a.md\n### Rule: Glossary Enhancement Contract\n- **defined-in:** a.md\n',
  }), []);
  assert.deepEqual(containedAnchors({
    'a.md': '### Rule: Lesson\n- **defined-in:** a.md\n',
    'b.md': '### Screen: Reader Lesson\n- **defined-in:** b.md\n',
  }), []);
});

// The backstop must not stop checking because a writer emphasised the key
// differently. Classified as NEITHER, an anchor drops out of the uniqueness
// comparison and a real duplicate origin passes in silence — the one failure
// mode this check exists to catch, reported clean.
test('a status line is read however it is emphasised', () => {
  const kinds = (t) => originAnchors(t).map(([, k]) => k);
  for (const key of ['- **defined-in:**', '- defined-in:', '- *defined-in*:', '-  `defined-in`:']) {
    const t = `### Entity: Cart\n${key} gspec/features/checkout/arch.md\n`;
    assert.deepEqual(kinds(t), ['origin'], `origin unreadable when written "${key}"`);
  }
  for (const key of ['- **amends:**', '- amends:', '- *amends*:']) {
    const t = `### Entity: Cart\n${key} gspec/features/checkout/arch.md\n`;
    assert.deepEqual(kinds(t), ['delta'], `delta unreadable when written "${key}"`);
  }
});

// A capability that contains quotation marks can only be written unambiguously
// by escaping them. Caught live in a build: the writer escaped, the parser
// stopped at the first inner quote and produced a fragment ending in a
// backslash, the lint said it "does not appear verbatim in the PRD", and the
// mechanical fix repaired it by REMOVING the escapes — leaving one capability
// as two fragments that each happen to be a PRD substring, so the check passes
// while the link it exists to verify is gone.
test('a covers: capability may contain escaped quotes', () => {
  const escaped = '"A query with no matches shows a clear \\"no results\\" state."';
  assert.deepEqual(
    coversQuotes(escaped),
    ['A query with no matches shows a clear "no results" state.'],
    'an escaped capability is ONE quote, unescaped back to what the PRD actually says',
  );

  // The shapes this function has already been broken on twice. None may move.
  assert.deepEqual(coversQuotes('"first capability" "second capability"'), ['first capability', 'second capability']);
  assert.deepEqual(coversQuotes('"first cap." / "second cap."'), ['first cap.', 'second cap.']);
  assert.deepEqual(coversQuotes('first capability; second capability'), ['first capability', 'second capability']);

  // Unescaped inner quotes are genuinely ambiguous — `"a "b" c"` reads equally
  // as one capability or three — so they are deliberately left as they were
  // rather than guessed at.
  assert.equal(coversQuotes('"A query shows a clear "no results" state."').length, 2);
});

// The same rule on the task side. `- **covers:**` finding nothing means a task
// that covers a capability reads as covering none — silent, in the check whose
// whole job is linking tasks to the PRD.
test('a task field is read however it is emphasised, and its value survives', () => {
  const variants = ['- covers: "ship it"', '- **covers:** "ship it"', 'covers: "ship it"', '- *covers*: "ship it"'];
  for (const line of variants) {
    const m = `  ${line}`.match(TASK_FIELD.covers);
    assert.ok(m, `unreadable: ${line}`);
    assert.equal(m[1], '"ship it"', `value corrupted by emphasis in: ${line}`);
  }
  assert.equal('  - **arch:** Entity: Order'.match(TASK_FIELD.arch)[1], 'Entity: Order');
  assert.equal('  - **deps:** T1, T2'.match(TASK_FIELD.deps)[1], 'T1, T2');
});

test('duplicate origins are caught even when the status line is not bold', () => {
  const plain = ARCH.replaceAll('- **defined-in:**', '- defined-in:');
  const v = archLintViolations('gspec/features/checkout/arch.md', plain, {
    'gspec/features/billing/arch.md': plain,
  }).filter((m) => /is also defined as an origin/.test(m));
  assert.ok(v.length, 'two files originating the same anchors must still collide');
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
