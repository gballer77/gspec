// A writer retried after a crash continues its partial draft instead of
// re-authoring. runWriterResilient retried once with the identical prompt,
// re-paying the whole authoring context for a file that was half there.
//
// Pure: the retry prompt builder, plus a source check on the loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { writerRetryPrompt } from '../lib/build.js';

test('with a partial artifact present the retry prompt carries the continue instruction, first', () => {
  const p = writerRetryPrompt('Write gspec/stack.md.', ['gspec/stack.md']);
  assert.match(p, /^A partial draft exists at `gspec\/stack\.md`; read it, keep what is correct, and complete it — do not start over\./);
  assert.match(p, /Write gspec\/stack\.md\.$/, 'the original brief follows');
});

test('several partial files are all named', () => {
  const p = writerRetryPrompt('x', ['gspec/architecture.md', 'gspec/architecture/api.md']);
  assert.match(p, /`gspec\/architecture\.md`, `gspec\/architecture\/api\.md`/);
});

test('with no artifact the prompt is untouched', () => {
  assert.equal(writerRetryPrompt('Write it.', []), 'Write it.');
  assert.equal(writerRetryPrompt('Write it.'), 'Write it.');
});

test('the retry path looks for the partial, tags the run continuation, and every writer names its deliverable', async () => {
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  const fn = src.match(/async function runWriterResilient[\s\S]*?\n}\n/)[0];
  assert.match(fn, /partialArtifacts\(ctx\.cwd, extra\.artifactPaths\)/);
  assert.match(fn, /writerRetryPrompt\(prompt, partial\)/);
  assert.match(fn, /kind: partial\.length \? 'continuation' : 'transient-retry'/);
  // The callers that can name their deliverable do.
  const calls = [...src.matchAll(/runWriterResilient\(\s*[^;]*?\)\s*;/gs)].map((m) => m[0]).filter((c) => !c.startsWith('runWriterResilient(agentName'));
  const naming = calls.filter((c) => /artifactPaths/.test(c));
  assert.ok(naming.length >= 7, `expected most writer call sites to pass artifactPaths, got ${naming.length} of ${calls.length}`);
  assert.match(src, /lint: opts\.lint, outputsOk, artifactPaths: resolveTargets/, 'the gate lint loop forwards the deliverable set');
  assert.match(src, /\{ kind: 'revision', artifactPaths \}/, 'the revise loop forwards it');
});
