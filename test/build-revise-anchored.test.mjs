// QA findings name the section they are about; writer revisions receive those
// sections rather than re-reading the whole spec. A revision cost 194–243% of
// a first draft on a measured build because the prompt said "read the existing
// document" and appended every prior verdict in full.
//
// Pure: drives lib/revision-brief.js and revisePromptDetailed; no engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings, sliceSections, summarizeRounds, anchoredRevisionBlocks } from '../lib/revision-brief.js';
import { revisePrompt, revisePromptDetailed } from '../lib/build.js';

const DOC = `---
spec-version: v2
---

# Checkout

## Data

### Entity: Order
- **module:** api
- **defined-in:** gspec/features/checkout/arch.md

An order has lines and a total.

### Entity: Coupon
- **module:** api

A coupon reduces a total.

## API

### Endpoint: POST /orders
- **module:** api

Creates an order. Returns 201.

## Logic

**Not Applicable** — CRUD only.
`;

const VERDICT_1 = `VERDICT: FAIL
SPEC: gspec/features/checkout/arch.md
SUMMARY: Two gaps.
FINDINGS:
- [major] Missing edge case — the order total ignores an empty line list
    evidence: "An order has lines and a total."
    anchor: ### Entity: Order
    fix: state the empty-lines total.
- [minor] Vagueness — the status code on a duplicate order is unstated
    evidence: "Creates an order. Returns 201."
    anchor: \`### Endpoint: POST /orders\`
    fix: add the 409 case.
`;

const VERDICT_2 = `VERDICT: FAIL
SPEC: gspec/features/checkout/arch.md
SUMMARY: One gap remains, one is new.
FINDINGS:
- [major] Missing edge case — the order total ignores an empty line list
    evidence: "An order has lines and a total."
    anchor: ### Entity: Order
    fix: state the empty-lines total.
- [major] Hidden assumption — coupons stack silently
    evidence: "A coupon reduces a total."
    fix: say whether coupons stack.
`;

test('parsed findings carry severity, criterion, evidence and anchor', () => {
  const f = parseFindings(VERDICT_1);
  assert.equal(f.length, 2);
  assert.equal(f[0].severity, 'major');
  assert.equal(f[0].criterion, 'Missing edge case');
  assert.equal(f[0].anchor, '### Entity: Order');
  assert.equal(f[0].evidence, 'An order has lines and a total.');
  assert.equal(f[1].anchor, '### Endpoint: POST /orders', 'backticks around the anchor are stripped');
  assert.match(f[1].text, /fix: add the 409 case\./, 'the whole block is kept verbatim');
});

test('a line: anchor and a bold severity are both understood', () => {
  const f = parseFindings('FINDINGS:\n- **[blocker]** Broken — x\n    anchor: line: 42\n- [nit] Polish — y\n    line: 7\n');
  assert.equal(f[0].line, 42);
  assert.equal(f[0].anchor, null);
  assert.equal(f[1].line, 7);
});

