#!/usr/bin/env node
// gspec PostToolUse hook — reconcile marker (model-free, passive).
//
// First half of the spec-reconcile pair. Records "this session wrote source
// code" so the Stop hook (gspec-reconcile.mjs) can nag once if the turn ends
// with no matching gspec/ update. Scoped to writes made by THIS session — a
// dirty worktree from earlier work never triggers it. The marker scheme lives
// in the engine-neutral floor module (shared with the Cursor hooks):
//   - write to a source file in the project  → append its path to the marker
//   - write to anything under gspec/         → delete the marker (specs got
//     attention after the code change — the well-behaved flow never nags)
//
// Passive: always exit 0 — never disrupts a run. Fails OPEN.
//
// NOTE: the ./floors/ import resolves at the INSTALLED location
// (.claude/hooks/floors/); this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { recordWrite } from './floors/reconcile.mjs';

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  recordWrite(projectDir, evt.session_id, rel);
  process.exit(0);
} catch {
  process.exit(0); // fail open — never disrupt a run
}
