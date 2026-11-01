// Spec-reconcile marker (I/O-light, engine-neutral).
//
// The reconcile pair nudges a spec update when a session wrote source code but
// nothing under gspec/. The post-write half records each source file the
// session wrote; a write under gspec/ clears the record; the stop half nudges
// once if the record survives to the end of the turn. The marker lives in the
// OS temp dir keyed by project + session id (invisible to git, no cleanup
// burden, concurrent sessions don't cross-contaminate). Both halves import this
// module, so the path scheme and the "what counts as source" rule live once.

import { readFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const SRC_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|astro|html|css|scss|sql)$/i;
export const MAX_LISTED = 10;

export function markerPath(projectDir, sessionId) {
  const key = createHash('sha256').update(String(projectDir)).digest('hex').slice(0, 12);
  const session = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
  return join(tmpdir(), 'gspec-reconcile', `${key}-${session}`);
}

// Only project source files — not gspec-managed artifacts, engine config, or
// dependencies. `rel` is project-relative with forward slashes.
export function isReconcileSource(rel) {
  if (rel.startsWith('..')) return false;
  if (!SRC_EXT.test(rel)) return false;
  return !/(^|\/)(\.claude|\.cursor|\.codex|\.gspec|node_modules)\//.test(rel);
}

// Record one write. A write under gspec/ means the specs got attention after
// the code change, so the well-behaved flow never nags.
export function recordWrite(projectDir, sessionId, rel) {
  const marker = markerPath(projectDir, sessionId);
  if (rel.startsWith('gspec/')) { rmSync(marker, { force: true }); return; }
  if (!isReconcileSource(rel)) return;
  mkdirSync(dirname(marker), { recursive: true });
  appendFileSync(marker, rel + '\n', 'utf-8');
}

// Consume the marker: the unique files it recorded, or [] when there is none.
// One nudge per code-writing burst, so the agent's follow-up stops cleanly.
export function takeRecordedFiles(projectDir, sessionId) {
  const marker = markerPath(projectDir, sessionId);
  let files;
  try { files = readFileSync(marker, 'utf-8'); } catch { return []; }
  rmSync(marker, { force: true });
  return [...new Set(files.split('\n').map((l) => l.trim()).filter(Boolean))];
}

export function discardRecordedFiles(projectDir, sessionId) {
  rmSync(markerPath(projectDir, sessionId), { force: true });
}

export function reconcileMessage(files) {
  const listed = files.slice(0, MAX_LISTED).map((f) => `  - ${f}`).join('\n');
  const more = files.length > MAX_LISTED ? `\n  …and ${files.length - MAX_LISTED} more` : '';
  return (
    `gspec reconcile: this session modified source files but nothing under gspec/:\n${listed}${more}\n` +
    `Review whether these changes affect the specs — architecture.md (structure, data model, API), ` +
    `stack.md (dependencies), style.md/style.html (visual conventions), practices.md (workflows), ` +
    `or feature PRD checkboxes in gspec/features/. Update the affected specs, ` +
    `or if there is genuinely no spec impact, state that and finish.\n`
  );
}
