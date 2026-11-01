#!/usr/bin/env node
// gspec stop hook (Cursor) — end-of-turn floor gate + spec-reconcile nudge.
//
// Two jobs, one follow-up message:
//   1. Floor gate (backstop). Scan the whole gspec/ tree and run the
//      file-content floors — spec-integrity, profile-agnosticism, and
//      task-immutability against the session-start baseline. This catches what
//      the per-write hooks could not see: a write whose input shape they could
//      not read, or a spec changed through the shell.
//   2. Reconcile nudge. If this session wrote source files and nothing under
//      gspec/ since (gspec-post-write records them), ask once whether the specs
//      need updating.
// Cursor submits followup_message as the next user message, so the agent keeps
// going until the specs are clean.
//
// Never traps a session: it acts only on a turn that completed (not one the
// user aborted or that errored), and gives up after MAX_FOLLOWUPS follow-ups
// for this stop chain (Cursor's loop_count; hooks.json also sets loop_limit).
// No-ops outside a gspec project. Fails OPEN.
//
// NOTE: ./floors/ resolves at the INSTALLED location (.cursor/hooks/floors/);
// this file is never executed from the source tree.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanGspecTree } from './floors/scan.mjs';
import { readBaseline, walkSpecs } from './floors/session.mjs';
import { takeRecordedFiles, discardRecordedFiles, reconcileMessage } from './floors/reconcile.mjs';
import { readEvent, projectDir, sessionId, followup, none } from './event.mjs';

const MAX_FOLLOWUPS = 3;

try {
  const evt = readEvent();
  const dir = projectDir(evt);
  const session = sessionId(evt);

  if (evt.status && evt.status !== 'completed') none();
  if (!existsSync(join(dir, 'gspec'))) none(); // not a gspec project

  const loops = Number(evt.loop_count) || 0;
  if (loops >= MAX_FOLLOWUPS) {
    discardRecordedFiles(dir, session);
    none();
  }

  let profile = null;
  try { profile = readFileSync(join(dir, 'gspec', 'profile.md'), 'utf-8'); } catch { /* none */ }
  const found = scanGspecTree({ specs: walkSpecs(dir), profile, taskBaselines: readBaseline(dir, session) });

  const parts = [];
  if (found.length) {
    const detail = found.map((v) => `  - [${v.floor}] ${v.rel}: ${v.message}`).join('\n');
    parts.push(
      `gspec enforcement floors flagged ${found.length} issue(s) in gspec/ that must be fixed before finishing:\n${detail}\n\n` +
      `Fix each spec, then finish. Checked-off tasks are immutable — never edit them; append a new task with "supersedes:" instead.`,
    );
  }
  const files = takeRecordedFiles(dir, session);
  if (files.length) parts.push(reconcileMessage(files).trim());

  followup(parts.join('\n\n'));
} catch {
  none(); // fail open
}
