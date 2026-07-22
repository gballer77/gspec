#!/usr/bin/env node
// gspec SessionStart hook (Codex) — task-immutability baseline snapshot.
//
// Codex hooks cannot observe a file write, so the file-write floors are enforced
// at the turn boundary by the Stop gate (gspec-stop-gate.mjs). task-immutability
// needs to know which tasks were ALREADY checked when the session began, so this
// SessionStart hook snapshots the content of every gspec/tasks/*.md into a
// session-scoped temp file. Session-level event (not Bash-scoped). Fails OPEN:
// any error just emits an empty decision and the session proceeds.
//
// NOTE: ./baseline.mjs resolves as a sibling both in source and at the installed
// location (.codex/hooks/); floors/ is copied alongside for the Stop gate.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeBaseline } from './baseline.mjs';

function emit(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { emit({}); }
  const cwd = evt.cwd || process.env.CODEX_PROJECT_DIR || process.cwd();

  let files = [];
  try { files = readdirSync(join(cwd, 'gspec', 'tasks')).filter((f) => f.endsWith('.md')); } catch { emit({}); }

  const snapshot = {};
  for (const f of files) {
    const rel = `gspec/tasks/${f}`;
    try { snapshot[rel] = readFileSync(join(cwd, 'gspec', 'tasks', f), 'utf-8'); } catch { /* skip unreadable */ }
  }
  writeBaseline(cwd, evt.session_id, snapshot);
  emit({}); // nothing to inject; the snapshot is the whole job
} catch {
  emit({}); // fail open
}
