// Turn-boundary plumbing for engines that scan gspec/ at a checkpoint instead of
// (or as well as) per write — the Codex Stop gate and the Cursor stop backstop.
//
// task-immutability needs to know which tasks were ALREADY checked when the
// session began, so a session-start hook snapshots every plan file into a
// session-scoped temp file and the stop hook compares the current tree against
// it. This module owns that path scheme, the plan-path listing (one list, so the
// snapshot and the scan can never cover different layouts), the spec walk, and
// a block-count guard so a session can never be trapped in an unfixable loop.

import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';

const DIR = join(tmpdir(), 'gspec-session');

// One key per (project dir, engine session).
function key(cwd, sessionId) {
  const h = createHash('sha256').update(String(cwd)).digest('hex').slice(0, 12);
  const s = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
  return `${h}-${s}`;
}

export function baselinePath(cwd, sessionId) {
  return join(DIR, `${key(cwd, sessionId)}.json`);
}
function blockCountPath(cwd, sessionId) {
  return join(DIR, `${key(cwd, sessionId)}.blocks`);
}

export function writeBaseline(cwd, sessionId, snapshot) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(baselinePath(cwd, sessionId), JSON.stringify(snapshot), 'utf-8');
}

export function readBaseline(cwd, sessionId) {
  try { return JSON.parse(readFileSync(baselinePath(cwd, sessionId), 'utf-8')); } catch { return {}; }
}

// Loop guard: how many times we have blocked this session's stop so far.
export function bumpBlockCount(cwd, sessionId) {
  mkdirSync(DIR, { recursive: true });
  const p = blockCountPath(cwd, sessionId);
  let n = 0;
  try { n = parseInt(readFileSync(p, 'utf-8'), 10) || 0; } catch { /* first block */ }
  n += 1;
  writeFileSync(p, String(n), 'utf-8');
  return n;
}
export function clearBlockCount(cwd, sessionId) {
  rmSync(blockCountPath(cwd, sessionId), { force: true });
}

// Every plan file on disk, in all layouts: gspec/features/<slug>/tasks.md, a
// chore's gspec/chores/<slug>/tasks.md, and the legacy flat gspec/tasks/<slug>.md
// that projects carry until they migrate.
export function planPaths(cwd) {
  const rels = [];
  for (const parent of ['features', 'chores']) {
    try {
      for (const slug of readdirSync(join(cwd, 'gspec', parent), { withFileTypes: true })) {
        if (slug.isDirectory()) rels.push(`gspec/${parent}/${slug.name}/tasks.md`);
      }
    } catch { /* no such dir yet */ }
  }
  try {
    for (const f of readdirSync(join(cwd, 'gspec', 'tasks'))) {
      if (f.endsWith('.md')) rels.push(`gspec/tasks/${f}`);
    }
  } catch { /* no legacy plans */ }
  return rels;
}

// { rel: content } for every plan file that exists — the session baseline.
export function snapshotPlans(cwd) {
  const snapshot = {};
  for (const rel of planPaths(cwd)) {
    try { snapshot[rel] = readFileSync(join(cwd, rel), 'utf-8'); } catch { /* absent or unreadable */ }
  }
  return snapshot;
}

// Every .md/.html under gspec/ as { rel, content }.
export function walkSpecs(cwd) {
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
