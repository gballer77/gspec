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

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const MAX_LISTED = 10;

// Keep in sync with markerPath in gspec-reconcile-marker.mjs (the PostToolUse half).
function markerPath(projectDir, sessionId) {
  const key = createHash('sha256').update(String(projectDir)).digest('hex').slice(0, 12);
  const session = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
  return join(tmpdir(), 'gspec-reconcile', `${key}-${session}`);
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const marker = markerPath(projectDir, evt.session_id);

  // Loop guard: this hook already blocked this stop — consume and let it end.
  if (evt.stop_hook_active) {
    rmSync(marker, { force: true });
    process.exit(0);
  }

  let files;
  try { files = readFileSync(marker, 'utf-8'); } catch { process.exit(0); } // no marker — nothing to nag
  rmSync(marker, { force: true }); // consume: one nudge per code-writing burst

  const unique = [...new Set(files.split('\n').map((l) => l.trim()).filter(Boolean))];
  if (unique.length === 0) process.exit(0);

  const listed = unique.slice(0, MAX_LISTED).map((f) => `  - ${f}`).join('\n');
  const more = unique.length > MAX_LISTED ? `\n  …and ${unique.length - MAX_LISTED} more` : '';
  process.stderr.write(
    `gspec reconcile: this session modified source files but nothing under gspec/:\n${listed}${more}\n` +
    `Review whether these changes affect the specs — architecture.md (structure, data model, API), ` +
    `stack.md (dependencies), style.md/style.html (visual conventions), practices.md (workflows), ` +
    `or feature PRD checkboxes in gspec/features/. Update the affected specs, ` +
    `or if there is genuinely no spec impact, state that and finish.\n`,
  );
  process.exit(2);
} catch {
  process.exit(0); // fail open — never trap a session
}
