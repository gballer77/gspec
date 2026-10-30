// The installer writes into a repository it did not author. A committed
// symlink, or a "../" in a name taken from that repo, must not let it write or
// delete anything outside the project and ~/.gspec.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runCli, makeProject, cleanup, isolatedHome, exists } from './helpers.mjs';
import { isContained, isSafeName, realPathOf, writeFileContained } from '../lib/safe-fs.js';

const install = (dir) => runCli(['-t', 'claude', '--models', 'none'], dir, {}, 'y\n');

test('a skill path committed as a symlink to a file outside the project is not written through', async (t) => {
  const dir = await makeProject();
  const outside = await mkdtemp(join(tmpdir(), 'gspec-victim-'));
  t.after(() => cleanup(dir, outside));
  const victim = join(outside, '.bashrc');
  await writeFile(victim, 'export PATH=/usr/bin\n');
  await mkdir(join(dir, '.claude', 'skills', 'gspec-qa'), { recursive: true });
  await symlink(victim, join(dir, '.claude', 'skills', 'gspec-qa', 'SKILL.md'));

  const r = await install(dir);
  assert.notEqual(r.code, 0, 'the install stops');
  assert.match(r.output, /refusing to write .*gspec-qa.*outside the project/s);
  assert.equal(await readFile(victim, 'utf-8'), 'export PATH=/usr/bin\n', 'the file outside is untouched');
});

test('a symlinked directory pointing outside the project is refused too', async (t) => {
  const dir = await makeProject();
  const outside = await mkdtemp(join(tmpdir(), 'gspec-victim-'));
  t.after(() => cleanup(dir, outside));
  await mkdir(join(dir, '.claude'), { recursive: true });
  await symlink(outside, join(dir, '.claude', 'skills'));
  const r = await install(dir);
  assert.notEqual(r.code, 0);
  assert.deepEqual(await readdir(outside), [], 'nothing was created outside');
});

test('a symlink that stays inside the project still works (CLAUDE.md -> AGENTS.md)', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await writeFile(join(dir, 'AGENTS.md'), '# Project notes\n');
  await symlink('AGENTS.md', join(dir, 'CLAUDE.md'));
  const r = await install(dir);
  assert.equal(r.code, 0, r.output);
  assert.match(await readFile(join(dir, 'AGENTS.md'), 'utf-8'), /# Project notes/);
});

test('extension remove will not delete outside the extensions folder', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const home = await isolatedHome();
  await mkdir(join(home, '.gspec', 'memory'), { recursive: true });
  const kept = join(home, '.gspec', 'memory', 'gspec-qa.md');
  await writeFile(kept, '## A reviewed memory\n');
  const r = await runCli(['extension', 'remove', '../memory/gspec-qa'], dir);
  assert.notEqual(r.code, 0);
  assert.match(r.output, /Invalid extension name/);
  assert.ok(await exists(kept));
});

test('restore rejects a spec path that climbs out of the library', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const r = await runCli(['restore', 'stacks/..'], dir);
  assert.notEqual(r.code, 0);
  assert.match(r.output, /Invalid spec path/);
});

test('isSafeName accepts library names and rejects separators, dot-dot and hidden names', () => {
  for (const ok of ['my-saas-stack', 'web', 'Stack_v2', 'next.js-app']) assert.ok(isSafeName(ok), ok);
  for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.hidden', 'a..b', 'has space', null]) assert.ok(!isSafeName(bad), String(bad));
});

test('containment follows dangling and chained symlinks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gspec-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'gspec-out-'));
  t.after(() => cleanup(root, outside));
  await symlink(join(outside, 'not-yet'), join(root, 'dangling'));
  await symlink(join(root, 'dangling'), join(root, 'chain'));
  assert.equal(realPathOf(join(root, 'dangling')), join(await import('node:fs').then((f) => f.realpathSync(outside)), 'not-yet'));
  assert.ok(!isContained(join(root, 'chain'), [root]));
  assert.ok(isContained(join(root, 'new', 'file.md'), [root]));
  await assert.rejects(writeFileContained(join(root, 'dangling'), 'x', 'utf-8', { roots: [root] }), { code: 'GSPEC_OUTSIDE_ROOT' });
  assert.ok(!(await exists(join(outside, 'not-yet'))));
});
