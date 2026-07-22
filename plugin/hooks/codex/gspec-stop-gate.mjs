#!/usr/bin/env node
// gspec Stop hook (Codex) — enforcement-floor gate.
//
// Codex hooks fire only on the Bash tool, so file-write floors cannot run per
// write. Instead this Stop hook (a session-level event, not Bash-scoped) scans
// the whole gspec/ tree at turn end and runs the file-content floors:
// spec-integrity, profile-agnosticism, and task-immutability (against the
// SessionStart baseline). On any violation it returns
// {"decision":"block","reason":...}; Codex injects the reason as the next user
// message, forcing the agent to fix the specs before finishing.
//
// A block-count guard (baseline.mjs) stops after MAX_BLOCKS so a genuinely
// unfixable violation cannot trap the session. No-ops outside a gspec project
// and fails OPEN on any error.
//
// NOTE: ./floors/ and ./baseline.mjs resolve at the installed location
// (.codex/hooks/); this file is not executed from the source tree.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanGspecTree } from './floors/scan.mjs';
import { readBaseline, bumpBlockCount, clearBlockCount } from './baseline.mjs';

const MAX_BLOCKS = 3;

function emit(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

// Every .md/.html under gspec/ as { rel, content }.
function walkSpecs(cwd) {
  const specs = [];
  const stack = [join(cwd, 'gspec')];
  while (stack.length) {
    let entries;
    const dir = stack.pop();
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!(e.name.endsWith('.md') || e.name.endsWith('.html'))) continue;
      let content;
      try { content = readFileSync(full, 'utf-8'); } catch { continue; }
      specs.push({ rel: relative(cwd, full).replace(/\\/g, '/'), content });
    }
  }
  return specs;
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { emit({}); }
  const cwd = evt.cwd || process.env.CODEX_PROJECT_DIR || process.cwd();
  if (!existsSync(join(cwd, 'gspec'))) emit({}); // not a gspec project — no-op

  let profile = null;
  try { profile = readFileSync(join(cwd, 'gspec', 'profile.md'), 'utf-8'); } catch { /* none */ }

  const found = scanGspecTree({
    specs: walkSpecs(cwd),
    profile,
    taskBaselines: readBaseline(cwd, evt.session_id),
  });

  if (found.length === 0) { clearBlockCount(cwd, evt.session_id); emit({}); }

  const detail = found.map((v) => `  - [${v.floor}] ${v.rel}: ${v.message}`).join('\n');

  // Loop guard: after MAX_BLOCKS, stop forcing continuation so the session is
  // never trapped; surface a warning instead and let it finish.
  const n = bumpBlockCount(cwd, evt.session_id);
  if (n > MAX_BLOCKS) {
    emit({ systemMessage: `gspec enforcement floors still flag ${found.length} unresolved issue(s) after ${MAX_BLOCKS} attempts:\n${detail}\nFinishing anyway — resolve these manually.` });
  }

  emit({
    decision: 'block',
    reason: `gspec enforcement floors flagged ${found.length} issue(s) in gspec/ that must be fixed before finishing:\n${detail}\n\nFix each spec, then finish. Checked-off tasks are immutable — never edit them; append a new task with "supersedes:" instead.`,
  });
} catch {
  emit({}); // fail open
}
