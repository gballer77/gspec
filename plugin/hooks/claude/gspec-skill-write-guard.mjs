#!/usr/bin/env node
// gspec PreToolUse hook — skill-write guard (model-free).
//
// The learning loop's rule: a memory becomes a skill change only through the
// reviewed /gspec-memorize or /gspec-teach path — never a silent auto-edit by an
// agent. Remembering agents carry Write/Edit (they write pending memories), so
// tool restrictions alone can't stop them from rewriting a skill. This hook is the
// hard floor. It BLOCKS (exit 2) a Write/Edit to either place a skill's content
// comes from:
//
//   1. an INSTALLED skill under `.claude/skills/` — a gspec-generated artifact,
//      overwritten on the next install, so nobody should hand- or agent-edit it;
//   2. the COMMITTED memory store, `<any>/.gspec/memory/*.md` — composed into
//      those skills on every install, which makes an unreviewed write there a
//      skill edit by a slower route. `.gspec/memory/pending/**` is explicitly
//      ALLOWED: that is where an agent records, and doing so is its job.
//
// Durable changes go to the gspec SOURCE skills (not under .claude/, so
// unaffected) and reinstall. Note: the `gspec` installer writes .claude/skills/
// and composes memory as its own CLI process, not via a Claude tool call, so it
// never triggers this hook. Fails OPEN.

import { readFileSync } from 'node:fs';

const norm = (p) => String(p).replace(/\\/g, '/');

function isInstalledSkill(p) {
  return /(^|\/)\.claude\/skills\//.test(norm(p));
}

// Committed store only. `memory/pending/...` and `memory/gspec/...` (bug
// reports, never composed) both sit a directory deeper, so requiring the file to
// be a direct child of `memory/` excludes them without a second pattern.
function isCommittedMemory(p) {
  return /(^|\/)\.gspec\/memory\/[^/]+\.md$/.test(norm(p));
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  if (isCommittedMemory(filePath)) {
    process.stderr.write(
      `gspec skill-write guard: ${filePath} is the COMMITTED memory store — it is composed into the matching skill ` +
      `on every install, so writing it directly commits a memory without review. Record your memory under ` +
      `.gspec/memory/pending/<your-agent-name>/ instead (see the gspec-memory skill); /gspec-memorize commits it ` +
      `here once a human approves it.\n`,
    );
    process.exit(2);
  }

  if (!isInstalledSkill(filePath)) process.exit(0);

  process.stderr.write(
    `gspec skill-write guard: ${filePath} is a gspec-generated skill (installed artifact) — do not edit it ` +
    `directly; it is overwritten on the next \`gspec\` install. To change agent behavior durably, edit the gspec ` +
    `SOURCE skill and reinstall. To commit a recorded memory into a skill, run /gspec-memorize — the ` +
    `reviewed path (the memorizer proposes, you approve).\n`,
  );
  process.exit(2);
} catch {
  process.exit(0); // fail open
}