test('sliceSections returns the named section only, to the next heading of the same or higher level', () => {
  const [order] = sliceSections(DOC, ['### Entity: Order']);
  assert.equal(order.found, true);
  assert.match(order.text, /^### Entity: Order/);
  assert.match(order.text, /lines and a total/);
  assert.doesNotMatch(order.text, /Coupon/);
  const [data] = sliceSections(DOC, ['## Data']);
  assert.match(data.text, /Coupon/);
  assert.doesNotMatch(data.text, /POST \/orders/);
});

test('sliceSections tolerates a kinded reference without its hashes, and reports a miss', () => {
  const [ep, missing] = sliceSections(DOC, ['Endpoint: POST /orders', '### Entity: Nothing']);
  assert.equal(ep.found, true);
  assert.match(ep.text, /Returns 201/);
  assert.equal(missing.found, false);
});

test('a line locator yields a window around that line', () => {
  const [w] = sliceSections(DOC, [{ line: 9 }], { radius: 2 });
  assert.equal(w.found, true);
  assert.match(w.text, /### Entity: Order/);
  assert.equal(w.text.split('\n').length, 5);
});

test('the prompt inlines the anchored section and not the whole document', () => {
  const stage = { title: 'Feature architecture' };
  const { prompt, anchored, unanchored } = revisePromptDetailed(stage, 'gspec/features/checkout/arch.md', [VERDICT_1], '', DOC);
  assert.equal(anchored, true);
  assert.equal(unanchored.length, 0);
  assert.match(prompt, /the sections below are the only ones to edit/);
  assert.match(prompt, /open the file only to apply these edits/);
  assert.match(prompt, /ONLY the edits the findings name/);
  assert.match(prompt, /### Entity: Order/);
  assert.match(prompt, /### Endpoint: POST \/orders/);
  assert.doesNotMatch(prompt, /Entity: Coupon/, 'a section no finding names is not sent');
  assert.doesNotMatch(prompt, /CRUD only/, 'nor is the rest of the document');
  // The hard-won rules survive verbatim.
  assert.match(prompt, /Precedence, when two of these rules pull against each other/);
  assert.match(prompt, /~10%/);
  assert.match(prompt, /gspec-memory/);
  assert.ok(prompt.indexOf('Precedence') < prompt.indexOf('~10%'));
});

test('a second-round prompt carries the round-1 one-liner and the full round-2 findings', () => {
  const stage = { title: 'Feature architecture' };
  const { prompt } = revisePromptDetailed(stage, 'gspec/features/checkout/arch.md', [VERDICT_1, VERDICT_2], '', DOC);
  assert.match(prompt, /--- Earlier rounds ---/);
  assert.match(prompt, /Round 1 asked for: \[major\] Missing edge case @ ### Entity: Order \(reappeared\); \[minor\] Vagueness @ ### Endpoint: POST \/orders \(resolved\)\./);
  assert.match(prompt, /Verdict 2 of 2 \(current — fix this one\)/);
  assert.match(prompt, /coupons stack silently/);
  // The round-1 verdict is NOT pasted in full.
  assert.doesNotMatch(prompt, /SUMMARY: Two gaps\./);
  assert.doesNotMatch(prompt, /fix: add the 409 case/);
  assert.match(prompt, /marked "reappeared" means the earlier fix did not land/);
});

test('an anchorless finding falls back to its evidence quote and is flagged', () => {
  const stage = { title: 'Feature architecture' };
  const { prompt, unanchored, anchored } = revisePromptDetailed(stage, 'gspec/features/checkout/arch.md', [VERDICT_2], '', DOC);
  assert.equal(anchored, true, 'one anchored finding is enough to use the lean shape');
  assert.equal(unanchored.length, 1);
  assert.equal(unanchored[0].criterion, 'Hidden assumption');
  assert.match(unanchored[0].reason, /no anchor/);
  assert.match(prompt, /no anchor given by the validator; locate this one by its evidence quote \("A coupon reduces a total\."\)/);
  assert.match(prompt, /### Entity: Order/, 'the anchored one is still inlined');
});

test('an anchor that resolves nowhere is flagged, not silently dropped', () => {
  const v = 'FINDINGS:\n- [major] Gap — x\n    evidence: "q"\n    anchor: ### Entity: Ghost\n';
  const { blocks, unanchored } = anchoredRevisionBlocks(v, DOC);
  assert.equal(unanchored.length, 1);
  assert.match(unanchored[0].reason, /not found in the document/);
  assert.match(blocks[0], /was not found in the document/);
});

test('with no document, or no anchored finding at all, the prompt is the legacy shape', () => {
  const stage = { title: 'Feature architecture' };
  const noDoc = revisePromptDetailed(stage, 't', [VERDICT_1], '', '');
  assert.equal(noDoc.anchored, false);
  assert.match(noDoc.prompt, /read the existing document and make ONLY the edits/);
  const prose = revisePromptDetailed(stage, 't', ['VERDICT: FAIL\nthe whole thing is vague'], '', DOC);
  assert.equal(prose.anchored, false);
  assert.match(prose.prompt, /Verdict 1 of 1/);
  // A verdict whose findings ALL lack anchors is legacy too, and every one is flagged.
  const none = revisePromptDetailed(stage, 't', [VERDICT_2.replace(/\n\s+anchor:.*$/m, '')], '', DOC);
  assert.equal(none.anchored, false);
  assert.equal(none.unanchored.length, 2);
  // The string form is the prompt.
  assert.equal(revisePrompt(stage, 't', [VERDICT_1], '', ''), noDoc.prompt);
});

test('summarizeRounds handles a prose verdict without findings', () => {
  const [line] = summarizeRounds(['VERDICT: FAIL\nSUMMARY: the retry policy is unstated everywhere'], []);
  assert.match(line, /^Round 1 asked for: the retry policy is unstated everywhere/);
});

// --- shapes a validator was observed writing that the contract did not name ---

const HEADING_SHAPED = `## VERDICT: FAIL

## SPEC
gspec/features/recipe-catalog/arch.md

## FINDINGS

### 1. [MAJOR] Incomplete "Rule: No Derived Copy" definition

**Location:** Lines 12–14
**Evidence:**
\`\`\`
### Rule: No Derived Copy
- **module:** web
\`\`\`
The rule is listed with metadata but contains no description.

**Fix:** Add a description.

---

### 2. [MINOR] Imprecise reference

**Location:** Line 3
**Evidence:**
> Timeout for every call is fixed once.

**Fix:** name the place.
`;

test('numbered-heading findings with bold keys and Location lines are parsed', () => {
  const f = parseFindings(HEADING_SHAPED);
  assert.equal(f.length, 2);
  assert.equal(f[0].severity, 'major');
  assert.equal(f[0].criterion, 'Incomplete "Rule: No Derived Copy" definition');
  assert.equal(f[0].line, 12, 'Location: Lines a–b becomes a line locator');
  assert.equal(f[0].evidence, '### Rule: No Derived Copy', 'a fenced evidence block yields its first line');
  assert.equal(f[1].line, 3);
  assert.equal(f[1].evidence, 'Timeout for every call is fixed once.', 'a quoted evidence line loses its >');
});

test('a heading-shaped verdict takes the lean path with line locators', () => {
  const doc = Array.from({ length: 20 }, (_, i) => (i === 11 ? '### Rule: No Derived Copy' : `line ${i + 1}`)).join('\n');
  const { anchored, findingsCount, prompt } = revisePromptDetailed({ title: 'x' }, 't', [HEADING_SHAPED], '', doc);
  assert.equal(findingsCount, 2);
  assert.equal(anchored, true);
  assert.match(prompt, /### Rule: No Derived Copy/);
});

test('an anchor into another file is sliced from that file when it is supplied', () => {
  const verdict = 'VERDICT: FAIL\nFINDINGS:\n- [minor] Altitude — fields enumerated\n    evidence: "x"\n    anchor: gspec/architecture/api.md → ### Entity: PantryItem\n    fix: cut the list.\n';
  const api = '# api\n\n## Data\n\n### Entity: PantryItem\n- **module:** api\n\nA pantry item has a quantity.\n\n### Entity: Other\n';
  const withDoc = anchoredRevisionBlocks(verdict, DOC, { docs: { 'gspec/architecture/api.md': api } });
  assert.equal(withDoc.unanchored.length, 0);
  assert.match(withDoc.blocks[0], /gspec\/architecture\/api\.md → ### Entity: PantryItem/);
  assert.match(withDoc.blocks[0], /A pantry item has a quantity\./);
  assert.doesNotMatch(withDoc.blocks[0], /Entity: Other/);
  const without = anchoredRevisionBlocks(verdict, DOC);
  assert.equal(without.unanchored.length, 1);
  assert.match(without.unanchored[0].reason, /names a file that was not read/);
});

test('a FAIL with no parsable finding is reported as such, not as "no anchors"', () => {
  const r = revisePromptDetailed({ title: 'x' }, 't', ['VERDICT: FAIL\nThe whole thing is vague and I will not itemize it.'], '', DOC);
  assert.equal(r.findingsCount, 0);
  assert.equal(r.anchored, false);
  assert.equal(r.unanchored.length, 0);
});

test('the driver reads files named by anchors and logs the no-findings fallback', async () => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { REPO_ROOT } = await import('./helpers.mjs');
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  const fn = src.match(/async function reviseBrief[\s\S]*?\n}\n/)[0];
  assert.match(fn, /fileAnchor\(f\.anchor\)/);
  assert.match(fn, /docs\[fa\.file\] = text/);
  assert.match(fn, /returned no finding in the gspec-qa shape/);
});
