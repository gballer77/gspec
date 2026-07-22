#!/usr/bin/env node
// gspec PreToolUse hook (Claude) — task-immutability adapter (model-free).
//
// Once a plan task is checked off (`- [x] **T<n>**`), it is FROZEN: replanning
// must APPEND a new task (carrying `supersedes: T<n>`), never edit, delete, or
// uncheck a checked one. This adapter BLOCKS (exit 2) any Write/Edit/MultiEdit
// to a `gspec/tasks/*.md` file that would alter a task already checked on disk.
// The on-disk file is the baseline (this is PreToolUse), so flipping a currently
// unchecked task to `[x]` is allowed while touching a checked one is not.
// Decision logic lives in the engine-neutral floor module. Fails OPEN.
//
// NOTE: the ./floors/ import resolves at the INSTALLED location
// (.claude/hooks/floors/); this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { checkedBlocks, projectedContent, violations } from './floors/task-immutability.mjs';

function isTaskFile(rel) {
  return /^gspec\/tasks\/[^/]+\.md$/.test(rel);
}

try {
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
} catch {
  process.exit(0); // fail open
}
