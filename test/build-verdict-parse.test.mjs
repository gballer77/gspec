// Verdict parsing. A validator wrote `## VERDICT: **PASS**` — markdown bold —
// and the parser, which demanded the bare word after optional whitespace, read
// it as NO VERDICT AT ALL. The driver then treated unparseable like FAIL: a
// revision spent, then the build halted, on a plan the checker had just
// approved. Emphasis carries no meaning here; step over it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const parseVerdict = eval(`(${src.match(/function parseVerdict[\s\S]*?\n}/)[0].replace('function parseVerdict', 'function')})`);

test('a decorated verdict is still a verdict', () => {
  for (const [text, want] of [
    ['## VERDICT: **PASS**', 'PASS'],      // the one that failed a real build
    ['VERDICT: PASS', 'PASS'],
    ['VERDICT: __PASS__', 'PASS'],         // underscore is a word char — \b cannot help
    ['VERDICT: `FAIL`', 'FAIL'],
    ['**VERDICT:** FAIL', 'FAIL'],
    ['VERDICT: "PASS"', 'PASS'],
    ['#### VERDICT:   **fail**', 'FAIL'],
  ]) assert.equal(parseVerdict(text), want, `for ${JSON.stringify(text)}`);
});

test('a word that merely starts with the verdict is not one', () => {
  assert.equal(parseVerdict('VERDICT: PASSABLE'), null);
  assert.equal(parseVerdict('VERDICT: FAILURE'), null);
  assert.equal(parseVerdict('no verdict anywhere'), null);
});

test('the first verdict in the text wins', () => {
  // A validator recaps prior findings before its own verdict; the recap must not
  // be mistaken for the ruling when it comes first.
  assert.equal(parseVerdict('VERDICT: FAIL\nlater text mentioning VERDICT: PASS'), 'FAIL');
});
