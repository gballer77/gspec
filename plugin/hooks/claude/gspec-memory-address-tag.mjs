#!/usr/bin/env node
// gspec PreToolUse hook — memory address-tag guard (model-free).
//
// The learning loop requires every recorded memory to carry an address tag
// (target: + layer:) so the memorizer can route it to the right durable home
// (a skill / agent / command). This fires before a Write/Edit and, if a
// substantive write under `.gspec/memory/pending/` lacks the tag, BLOCKS it
// (exit 2) so the agent re-writes with the tag. Trims/deletions pass.
//
// Previously guarded `.claude/agent-memory*/`; recording moved to
// `.gspec/memory/pending/` so the loop works on every engine, not just the one
// with per-agent memory silos.
//
// Fails OPEN: any error or non-memory path exits 0 — a buggy hook must never
// break a session or block an unrelated write.

import { readFileSync } from 'node:fs';

// The added text this write introduces (Write.content / Edit.new_string /
// MultiEdit each edit's new_string) — what a new memory would live in.
function addedText(toolInput) {
  if (typeof toolInput?.content === 'string') return toolInput.content;
  if (typeof toolInput?.new_string === 'string') return toolInput.new_string;
  if (Array.isArray(toolInput?.edits)) return toolInput.edits.map((e) => e?.new_string || '').join('\n');
  return '';
}

function isPendingMemory(p) {
  // Matches the project store (.gspec/memory/pending/) at any depth, so it holds
  // whether the agent writes a relative or an absolute path.
  return /(^|[\\/])\.gspec[\\/]memory[\\/]pending[\\/]/.test(String(p).replace(/\\/g, '/'));
}

function hasAddressTag(text) {
  return /(^|\n)\s*[-*]?\s*target:\s*\S/i.test(text) && /(^|\n)\s*[-*]?\s*layer:\s*(skill|agent|command)\b/i.test(text);
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath || !isPendingMemory(filePath)) process.exit(0);

  const text = addedText(evt.tool_input);
  // Short additions are trims, not new memories — let them through.
  if (text.trim().length < 40) process.exit(0);
  if (hasAddressTag(text)) process.exit(0);

  process.stderr.write(
    `gspec memory address-tag: the memory written to ${filePath} is missing its address tag. Every memory must ` +
    `carry "target: <agent-or-skill-name>" and "layer: skill|agent|command" in its frontmatter so the learning ` +
    `loop can route it (see the gspec-memory skill). Add the tag and write again.\n`,
  );
  process.exit(2);
} catch {
  process.exit(0); // fail open
}
