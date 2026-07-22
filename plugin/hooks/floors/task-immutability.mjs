// Floor: task immutability (pure, I/O-free).
//
// Once a plan task is checked off (`- [x] **T<n>**`), it is FROZEN: its text,
// deps, covers, ID, and checked state must never change, and it must never be
// deleted, reordered out of existence, or unchecked. Replanning APPENDS new
// tasks (a replacement carries `supersedes: T<n>`); history is never rewritten.
//
// This module holds the comparison logic only. Entry points (the Claude
// PreToolUse hook, the Codex Stop gate, git pre-commit) supply the baseline and
// the candidate content and decide how to signal a violation.

// A task block = the `- [ ]/[x] **T<n>** …` line plus its indented follow-on
// lines (`deps:` / `covers:`), up to the next task line. We freeze CHECKED
// blocks verbatim: "immutable" means byte-for-byte, so any reformat counts.
const TASK_START = /^\s*-\s*\[[ xX]\]\s*\*\*T\d+\*\*/;
const CHECKED_START = /^\s*-\s*\[[xX]\]\s*\*\*T(\d+)\*\*/;

// Map of task id -> verbatim block text (trailing blank lines trimmed) for every
// task that is CHECKED in `content`.
export function checkedBlocks(content) {
  const lines = String(content).split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (TASK_START.test(l)) starts.push(i); });
  const blocks = new Map();
  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    const m = lines[start].match(CHECKED_START);
    if (!m) continue; // unchecked task — not frozen
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const block = lines.slice(start, end);
    while (block.length && block[block.length - 1].trim() === '') block.pop();
    blocks.set(m[1], block.join('\n'));
  }
  return blocks;
}

// Literal (non-regex) first-occurrence replace — Edit/MultiEdit semantics, with
// no `$&`/`$1` surprises that String.replace(string) would introduce.
function literalReplace(haystack, needle, replacement, all) {
  if (all) return haystack.split(needle).join(replacement);
  const i = haystack.indexOf(needle);
  return i === -1 ? haystack : haystack.slice(0, i) + replacement + haystack.slice(i + needle.length);
}

// The content a Claude Write/Edit/MultiEdit call would produce, applied to the
// pre-edit baseline. (Used by the per-write PreToolUse adapter.)
export function projectedContent(current, toolName, input = {}) {
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : current;
  if (toolName === 'Edit') {
    if (typeof input.old_string !== 'string') return current;
    return literalReplace(current, input.old_string, input.new_string ?? '', input.replace_all);
  }
  if (toolName === 'MultiEdit') {
    let out = current;
    for (const e of input.edits || []) {
      if (e && typeof e.old_string === 'string') out = literalReplace(out, e.old_string, e.new_string ?? '', e.replace_all);
    }
    return out;
  }
  return current;
}

// IDs of tasks that are CHECKED in `current` whose verbatim block no longer
// survives in `result`. Works two ways:
//   • per-write (Claude): current = on-disk baseline, result = projected content.
//   • full-scan (Codex Stop / git): current = turn-start baseline, result = now.
export function violations(current, result) {
  const dead = [];
  for (const [id, block] of checkedBlocks(current)) {
    if (!String(result).includes(block)) dead.push(id);
  }
  return dead;
}
