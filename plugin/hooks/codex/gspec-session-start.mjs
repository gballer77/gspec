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
// misses a layout the gate checks, the baseline for those files is absent and
// task-immutability silently never runs for them — a gate that reports clean
// because it had nothing to compare against.
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

  // Both layouts: gspec/features/<slug>/tasks.md, and the legacy flat
  // gspec/tasks/<slug>.md that projects carry until they migrate.
  const rels = [];
  try {
    for (const slug of readdirSync(join(cwd, 'gspec', 'features'), { withFileTypes: true })) {
      if (slug.isDirectory()) rels.push(`gspec/features/${slug.name}/tasks.md`);
    }
  } catch { /* no features dir yet */ }
  try {
    for (const f of readdirSync(join(cwd, 'gspec', 'tasks'))) {
      if (f.endsWith('.md')) rels.push(`gspec/tasks/${f}`);
    }
  } catch { /* no legacy plans */ }

  const snapshot = {};
  for (const rel of rels) {
    try { snapshot[rel] = readFileSync(join(cwd, rel), 'utf-8'); } catch { /* absent or unreadable */ }
  }
  writeBaseline(cwd, evt.session_id, snapshot);
  emit({}); // nothing to inject; the snapshot is the whole job
} catch {
  emit({}); // fail open
}
