// Codex-specific helper: the turn-start baseline the Stop gate needs.
//
// Claude's task-immutability guard reads the pre-edit file inside PreToolUse.
// Codex has no per-edit moment, so a SessionStart hook snapshots the checked
// state of gspec/tasks/*.md to a session-scoped temp file, and the Stop gate
// compares the current tree against it. This module owns the path scheme + a
// block-count guard so a session can never be trapped in an unfixable loop.

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const DIR = join(tmpdir(), 'gspec-codex');

// One key per (project dir, Codex session).
function key(cwd, sessionId) {
  const h = createHash('sha256').update(String(cwd)).digest('hex').slice(0, 12);
  const s = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
  return `${h}-${s}`;
}

export function baselinePath(cwd, sessionId) {
  return join(DIR, `${key(cwd, sessionId)}.json`);
}
function blockCountPath(cwd, sessionId) {
  return join(DIR, `${key(cwd, sessionId)}.blocks`);
}

export function writeBaseline(cwd, sessionId, snapshot) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(baselinePath(cwd, sessionId), JSON.stringify(snapshot), 'utf-8');
}

export function readBaseline(cwd, sessionId) {
  try { return JSON.parse(readFileSync(baselinePath(cwd, sessionId), 'utf-8')); } catch { return {}; }
}

// Loop guard: how many times we have blocked this session's Stop so far.
export function bumpBlockCount(cwd, sessionId) {
  mkdirSync(DIR, { recursive: true });
  const p = blockCountPath(cwd, sessionId);
  let n = 0;
  try { n = parseInt(readFileSync(p, 'utf-8'), 10) || 0; } catch { /* first block */ }
  n += 1;
  writeFileSync(p, String(n), 'utf-8');
  return n;
}
export function clearBlockCount(cwd, sessionId) {
  rmSync(blockCountPath(cwd, sessionId), { force: true });
}
