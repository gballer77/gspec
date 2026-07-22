#!/usr/bin/env node
// gspec PostToolUse hook (Claude) — spec-integrity adapter (model-free, advisory).
//
// After a Write/Edit to a gspec spec, verify the spec-version marker is present
// and current, surfacing any issue to Claude (exit 2) so it fixes the spec it
// just wrote. The decision logic lives in the engine-neutral floor module; this
// adapter only parses the Claude event and reads the file. Fails OPEN.
//
// NOTE: the ./floors/ import resolves at the INSTALLED location
// (.claude/hooks/floors/); this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { appliesToSpecIntegrity, specIntegrityViolations } from './floors/spec-integrity.mjs';

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  if (!appliesToSpecIntegrity(rel)) process.exit(0);

  let content;
  try { content = readFileSync(resolve(projectDir, filePath), 'utf-8'); } catch { process.exit(0); }

  const problems = specIntegrityViolations(rel, content);
  if (!problems.length) process.exit(0);
  process.stderr.write(`gspec spec-integrity: ${problems.join(' ')}\n`);
  process.exit(2);
} catch {
  process.exit(0); // fail open
}
