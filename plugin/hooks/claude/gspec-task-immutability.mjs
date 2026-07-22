#!/usr/bin/env node
// gspec PreToolUse hook — task-immutability guard (model-free).
//
// Once a plan task is checked off (`- [x] **T<n>**`), it is FROZEN: it is the
// historical record of what was actually built. Its text, `deps:`, `covers:`,
// ID, and checked state must never change, and it must never be deleted,
// reordered out of existence, or unchecked. When replanning changes work a
// checked task covered, the correct move is to LEAVE it untouched and APPEND a
// new task (next free ID) carrying `supersedes: T<n>` — history is appended,
// never rewritten.
//
// This hook is the hard floor: it BLOCKS (exit 2) any Write/Edit/MultiEdit to a
// `gspec/tasks/*.md` file that would alter or remove a task already checked on
// disk. The on-disk file (this is a PreToolUse hook) is the baseline — it
// reflects exactly which tasks are "already checked" at the moment of the edit,
// so flipping a currently-unchecked task to `[x]` is allowed while touching an
// already-checked one is not. Fails OPEN: any error, or a non-task file, exits 0
// — a buggy hook must never break a session or block unrelated writes.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// A task block = the `- [ ]/[x] **T<n>** …` line plus its indented follow-on
// lines (`deps:` / `covers:`), up to the next task line. We freeze the CHECKED
// blocks verbatim — "immutable" means byte-for-byte, so any reformat counts.
const TASK_START = /^\s*-\s*\[[ xX]\]\s*\*\*T\d+\*\*/;
const CHECKED_START = /^\s*-\s*\[[xX]\]\s*\*\*T(\d+)\*\*/;

// Map of task id -> verbatim block text (trailing blank lines trimmed) for every
// task that is CHECKED in `content`.
export function checkedBlocks(content) {
  const lines = content.split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (TASK_START.test(l)) starts.push(i); });
  const blocks = new Map();
  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    const m = lines[start].match(CHECKED_START);
    if (!m) continue; // unchecked task — not frozen
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const block = lines.slice(start, end);
    while (block.length && block[block.length - 1].trim() === '') block.pop();
    blocks.set(m[1], block.join('\n'));
  }
  return blocks;
}

// Literal (non-regex) first-occurrence replace — Edit/MultiEdit semantics, with
// no `$&`/`$1` surprises that String.replace(string) would introduce.
function literalReplace(haystack, needle, replacement, all) {
  if (all) return haystack.split(needle).join(replacement);
  const i = haystack.indexOf(needle);
  return i === -1 ? haystack : haystack.slice(0, i) + replacement + haystack.slice(i + needle.length);
}

// The content this tool call would produce, applied to the pre-edit baseline.
export function projectedContent(current, toolName, input = {}) {
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : current;
  if (toolName === 'Edit') {
    if (typeof input.old_string !== 'string') return current;
    return literalReplace(current, input.old_string, input.new_string ?? '', input.replace_all);
  }
  if (toolName === 'MultiEdit') {
    let out = current;
    for (const e of input.edits || []) {
      if (e && typeof e.old_string === 'string') out = literalReplace(out, e.old_string, e.new_string ?? '', e.replace_all);
    }
    return out;
  }
  return current;
}

// IDs of checked tasks whose verbatim block no longer survives in `result`.
export function violations(current, result) {
  const dead = [];
  for (const [id, block] of checkedBlocks(current)) {
    if (!result.includes(block)) dead.push(id);
  }
  return dead;
}

function isTaskFile(rel) {
  return /^gspec\/tasks\/[^/]+\.md$/.test(rel);
}

function main() {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const input = evt?.tool_input || {};
  const filePath = input.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  if (!isTaskFile(rel)) process.exit(0);

  let current;
  try { current = readFileSync(resolve(projectDir, filePath), 'utf-8'); } catch { process.exit(0); } // new file — nothing checked yet
  if (checkedBlocks(current).size === 0) process.exit(0); // nothing frozen yet

  const result = projectedContent(current, evt.tool_name, input);
  const dead = violations(current, result);
  if (dead.length === 0) process.exit(0);

  const ids = dead.map((d) => `T${d}`).join(', ');
  process.stderr.write(
    `gspec task-immutability: ${rel} — this edit would alter or remove checked-off task(s) ${ids}, which are ` +
    `IMMUTABLE once complete. A checked task is the historical record of what was built: its text, deps, covers, ` +
    `ID, and checked state must never change, and it must never be deleted or unchecked. If replanning changed ` +
    `this work, LEAVE the checked task(s) exactly as-is and APPEND a new task (next free ID) carrying ` +
    `"supersedes: ${ids}". Restore the checked task(s) verbatim, then retry.\n`,
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
