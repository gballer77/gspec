#!/usr/bin/env node
// gspec PostToolUse hook (Claude) — profile-agnosticism adapter (model-free, advisory).
//
// Every spec except gspec/profile.md must be free of product/company identity.
// After a Write/Edit to a non-profile gspec spec, this derives identity from
// gspec/profile.md and flags any leaked occurrence (exit 2) so Claude genericizes
// it. Heuristic (catches the common case). Decision logic lives in the
// engine-neutral floor module; this adapter parses the event and reads files.
// Fails OPEN.
//
// NOTE: the ./floors/ import resolves at the INSTALLED location
// (.claude/hooks/floors/); this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { isGuardedSpec, identityCandidates, agnosticismHits } from './floors/agnosticism.mjs';

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  if (!isGuardedSpec(rel)) process.exit(0);

  let profile;
  try { profile = readFileSync(resolve(projectDir, 'gspec/profile.md'), 'utf-8'); } catch { process.exit(0); } // no profile → can't check
  const candidates = identityCandidates(profile);
  if (candidates.length === 0) process.exit(0);

  let content;
  try { content = readFileSync(resolve(projectDir, filePath), 'utf-8'); } catch { process.exit(0); }

  const hits = agnosticismHits(content, candidates);
  if (!hits.length) process.exit(0);
  process.stderr.write(
    `gspec profile-agnosticism: ${rel} appears to reference product/company identity ` +
    `(${hits.join(', ')}). Every spec except gspec/profile.md must be identity-free — use ` +
    `generic terms like "the application"/"the system". Product identity lives only in profile.md.\n`,
  );
  process.exit(2);
} catch {
  process.exit(0); // fail open
}
