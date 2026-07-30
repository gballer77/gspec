// A resumed build must not pay an implementer run to be told there is no work.
//
// Measured on a real dogfood resume: all 88 tasks across six features were
// already checked, and the driver still spent one full implementer run per
// feature discovering that. The implementer is ~95% of a build's input tokens,
// so this is the most expensive no-op in the system.
//
// The skip is narrow on purpose. It cannot fire on a fresh build (every box is
// open), and it skips the AGENT, never the gates — verify.sh, the deterministic
// lint, and the validator all still run against whatever is on disk.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const fn = src.match(/async function runImplementScope[\s\S]*?\n}\n/)[0];

test('a scope with nothing unchecked returns without running the agent', () => {
  const guard = fn.match(/if \(!remaining\) \{[\s\S]*?\n  \}/);
  assert.ok(guard, 'the zero-remaining guard must exist');
  assert.doesNotMatch(guard[0], /runAgent/, 'the guard must not spend an agent run');
  assert.match(guard[0], /return \{ code: 0/, 'and must report success to the caller');
});

test('the guard sits after the count and before the run loop', () => {
  // Order is the whole correctness argument: counting first is what makes the
  // skip safe, and being before the loop is what makes it save anything.
  const count = fn.indexOf('remaining = await countUnchecked');
  const guard = fn.indexOf('if (!remaining)');
  const loop  = fn.indexOf('for (let run = 1');
  assert.ok(count >= 0 && guard > count, 'the guard must read a fresh count');
  assert.ok(loop > guard, 'the guard must precede the run loop');
});

test('a scope with work still reaches the loop', () => {
  // The guard must key on the count being ZERO, not on any weaker condition
  // that could swallow a scope with real work left.
  assert.match(fn, /if \(!remaining\)/);
  assert.doesNotMatch(fn, /if \(remaining <|if \(remaining !==/, 'no looser predicate');
});
