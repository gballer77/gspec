#!/usr/bin/env node
// gspec Stop hook — spec reconcile nudge (model-free, advisory).
//
// Second half of the spec-reconcile pair. gspec-reconcile-marker.mjs (the
// PostToolUse half) records source files this session wrote; if the turn is
// ending and that marker still exists — code changed, nothing under gspec/
// did — this blocks the stop ONCE (exit 2) listing the files, so the agent
// reconciles the affected specs or confirms there is no spec impact. The
// marker is consumed on first fire, so the agent's follow-up (spec edits or
// "no impact") stops cleanly; whether spec impact exists is the model's call.
// Fails OPEN: any error exits 0 — never traps a session.
//
// NOTE: the ./floors/ import resolves at the INSTALLED location
// (.claude/hooks/floors/); this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { takeRecordedFiles, discardRecordedFiles, reconcileMessage } from './floors/reconcile.mjs';

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();

  // Loop guard: this hook already blocked this stop — consume and let it end.
  if (evt.stop_hook_active) {
    discardRecordedFiles(projectDir, evt.session_id);
    process.exit(0);
  }

  const files = takeRecordedFiles(projectDir, evt.session_id);
  if (files.length === 0) process.exit(0); // no marker — nothing to nag

  process.stderr.write(reconcileMessage(files));
  process.exit(2);
} catch {
  process.exit(0); // fail open — never trap a session
}
