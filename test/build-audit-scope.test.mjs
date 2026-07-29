// The audit is the one reader whose cost grows with project age: feature folders
// accumulate for the life of a project, and re-reading unchanged ones finds
// nothing. So it goes incremental — but a silently NARROW audit is worse than a
// slow one, so every case we cannot answer cheaply and correctly falls back to
// a full sweep rather than guessing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { auditScope } from '../lib/build.js';
import { makeProject, cleanup } from './helpers.mjs';

const git = (cwd, ...args) => new Promise((resolve) => {
  const p = spawn('git', args, { cwd, stdio: 'ignore' });
  p.on('close', resolve);
  p.on('error', () => resolve(1));
});

async function repo() {
  const dir = await makeProject();
  await git(dir, 'init', '-q');
  await git(dir, 'config', 'user.email', 't@example.com');
  await git(dir, 'config', 'user.name', 'T');
  await mkdir(join(dir, 'gspec', 'features', 'auth'), { recursive: true });
  await writeFile(join(dir, 'gspec', 'architecture.md'), '# Arch\n');
  await writeFile(join(dir, 'gspec', 'features', 'auth', 'arch.md'), '# Auth\n');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-qm', 'init');
  return dir;
}

const head = (dir) => new Promise((resolve) => {
  const p = spawn('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  let o = ''; p.stdout.on('data', (d) => { o += d; });
  p.on('close', () => resolve(o.trim()));
});

test('no baseline means a full audit — never a silently narrow one', async () => {
  const dir = await repo();
  try {
    assert.equal((await auditScope(dir)).full, true);
  } finally { await cleanup(dir); }
});

test('outside a git repo it stays full — the changed set is unanswerable', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, '.gspec'), { recursive: true });
    await writeFile(join(dir, '.gspec', 'audit-baseline'), 'deadbeef\n');
    assert.equal((await auditScope(dir)).full, true);
  } finally { await cleanup(dir); }
});

test('only the changed feature folders are named', async () => {
  const dir = await repo();
  try {
    await mkdir(join(dir, '.gspec'), { recursive: true });
    await writeFile(join(dir, '.gspec', 'audit-baseline'), `${await head(dir)}\n`);
    await mkdir(join(dir, 'gspec', 'features', 'billing'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'features', 'billing', 'arch.md'), '# Billing\n');
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-qm', 'add billing');

    const scope = await auditScope(dir);
    assert.equal(scope.full, false);
    assert.match(scope.instruction, /gspec\/features\/billing\//);
    assert.doesNotMatch(scope.instruction, /features\/auth\//);
  } finally { await cleanup(dir); }
});

test('a root-tier spec change widens back to a full audit', async () => {
  // stack.md changing can invalidate the inlined claims in ANY feature folder —
  // that is the enrichment drift category, and it is not a per-folder question.
  const dir = await repo();
  try {
    await mkdir(join(dir, '.gspec'), { recursive: true });
    await writeFile(join(dir, '.gspec', 'audit-baseline'), `${await head(dir)}\n`);
    await writeFile(join(dir, 'gspec', 'stack.md'), '# Stack\n\nNow on a different ORM.\n');
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-qm', 'swap orm');

    assert.equal((await auditScope(dir)).full, true);
  } finally { await cleanup(dir); }
});
