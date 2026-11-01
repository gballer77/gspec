#!/usr/bin/env node
// gspec SessionStart hook (Codex) — task-immutability baseline snapshot.
//
// Codex hooks cannot observe a file write, so the file-write floors are enforced
// at the turn boundary by the Stop gate (gspec-stop-gate.mjs). task-immutability
// needs to know which tasks were ALREADY checked when the session began, so this
// SessionStart hook snapshots the content of every plan file into a
// session-scoped temp file. Session-level event (not Bash-scoped). Fails OPEN:
// any error just emits an empty decision and the session proceeds.
//
// It must cover the SAME set of paths the Stop gate scans. If this snapshot
// missed a layout the gate checks, the baseline for those files would be absent
// and task-immutability would silently never run for them — so the plan-path
// list lives once, in floors/session.mjs, shared with the Cursor hooks.
//
// NOTE: ./floors/ resolves at the installed location (.codex/hooks/floors/);
// this file is not executed from the source tree.

import { readFileSync } from 'node:fs';
import { writeBaseline, snapshotPlans } from './floors/session.mjs';

function emit(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { emit({}); }
  const cwd = evt.cwd || process.env.CODEX_PROJECT_DIR || process.cwd();

  const snapshot = snapshotPlans(cwd);
  writeBaseline(cwd, evt.session_id, snapshot);
  emit({}); // nothing to inject; the snapshot is the whole job
} catch {
  emit({}); // fail open
}
