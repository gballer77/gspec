// gspec-skill-write-guard: an agent must not write a skill, and — since every
// committed memory is composed into one on the next install — must not write
// the committed memory store either. Writing there would commit a memory
// without review, which is the same defect by a slower route.
//
// Fails OPEN by contract: a buggy guard must never break an unrelated write.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const HOOKS = join(REPO_ROOT, 'plugin', 'hooks', 'claude');

// Run a hook with a PreToolUse event on stdin. Exit 2 = blocked, 0 = allowed.
function runHook(file, event) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HOOKS, file)]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(event));
  });
}

const write = (file_path, content) => ({ tool_name: 'Write', tool_input: { file_path, content } });

const MEMORY = '## Always require a root README\nOtherwise a reader guesses which folder to open.\n';

// --- skill / memory-store write guard ---

const GUARD = 'gspec-skill-write-guard.mjs';

test('an installed skill is blocked', async () => {
  const r = await runHook(GUARD, write('/p/.claude/skills/gspec-practices/SKILL.md', 'anything'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /gspec-generated skill/);
});

// The gap this closes: .gspec/memory/<skill>.md is composed into the skill on
// every install, so an agent writing it commits a memory with nobody reviewing it.
test('the committed memory store is blocked, and names the reviewed path', async () => {
  for (const p of ['/p/.gspec/memory/gspec-practices.md', '/home/u/.gspec/memory/gspec-architect.md']) {
    const r = await runHook(GUARD, write(p, MEMORY));
    assert.equal(r.code, 2, `${p} must be blocked`);
    assert.match(r.stderr, /COMMITTED memory store/);
    assert.match(r.stderr, /\/gspec-teach/, 'a block that does not say what to do instead just stalls the agent');
    assert.doesNotMatch(r.stderr, /pending|gspec-memorize/, 'never points at the retired recording path');
  }
});

// Bug reports live in memory/gspec/ and are never composed into anything, so
// they are not the committed store and must not be caught by its pattern.
test('a gspec bug report is not treated as the committed store', async () => {
  const r = await runHook(GUARD, write('/home/u/.gspec/memory/gspec/lint-false-positive.md', 'report body'));
  assert.equal(r.code, 0, r.stderr);
});

test('an ordinary source write passes', async () => {
  const r = await runHook(GUARD, write('/p/src/index.js', 'export const x = 1;'));
  assert.equal(r.code, 0, r.stderr);
});

test('the write guard fails open on malformed input', async () => {
  const r = await runHook(GUARD, 'not-an-event');
  assert.equal(r.code, 0);
});
