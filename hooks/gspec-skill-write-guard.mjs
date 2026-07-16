#!/usr/bin/env node
// gspec PreToolUse hook — skill-write guard (model-free).
//
// The learning loop's rule: a lesson becomes a skill change only through the
// reviewed /gspec-distill path — never a silent auto-edit by an agent. Any agent
// carrying `memory:` has Write/Edit auto-enabled (to manage its memory), so tool
// restrictions alone can't stop it from rewriting a skill. This hook is the hard
// floor: it BLOCKS (exit 2) any Write/Edit to an INSTALLED skill under
// `.claude/skills/` — those are gspec-generated artifacts (overwritten on the
// next install), so nobody should hand- or agent-edit them. Durable changes go
// to the gspec SOURCE skills (not under .claude/, so unaffected) and reinstall.
//
// Note: the `gspec` installer writes .claude/skills/ as its own CLI process, not
// via a Claude tool call, so it never triggers this hook. Fails OPEN.

import { readFileSync } from 'node:fs';

function isInstalledSkill(p) {
  return /(^|[\\/])\.claude[\\/]skills[\\/]/.test(String(p).replace(/\\/g, '/'));
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath || !isInstalledSkill(filePath)) process.exit(0);

  process.stderr.write(
    `gspec skill-write guard: ${filePath} is a gspec-generated skill (installed artifact) — do not edit it ` +
    `directly; it is overwritten on the next \`gspec\` install. To change agent behavior durably, edit the gspec ` +
    `SOURCE skill and reinstall. To promote a lesson from agent memory into a skill, run /gspec-distill — the ` +
    `reviewed path (the distiller proposes, you approve).\n`,
  );
  process.exit(2);
} catch {
  process.exit(0); // fail open
}
