// The implement stage's self-heal was a REBUILD, not a repair.
//
// It re-sent the entire build prompt with a verdict stapled on — the exact shape
// revisePrompt() exists to prevent, and whose comment explains why: it biases a
// fresh agent toward generating more material instead of fixing what is there.
// Every spec stage routed through revisePrompt; implement did not, and it is the
// most expensive place to get this wrong (the implementer is ~92% of a build's
// input tokens).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { implementRevisePrompt } from '../lib/build.js';

const stage = { title: 'Implementation' };
const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');

test('the revision names the repair, not the original task', () => {
  const p = implementRevisePrompt(stage, 'the implemented scope', ['T1 is wrong']);
  assert.match(p, /SURGICAL repair, not a rebuild/);
  assert.match(p, /leave every other file byte-for-byte/);
  assert.match(p, /T1 is wrong/);
});

test('descoping is named as a non-fix', () => {
  // The cheapest way to satisfy a finding is to delete the thing it is about.
  const p = implementRevisePrompt(stage, 'scope', ['a capability is unimplemented']);
  assert.match(p, /Do not uncheck a task, renumber one, or narrow a capability/);
});

test('every prior finding is carried, oldest first', () => {
  // Attempt N must see what N-1 was told, or it repeats a fix that did not land.
  const p = implementRevisePrompt(stage, 'scope', ['first problem', 'second problem']);
  assert.ok(p.indexOf('first problem') < p.indexOf('second problem'), 'oldest first');
  assert.match(p, /Finding 1 of 2 \(an earlier attempt already tried to fix this\)/);
  assert.match(p, /Finding 2 of 2 \(current — fix this one\)/);
  assert.match(p, /did not land/);
});

test('a single finding is not labelled "1 of 1"', () => {
  const p = implementRevisePrompt(stage, 'scope', ['only problem']);
  assert.doesNotMatch(p, /1 of 1/);
  assert.match(p, /--- Finding ---/);
});

test('the deterministic lint gets its own framing', () => {
  const p = implementRevisePrompt(stage, 'scope', ['x'], { deterministic: true });
  assert.match(p, /deterministic findings/);
});

test('neither implement loop re-sends the whole build prompt', () => {
  // The regression that matters: both loops used to interpolate ${buildPrompt}.
  const gate = src.match(/const lintHistory = \[\][\s\S]*?case 'audit'/)[0];
  assert.doesNotMatch(gate, /\$\{buildPrompt\}/, 'no loop may rebuild from the authoring prompt');
  assert.match(gate, /implementRevisePrompt\(stage, 'this scope', lintHistory/);
  assert.match(gate, /implementRevisePrompt\(stage, jvTarget, qaHistory\)/);
});

test('both loops accumulate history rather than passing one finding', () => {
  const gate = src.match(/const lintHistory = \[\][\s\S]*?case 'audit'/)[0];
  assert.match(gate, /lintHistory\.push\(/);
  assert.match(gate, /qaHistory\.push\(jv\.text\)/);
});
