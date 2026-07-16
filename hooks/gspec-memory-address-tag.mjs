#!/usr/bin/env node
// gspec PreToolUse hook — feedback address-tag guard (model-free).
//
// The learning loop requires every per-agent memory entry to carry an address
// tag (target: + layer:) so a lesson can be routed to the right durable home
// (a skill / agent / command). This fires before a Write/Edit and, if a
// substantive write to a `.claude/agent-memory*/` file lacks the tag, BLOCKS it
// (exit 2) so the agent re-writes with the tag. Curation/trim edits (short
// additions, deletions) pass. Fails OPEN: any error or non-memory path exits 0 —
// a buggy hook must never break a session or block an unrelated write.

import { readFileSync } from 'node:fs';

// The added text this write introduces (Write.content / Edit.new_string /
// MultiEdit each edit's new_string) — what a new lesson would live in.
function addedText(toolInput) {
  if (typeof toolInput?.content === 'string') return toolInput.content;
  if (typeof toolInput?.new_string === 'string') return toolInput.new_string;
  if (Array.isArray(toolInput?.edits)) return toolInput.edits.map((e) => e?.new_string || '').join('\n');
  return '';
}

function isMemoryPath(p) {
  // project (.claude/agent-memory/), local (.claude/agent-memory-local/), and
  // user (~/.claude/agent-memory/) silos all share the `agent-memory` segment.
  return /(^|[\\/])\.claude[\\/]agent-memory(-local)?[\\/]/.test(String(p).replace(/\\/g, '/'));
}

function hasAddressTag(text) {
  return /(^|\n)\s*[-*]?\s*target:\s*\S/i.test(text) && /(^|\n)\s*[-*]?\s*layer:\s*(skill|agent|command)\b/i.test(text);
}

function block(msg) {
  process.stderr.write(`gspec memory address-tag: ${msg}\n`);
  process.exit(2);
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath || !isMemoryPath(filePath)) process.exit(0);

  const text = addedText(evt.tool_input);
  // Short additions are curation/trims, not new lessons — let them through.
  if (text.trim().length < 40) process.exit(0);
  if (hasAddressTag(text)) process.exit(0);

  block(
    `a memory entry written to ${filePath} is missing its address tag. Every lesson must carry ` +
    `"target: <agent-or-skill-name>" and "layer: skill|agent|command" so the learning loop can route it ` +
    `(see the gspec-memory skill). Add the tag and write again.`,
  );
} catch {
  process.exit(0); // fail open
}
