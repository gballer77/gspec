// A QA revision must see what earlier attempts were already told — ACROSS runs.
//
// The revision loops built their history in a plain array in-process. Resume the
// build and that array starts empty, so attempt N is handed a blank slate and
// can repeat a fix attempt N-1 was already told did not work. That history is
// exactly what revisePrompt exists to carry ("a finding that reappears means the
// earlier fix did not land — fix it differently"), and a resume silently dropped
// it. The documented workaround was to pass --qa-retries 2 and hope.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');

test('a recorded verdict is persisted to the manifest, not just summarized', () => {
  const fn = src.match(/ctx\.recordFeedback = async[\s\S]*?\n  \};/)[0];
  assert.match(fn, /st\.verdicts \?\?= \{\}/, 'stored per stage');
  assert.match(fn, /list\.push\(text\)/, 'the FULL text, not summarize(text)');
  assert.match(fn, /await saveManifest\(cwd, manifest\)/, 'written to disk immediately');
});

test('the same verdict is not stored twice', () => {
  // recordFeedback is called once per retry with the SAME text while a revision
  // is in flight; without this the history grows by duplicates and the prompt
  // tells the writer a finding "reappeared" when it never went away.
  const fn = src.match(/ctx\.recordFeedback = async[\s\S]*?\n  \};/)[0];
  assert.match(fn, /if \(!list\.includes\(text\)\) list\.push\(text\)/);
});

test('both revision loops seed from the persisted history', () => {
  assert.match(src, /const verdicts = \[\.\.\.ctx\.priorVerdicts\(stage\.id, target\)/, 'the spec-stage loop');
  assert.match(src, /const qaHistory = ctx\.priorVerdicts\(stage\.id, jvTarget\)/, 'the implement loop');
});

test('seeding does not duplicate the verdict that just came back', () => {
  const line = src.match(/const verdicts = \[\.\.\.ctx\.priorVerdicts[^\n]*/)[0];
  assert.match(line, /\.filter\(\(t\) => t !== v\.text\)/);
  assert.match(line, /, v\.text\]/, 'and the current verdict is last');
});

test('a target with no history yields an empty list, not undefined', () => {
  // The loops spread this; undefined would throw at the worst possible moment.
  assert.match(src, /ctx\.priorVerdicts = \(stageId, target\) => manifest\.stages\[stageId\]\?\.verdicts\?\.\[target\]\?\.slice\(\) \?\? \[\]/);
});

test('only a targeted verdict is stored', () => {
  // recordFeedback also carries untargeted events (verify.sh output, lint runs);
  // filing those under a target key would pollute the writer's finding history.
  const fn = src.match(/ctx\.recordFeedback = async[\s\S]*?\n  \};/)[0];
  assert.match(fn, /if \(meta\.target\) \{/);
});
