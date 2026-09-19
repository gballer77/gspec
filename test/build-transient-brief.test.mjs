// A retry after an engine error is told which files the interrupted run
// already wrote. The identical brief re-sent to a fresh agent could not see
// work that was written but not recorded, and often redid it.
//
// Pure: drives lib/partial-work.js; the wrapper runs against a temp tree with
// git status injected. No engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partialWorkBrief, partialWorkEvidence } from '../lib/partial-work.js';
import { filesNamedByUncheckedTasks, filesNamedByCheckedTasks } from '../plugin/hooks/floors/implementation-lint.mjs';

const TASKS = `## Plan

- [x] **T1** Scaffold \`package.json\`
- [ ] **T2** Write the model in \`src/a.ts\`
- [ ] **T3** Write the route in \`src/b.ts\` and its test \`src/b.test.ts\`
`;

test('unchecked tasks name their files, checked ones stay where they were', () => {
  assert.deepEqual(filesNamedByUncheckedTasks(TASKS), [
    { id: 'T2', path: 'src/a.ts' }, { id: 'T3', path: 'src/b.ts' }, { id: 'T3', path: 'src/b.test.ts' },
  ]);
  assert.deepEqual(filesNamedByCheckedTasks(TASKS), [{ id: 'T1', path: 'package.json' }]);
});

test('with a named file present, the retry brief carries a Partial work block naming it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-partial-'));
  try {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'tasks.md'), TASKS);
    await writeFile(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    const ev = await partialWorkEvidence(dir, ['tasks.md'], { gitStatus: async () => ' M src/a.ts\n?? src/c.ts\n' });
    assert.deepEqual(ev.present, [{ id: 'T2', path: 'src/a.ts' }]);
    const block = partialWorkBrief(ev);
    assert.match(block, /^Partial work found/);
    assert.match(block, /src\/a\.ts \(T2\)/);
    assert.doesNotMatch(block, /src\/b\.ts/, 'a file that does not exist is not claimed');
    assert.match(block, /src\/c\.ts/, 'git status evidence is carried, status prefix stripped');
    assert.doesNotMatch(block, /\?\? src/);
    assert.match(block, /do not recreate/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('with nothing present and a clean tree, the block is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-partial-'));
  try {
    await writeFile(join(dir, 'tasks.md'), TASKS);
    const ev = await partialWorkEvidence(dir, ['tasks.md']);
    assert.deepEqual(ev, { present: [], gitStatus: null });
    assert.equal(partialWorkBrief(ev), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a git status probe that throws is a null, not a crash', async () => {
  const ev = await partialWorkEvidence('/nonexistent', ['tasks.md'], { gitStatus: async () => { throw new Error('no git'); } });
  assert.equal(ev.gitStatus, null);
  assert.equal(partialWorkBrief(ev), '');
});

test('the implement loop gathers the evidence on the transient path and hands it to the retry', async () => {
  const { readFile } = await import('node:fs/promises');
  const { REPO_ROOT } = await import('./helpers.mjs');
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  const loop = src.match(/async function runImplementScope[\s\S]*?\n}\n/)[0];
  assert.match(loop, /partialWorkEvidence\(ctx\.cwd, files/, 'evidence is gathered from the scope\'s plan files');
  assert.match(loop, /git.*status.*--porcelain/, 'and from the working tree');
  assert.ok(loop.indexOf('partial = partialWorkBrief') < loop.indexOf('retrying = true;'), 'gathered before the retry is marked');
  assert.match(loop, /promptFor\(run, partial\)/, 'the retry prompt carries it');
  assert.match(loop, /if \(looksRateLimited\(out\.text\)\) return out;/, 'a usage limit still surfaces immediately');
});
