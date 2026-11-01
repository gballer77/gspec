#!/usr/bin/env node
// gspec preToolUse hook (Cursor, matcher: Write) — the two HARD write floors.
//
//   1. skill-write guard — a correction becomes a skill change only through the
//      reviewed /gspec-teach path. Blocks a write to an INSTALLED skill under
//      .cursor/skills/ (overwritten on the next install) and to the COMMITTED
//      memory store, .gspec/memory/*.md (composed into those skills on install).
//   2. task-immutability — once a plan task is checked off it is FROZEN.
//      Blocks a write that would alter, delete, or uncheck a task that is
//      checked on disk. Replanning appends a new task with `supersedes: T<n>`.
//
// Same rules as the Claude PreToolUse pair; the decision logic for (2) lives in
// the engine-neutral floor module. Blocks by returning permission "deny" with
// the reason as agent_message. Fails OPEN: any error, or a write whose input
// shape we cannot read, answers allow — the stop hook's tree scan re-checks
// task-immutability at the end of the turn.
//
// NOTE: ./floors/ resolves at the INSTALLED location (.cursor/hooks/floors/);
// this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkedBlocks, projectedContent, violations } from './floors/task-immutability.mjs';
import { isPlanDoc } from './floors/paths.mjs';
import {
  readEvent, projectDir, toolInput, filePathOf, relPath, writeShape, claudeShapedInput, allow, deny,
} from './event.mjs';

const norm = (p) => String(p).replace(/\\/g, '/');

function isInstalledSkill(p) {
  return /(^|\/)\.cursor\/skills\//.test(norm(p));
}

// Committed store only — `memory/gspec/...` (bug reports, never composed) sits
// a directory deeper and is excluded by requiring a direct child of `memory/`.
function isCommittedMemory(p) {
  return /(^|\/)\.gspec\/memory\/[^/]+\.md$/.test(norm(p));
}

function skillWriteBlock(filePath) {
  if (isCommittedMemory(filePath)) {
    return `gspec skill-write guard: ${filePath} is the COMMITTED memory store — it is composed into the matching skill ` +
      `on every install, so writing it directly commits a memory without review. Only /gspec-teach writes ` +
      `here, once a human approves the change.`;
  }
  if (isInstalledSkill(filePath)) {
    return `gspec skill-write guard: ${filePath} is a gspec-generated skill (installed artifact) — do not edit it ` +
      `directly; it is overwritten on the next \`gspec\` install. To change agent behavior durably, edit the gspec ` +
      `SOURCE skill and reinstall, or teach the correction with /gspec-teach — the reviewed path (the ` +
      `memorizer proposes, you approve).`;
  }
  return null;
}

function taskImmutabilityBlock(dir, filePath, rel, input) {
  if (!isPlanDoc(rel)) return null;
  const shape = writeShape(input);
  if (!shape) return null; // unreadable input — the stop scan backstops it

  let current;
  try { current = readFileSync(resolve(dir, filePath), 'utf-8'); } catch { return null; } // new file
  if (checkedBlocks(current).size === 0) return null; // nothing frozen yet

  const dead = violations(current, projectedContent(current, shape, claudeShapedInput(input)));
  if (dead.length === 0) return null;

  const ids = dead.map((d) => `T${d}`).join(', ');
  return `gspec task-immutability: ${rel} — this edit would alter or remove checked-off task(s) ${ids}, which are ` +
    `IMMUTABLE once complete. A checked task is the historical record of what was built: its text, deps, covers, ` +
    `ID, and checked state must never change, and it must never be deleted or unchecked. If replanning changed ` +
    `this work, LEAVE the checked task(s) exactly as-is and APPEND a new task (next free ID) carrying ` +
    `"supersedes: ${ids}". Restore the checked task(s) verbatim, then retry.`;
}

try {
  const evt = readEvent();
  const filePath = filePathOf(evt);
  if (!filePath) allow();

  const skill = skillWriteBlock(filePath);
  if (skill) deny(skill);

  const dir = projectDir(evt);
  const rel = relPath(dir, filePath);
  const task = taskImmutabilityBlock(dir, filePath, rel, toolInput(evt));
  if (task) deny(task);

  allow();
} catch {
  allow(); // fail open
}
