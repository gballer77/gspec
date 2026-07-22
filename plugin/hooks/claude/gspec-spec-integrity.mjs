#!/usr/bin/env node
// gspec PostToolUse hook — spec-integrity check (model-free, advisory).
//
// After a Write/Edit to a gspec spec, verify the spec-version marker is present
// and current. Surfaces the issue to Claude (exit 2) so it fixes the spec it
// just wrote. Fails OPEN: any error, or a non-spec file, exits 0 — a buggy hook
// must never break a session or block unrelated writes.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const SPEC_VERSION = 'v1'; // keep in sync with SPEC_VERSION in scripts/build.js

function flag(msg) {
  process.stderr.write(`gspec spec-integrity: ${msg}\n`);
  process.exit(2);
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');

  // Only gspec spec docs — not the README, not the read-only design/ mockups.
  if (!rel.startsWith('gspec/')) process.exit(0);
  if (rel.startsWith('gspec/design/')) process.exit(0);
  const base = rel.split('/').pop();
  if (base.toLowerCase() === 'readme.md') process.exit(0);

  let content;
  try { content = readFileSync(resolve(projectDir, filePath), 'utf-8'); } catch { process.exit(0); }

  if (base.endsWith('.html')) {
    // HTML style guide: first non-empty line must be <!-- spec-version: vX -->
    const first = content.split('\n').find((l) => l.trim() !== '') || '';
    const m = first.match(/<!--\s*spec-version:\s*(\S+)\s*-->/);
    if (!m) flag(`${rel} is missing its first-line "<!-- spec-version: ${SPEC_VERSION} -->" comment.`);
    if (m[1] !== SPEC_VERSION) flag(`${rel} has spec-version ${m[1]}, expected ${SPEC_VERSION}. Run /gspec-migrate.`);
    process.exit(0);
  }

  if (!base.endsWith('.md')) process.exit(0);

  // Markdown spec: YAML frontmatter with spec-version at the very top.
  const fm = content.match(/^﻿?\s*---\s*\n([\s\S]*?)\n---/);
  if (!fm) flag(`${rel} is missing its YAML frontmatter ("---\\nspec-version: ${SPEC_VERSION}\\n---") at the top.`);
  const ver = fm[1].match(/^spec-version:\s*(\S+)\s*$/m);
  if (!ver) flag(`${rel} frontmatter has no spec-version field (expected ${SPEC_VERSION}).`);
  if (ver[1] !== SPEC_VERSION) flag(`${rel} has spec-version ${ver[1]}, expected ${SPEC_VERSION}. Run /gspec-migrate.`);
  process.exit(0);
} catch {
  process.exit(0); // fail open
}
