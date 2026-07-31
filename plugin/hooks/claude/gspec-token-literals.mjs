#!/usr/bin/env node
// gspec PostToolUse hook (Claude) — style-guide token-literals adapter (model-free, advisory).
//
// gspec/style.html's token block is the single source of truth for color;
// every other rule must reference tokens via var(--…). After a Write/Edit to
// the HTML style guide, this flags literal colors declared outside the token
// block (exit 2) so Claude re-points them at tokens. Decision logic lives in
// the engine-neutral floor module; this adapter parses the event and reads the
// file. Fails OPEN.
//
// NOTE: the ./floors/ import resolves at the INSTALLED location
// (.claude/hooks/floors/); this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { appliesToTokenLiterals, tokenLiteralViolations } from './floors/token-literals.mjs';

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  if (!appliesToTokenLiterals(rel)) process.exit(0);

  let content;
  try { content = readFileSync(resolve(projectDir, filePath), 'utf-8'); } catch { process.exit(0); }

  const violations = tokenLiteralViolations(content, rel);
  if (!violations.length) process.exit(0);
  process.stderr.write(`gspec token-literals: ${violations.join('\n')}\n`);
  process.exit(2);
} catch {
  process.exit(0); // fail open
}
