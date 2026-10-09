// run.json and status.json are what --resume and --status read back; a torn
// write makes a run impossible to resume. Writes are atomic and ordered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, readFile as rf } from 'node:fs/promises'; // rf: same reader, read as text
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic, writeFileAtomicSync } from '../lib/atomic-write.js';

test('concurrent writes land in call order and leave valid JSON, no temp files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-atomic-'));
  const path = join(dir, 'run.json');
  const big = 'x'.repeat(200_000);
  await Promise.all(Array.from({ length: 25 }, (_, i) => writeFileAtomic(path, JSON.stringify({ i, big }) + '\n')));
  const parsed = JSON.parse(await readFile(path, 'utf-8'));
  assert.equal(parsed.i, 24, 'the last call wins');
  assert.deepEqual(await readdir(dir), ['run.json']);
});

test('a failed write rejects, leaves the old file intact, and does not block the next write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-atomic-'));
  const path = join(dir, 'status.json');
  await writeFileAtomic(path, '{"state":"running"}\n');
  await assert.rejects(writeFileAtomic(join(dir, 'missing', 'status.json'), '{}'));
  await assert.rejects(writeFileAtomic(path, Symbol('not data')));
  assert.equal(await rf(path, 'utf-8'), '{"state":"running"}\n');
  await writeFileAtomic(path, '{"state":"complete"}\n');
  assert.equal(await rf(path, 'utf-8'), '{"state":"complete"}\n');
  assert.deepEqual(await readdir(dir), ['status.json']);
});

test('the sync variant (exit handlers) is atomic too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gspec-atomic-'));
  const path = join(dir, 'status.json');
  writeFileAtomicSync(path, '{"state":"crashed"}\n');
  assert.equal(await rf(path, 'utf-8'), '{"state":"crashed"}\n');
  assert.deepEqual(await readdir(dir), ['status.json']);
});
