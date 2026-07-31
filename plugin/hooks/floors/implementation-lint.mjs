// Floor: implementation mechanics (pure, I/O-free).
//
// The implement gate has two halves and both were producer==checker or
// judgment-only. `verify.sh` proves the code passes ITS AUTHOR'S OWN TESTS — the
// implementer writes both — so the deterministic half cannot see the failures
// that actually burn autonomous builds: a checked task whose file was never
// created, a stub behind a checked box, a capability ticked while its covering
// tasks are not. Those all fell to one broad agentic judgment.
//
// These checks are pure text. Running them BEFORE the validator turns a whole
// class of failure into a targeted revision at zero agent cost — and, because
// they are cheap, they also run between continuation runs, so a stubbed task is
// caught at run 2 instead of after more work has stacked on top of it.
//
// Text in, messages out. The driver does the I/O.

import { coversQuotes } from './plan-lint.mjs';

// Paths a task line names. Tasks write concrete files in backticks ("scaffold
// the route at `src/pages/index.astro`"), which makes "did the work land?"
// answerable without running anything.
//
// The extension list is NOT decoration. A pattern of `word.word` also matches
// every backticked API reference a task mentions — `AbortSignal.timeout`,
// `jwt.encode`, `res.json` — and this gate BLOCKS, so a run was observed sending
// the implementer off to create files for three JavaScript methods. Only real
// source extensions count.
// Broad on purpose. Too narrow and a real file is called missing (an early cut
// omitted .astro and flagged a route that existed); the job is only to exclude
// `word.method`, which no extension here resembles.
const SOURCE_EXT = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'astro', 'vue', 'svelte', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'styl',
  'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'env', 'lock',
  'sql', 'prisma', 'graphql', 'gql',
  'md', 'mdx', 'txt', 'sh', 'bash', 'zsh', 'fish',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'php', 'cs', 'ex', 'exs',
  'dockerfile', 'conf', 'cfg', 'xml', 'svg', 'proto',
].join('|');
const PATHISH = new RegExp('`([^`\\s]+\\.(?:' + SOURCE_EXT + '))`', 'gi');

// Deliberately narrow: markers that mean "not finished", not every mention of
// the word. `TODO(nope)` in a comment is a stub; "todo list" in a UI string is
// not, so the marker must sit at a word boundary and read as an annotation.
const STUB_MARKERS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bnot\s+implemented\b/i,
  /\bunimplemented\b/i,
  /throw new Error\(\s*['"`](?:stub|todo|not implemented)/i,
  /\bNotImplementedError\b/,
  /\bpass\s*#\s*stub\b/i,
];

/** Every repo-relative path named by a CHECKED task. */
export function filesNamedByCheckedTasks(tasksText) {
  const out = [];
  for (const line of String(tasksText).split('\n')) {
    const task = line.match(/^\s*[-*]\s*\[([xX])\]\s*\*\*T(\d+)\*\*(.*)$/);
    if (!task) continue;
    for (const m of task[3].matchAll(PATHISH)) out.push({ id: `T${task[2]}`, path: m[1] });
  }
  return out;
}

/**
 * A checked task claims work is done and verified. If the file it named does
 * not exist, the box is a lie the tests cannot catch — nothing imports a file
 * that was never written.
 * `present` is a Set of the paths the caller found on disk.
 */
export function missingWorkViolations(rel, tasksText, present) {
  const out = [];
  for (const { id, path } of filesNamedByCheckedTasks(tasksText)) {
    if (!resolves(path, present)) {
      out.push(`${rel}: ${id} is checked but ${path} does not exist — a checked task is the record of work that was done and verified`);
    }
  }
  return out;
}

// Does this named path correspond to something on disk?
//
// A task routinely names a path RELATIVE TO ITS MODULE — `(library)/layout.tsx`
// for what lives at `apps/web/src/app/(library)/layout.tsx` — because that is
// how a person refers to it. Treating the text as repo-relative flagged files
// that plainly exist, so match on suffix: the named path must be the tail of a
// real one, at a segment boundary.
function resolves(named, present) {
  if (present.has(named)) return true;
  const tail = `/${named}`;
  for (const p of present) if (p.endsWith(tail)) return true;
  return false;
}

/** Stub markers in a source file that a checked task claimed to finish. */
export function stubViolations(rel, content, claimedBy = '') {
  const hit = STUB_MARKERS.find((re) => re.test(String(content)));
  if (!hit) return [];
  const who = claimedBy ? ` (claimed complete by ${claimedBy})` : '';
  return [`${rel}: contains an unfinished-work marker${who} — finish it or leave its task unchecked`];
}

/**
 * A PRD capability may only be checked once EVERY task covering it is checked.
 * Both files live in one folder now, so this is a pure comparison — and it
 * catches the most common form of overclaiming, which no test can see.
 */
export function checkboxConsistency(prdRel, prdText, tasksText) {
  const out = [];
  const covered = new Map(); // capability text -> [{id, checked}]
  const lines = String(tasksText).split('\n');
  let current = null;
  for (const line of lines) {
    const task = line.match(/^\s*[-*]\s*\[([ xX])\]\s*\*\*T(\d+)\*\*/);
    if (task) { current = { id: `T${task[2]}`, checked: task[1] !== ' ' }; continue; }
    // Bullet OPTIONAL. A writer that indents `covers:` without a bullet produces
    // the same document; a bullet-only pattern matched none of 88 real tasks and
    // passed every capability vacuously — the exact check meant to catch a
    // capability ticked ahead of its plan, running blind.
    const covers = line.match(/^\s*[-*]?\s*covers:\s*(.+)$/);
    if (!covers || !current) continue;
    // One line may carry SEVERAL adjacent quoted capabilities — the form every
    // real plan used. Splitting on `;` made the whole line one bogus capability
    // that matched no PRD entry, so this check passed vacuously on exactly the
    // input it exists for. Shared parser, one definition of the format.
    for (const text of coversQuotes(covers[1])) {
      if (!covered.has(text)) covered.set(text, []);
      covered.get(text).push(current);
    }
  }

  for (const line of String(prdText).split('\n')) {
    const cap = line.match(/^\s*[-*]\s*\[([xX])\]\s*(?:\*\*[^*]+\*\*:?\s*)?(.+?)\s*$/);
    if (!cap) continue;
    const text = cap[2].trim();
    const tasks = covered.get(text);
    if (!tasks || !tasks.length) continue; // no plan coverage: not this check's business
    const open = tasks.filter((t) => !t.checked);
    if (open.length) {
      out.push(`${prdRel}: capability "${truncate(text)}" is checked but ${open.map((t) => t.id).join(', ')} still ${open.length === 1 ? 'is' : 'are'} not — flip a capability only when every covering task is done`);
    }
  }
  return out;
}

function truncate(s, n = 60) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
