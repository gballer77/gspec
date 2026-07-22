#!/usr/bin/env node
// gspec PostToolUse hook — reconcile marker (model-free, passive).
//
// First half of the spec-reconcile pair. Records "this session wrote source
// code" so the Stop hook (gspec-reconcile.mjs) can nag once if the turn ends
// with no matching gspec/ update. Scoped to writes made by THIS session — a
// dirty worktree from earlier work never triggers it. The marker lives in the
// OS temp dir keyed by project + session_id (invisible to git, no cleanup
// burden, concurrent sessions don't cross-contaminate):
//   - write to a source file in the project  → append its path to the marker
//   - write to anything under gspec/         → delete the marker (specs got
//     attention after the code change — the well-behaved flow never nags)
//
// Passive: always exit 0 — never disrupts a run. Fails OPEN.

import { readFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const SRC_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|astro|html|css|scss|sql)$/i;

// Keep in sync with markerPath in gspec-reconcile.mjs (the Stop-hook half).
function markerPath(projectDir, sessionId) {
  const key = createHash('sha256').update(String(projectDir)).digest('hex').slice(0, 12);
  const session = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
  return join(tmpdir(), 'gspec-reconcile', `${key}-${session}`);
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  if (rel.startsWith('..')) process.exit(0); // outside the project

  const marker = markerPath(projectDir, evt.session_id);
  if (rel.startsWith('gspec/')) {
    rmSync(marker, { force: true });
    process.exit(0);
  }

  // Only project source files — not gspec-managed artifacts or dependencies.
  if (!SRC_EXT.test(rel)) process.exit(0);
  if (/(^|\/)(\.claude|\.gspec|node_modules)\//.test(rel)) process.exit(0);

  mkdirSync(dirname(marker), { recursive: true });
  appendFileSync(marker, rel + '\n', 'utf-8');
  process.exit(0);
} catch {
  process.exit(0); // fail open — never disrupt a run
}
