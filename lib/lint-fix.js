// The lint-fix brief — pure, so its shape can be tested without an engine.
//
// A mechanical violation names one line: a heading in the wrong grammar, a
// task anchor that resolves to nothing, a `[P]` that contradicts a dep. The
// fix is a one-line edit. The brief that asked for it used to say "fix these
// problems in <file>" and nothing more, so the writer re-read the whole
// document to find the line — a full authoring-sized run for a rename. Six of
// ten self-heals on a measured build were this shape.
//
// So the brief carries the offending lines with a few lines of context, and
// says to edit in place. The writer still opens the file to apply the edit;
// it no longer reads it to locate one.

export const CONTEXT_RADIUS = 3;

// The strings a violation message quotes that can be looked up in the file.
// Floors quote the offending heading, anchor, task id or section id verbatim
// (see plugin/hooks/floors/*), so those are the needles; the surrounding
// prose is explanation and never appears in the document.
function needlesOf(violation) {
  const v = String(violation);
  const out = [];
  for (const m of v.matchAll(/"([^"]+)"/g)) out.push(m[1]);
  for (const m of v.matchAll(/<section id="([^"]+)">/g)) out.push(`id="${m[1]}"`);
  // A task id is quoted as `**T7**` in the plan; the message says `T7`.
  for (const m of v.matchAll(/\b(T\d+)\b/g)) out.push(`**${m[1]}**`);
  return out;
}

/**
 * The lines of `docText` a violation is about, or null when nothing in the
 * message can be located. Returns `{ start, end, lines }` with 1-based line
 * numbers, inclusive, `radius` lines either side of the first match.
 */
export function violationContext(docText, violation, radius = CONTEXT_RADIUS) {
  const lines = String(docText).split('\n');
  for (const needle of needlesOf(violation)) {
    const at = lines.findIndex((l) => l.includes(needle));
    if (at < 0) continue;
    const start = Math.max(0, at - radius);
    const end = Math.min(lines.length - 1, at + radius);
    return {
      start: start + 1,
      end: end + 1,
      lines: lines.slice(start, end + 1).map((l, i) => `${String(start + i + 1).padStart(4)} | ${l}`),
    };
  }
  return null;
}

/**
 * The prompt for a lint-fix run. `docText` is the current deliverable; when it
 * cannot be read the prompt degrades to the message list, which is what it
 * always was.
 */
export function lintFixPrompt(target, violations, docText = '', { extraGuidance = [], radius = CONTEXT_RADIUS } = {}) {
  const items = violations.map((v) => {
    const ctx = docText ? violationContext(docText, v, radius) : null;
    if (!ctx) return `- ${v}`;
    return [`- ${v}`, `    lines ${ctx.start}–${ctx.end} of ${target}:`, '    ```', ...ctx.lines.map((l) => `    ${l}`), '    ```'].join('\n');
  });
  const located = violations.some((v) => docText && violationContext(docText, v, radius));
  return [
    `Fix these mechanical problems in ${target}. They are deterministic — each names exactly what is wrong.`,
    '',
    ...items,
    '',
    located
      ? 'Edit in place at the lines shown — open the file only to apply these edits; do not re-read the whole document. Where a message shows no lines, locate it by the text it quotes.'
      : 'Locate each by the text it quotes and edit in place; do not re-read the whole document.',
    'Change nothing else.',
    ...(extraGuidance.length ? ['', ...extraGuidance] : []),
  ].join('\n');
}
