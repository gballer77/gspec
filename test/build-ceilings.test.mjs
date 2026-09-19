// The ceilings that could strand a large feature, and what now gives before
// the build fails: an adaptive turn cap, slices that scale with the plan, a
// cap-detection fallback, and floor findings that degrade to advisory when
// the implementer cannot satisfy them and verify.sh is green.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { degradableLintFinding } from '../lib/usage.js';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const loop = src.match(/async function runImplementScope[\s\S]*?\n}\n/)[0];

test('a capped run with nothing checked raises the cap before it counts as a stall, up to three times the base', () => {
  assert.match(loop, /let cap = IMPLEMENTER_MAX_TURNS;/);
  assert.match(loop, /const capCeiling = IMPLEMENTER_MAX_TURNS \* 3;/);
  assert.match(loop, /if \(after >= before && cap < capCeiling\) \{\s*cap = Math\.min\(cap \* 2, capCeiling\);\s*raised = true;/);
  assert.match(loop, /maxTurns: cap,/, 'the run is sent the current cap');
  assert.match(loop, /capped at \$\{cap\} engine turns/, 'and told it');
  const raisedAt = loop.indexOf('if (raised) continue;');
  const stallAt = loop.indexOf('if (++stalls >= MAX_STALLS)');
  assert.ok(raisedAt > 0 && raisedAt < stallAt, 'a raised cap skips the stall count');
});

test('the number of slices scales with the unchecked task count', () => {
  assert.match(loop, /const maxRuns = Math\.max\(MAX_SCOPE_RUNS, Math\.ceil\(counts\.unchecked \/ 2\)\);/);
  assert.match(loop, /for \(let run = 1; run <= maxRuns; run\+\+\)/);
  assert.doesNotMatch(loop, /run <= MAX_SCOPE_RUNS/);
});

test('a run that used every allowed turn is capped even when the engine does not say so', () => {
  const fn = src.match(/async function runAgent[\s\S]*?\n}\n/)[0];
  assert.match(fn, /out\.turns >= extra\.maxTurns\) \{\s*out = \{ \.\.\.out, capped: true \};/);
});

test('only missing-work and console-error findings degrade; font and status findings never do', () => {
  assert.equal(degradableLintFinding('t: T3 is checked but api/src/x.ts does not exist — a checked task is the record of work'), true);
  assert.equal(degradableLintFinding('a: render /: a console error — Uncaught TypeError: x'), true);
  assert.equal(degradableLintFinding('a: render /: rendered <body> font-family starts with "Times", not the style guide\'s "Geist"'), false);
  assert.equal(degradableLintFinding('a: render /pantry: HTTP 404, expected 200'), false);
  assert.equal(degradableLintFinding('src/a.ts: contains an unfinished-work marker'), false);
});

test('a repeated, degradable finding with verify.sh green goes to the validator as advisory instead of failing the stage', () => {
  const gate = src.match(/const lintHistory = \[\];[\s\S]*?case 'audit'/)[0];
  assert.match(src, /let verifyGreen = false;/);
  assert.match(src, /verify\.sh passed[\s\S]{0,120}verifyGreen = true;/, 'verify.sh success is recorded, right after it is logged');
  const degrade = gate.indexOf('if (stuck && verifyGreen && findings.every(degradableLintFinding))');
  const fail = gate.indexOf('if (r >= MAX_LINT_ROUNDS || stuck)');
  assert.ok(degrade > 0 && degrade < fail, 'the advisory branch is tried before the failure');
  assert.match(gate, /ctx\.recordAdvisory\(stage, 'the implementation'/);
  assert.match(gate, /advisoryLint = findings;\s*break;/);
  assert.match(gate, /note: advisoryLint\.length/, 'the validator is told');
  assert.match(src, /function validatorPrompt\(stage, target = '', priorVerdict = '', scope = DEFAULT_SCOPE, note = ''\)/);
  assert.match(src, /validatorPrompt\(stage, target, addressed, ctx\.scope, runOpts\.note\)/);
});
