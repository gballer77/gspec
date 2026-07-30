// A validator that returns no verdict must never become the writer's problem.
//
// Measured on a real build: implementation-validator's connection dropped mid
// response, the driver graded the absence of a VERDICT line as a failure, and
// sent the implementer a "QA revision" whose entire finding was
// "API Error: Connection closed mid-response." There is nothing in the code to
// repair for that. The implementer exited 1 and the build went down.
//
// reviseUntilPass had the protection already. The implement stage's judgment
// gate was a SECOND, hand-rolled loop that never got it — so the fix is one
// shared helper, and these tests pin that both paths use it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');

test('the no-verdict retry exists in exactly one place', () => {
  const helper = src.match(/async function judgeOnce[\s\S]*?\n}\n/);
  assert.ok(helper, 'judgeOnce must exist');
  assert.match(helper[0], /if \(g\.verdict === null\)/, 'it retries when there is no verdict');
  assert.equal((src.match(/the last response carried no verdict/g) || []).length, 1,
    'the retry must not be duplicated — the duplicate is what went stale');
});

test('the implement gate judges through the shared helper', () => {
  const gate = src.match(/const jvTarget = 'the implemented scope';[\s\S]*?case 'audit'/)[0];
  assert.match(gate, /judgeOnce\(stage, jvTarget, '', ctx, jvOpts\)/, 'the first judgment');
  assert.match(gate, /judgeOnce\(stage, jvTarget, addressed, ctx, jvOpts\)/, 'and each re-judgment');
  assert.doesNotMatch(gate, /runAgent\(stage\.validator/, 'it must not call the validator directly again');
});

test('an unvalidated verdict fails the stage instead of driving a revision', () => {
  const gate = src.match(/const jvTarget = 'the implemented scope';[\s\S]*?case 'audit'/)[0];
  const guards = gate.match(/if \(jg\.verdict === null\) \{[\s\S]*?\n      \}/g)
    || gate.match(/if \(jg\.verdict === null\) \{[\s\S]*?\}/g);
  assert.ok(guards && guards.length >= 2,
    'both the first judgment and the revision loop must bail out on unvalidated');
  for (const g of guards) assert.match(g, /could not be validated/);

  // and the bail-out must come before the revision that sends text to the agent
  const nullGuard = gate.indexOf('jg.verdict === null');
  const revision = gate.indexOf('The implementation failed QA');
  assert.ok(nullGuard >= 0 && nullGuard < revision, 'bail out before revising');
});
