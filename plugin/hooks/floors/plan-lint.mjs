// Floor: feature-folder mechanics (pure, I/O-free).
//
// A large share of what the feature-folder validators check is pure regex over
// text: heading grammar, section shape, anchor uniqueness, `amends:` targets,
// screen coverage, `arch:` anchors resolving. Spending an agent run to discover
// a malformed heading is waste, and the origin-uniqueness backstop should not
// depend on a model noticing.
//
// So the driver runs these FIRST and sends any violation straight back to the
// writer — zero agent cost, and a precise instruction instead of a vague FAIL.
// The agent validator then only ever judges mechanically-clean drafts, and can
// spend its whole budget on the things regex cannot decide (altitude, delta
// honesty, whether a Not Applicable is honest).
//
// Same shape as every other floor: text in, messages out, no I/O.

const SECTIONS = ['Data', 'API', 'UI', 'Logic'];

// The exact H3 grammar each section owns. The rigidity is the point: an anchor
// has to be findable with a line-anchored grep from another file.
const ANCHOR_GRAMMAR = {
  Data: /^### Entity: [A-Z][A-Za-z0-9]*$/,
  API: /^### Endpoint: (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S*$/,
  UI: /^### (Screen|Component): \S.*$/,
  Logic: /^### (Rule|Machine): \S.*$/,
};
const ANCHOR_SHAPE = {
  Data: '### Entity: <PascalName>',
  API: '### Endpoint: <METHOD> </path>',
  UI: '### Screen: <Name> or ### Component: <Name>',
  Logic: '### Rule: <Name> or ### Machine: <Name>',
};

const NOT_APPLICABLE = /not\s+applicable/i;

export function slugifyAnchor(heading) {
  return String(heading)
    .replace(/^#+\s*/, '')
    // Split camel/Pascal boundaries FIRST. Anchor names are routinely
    // identifiers — `ItemStatusBadge`, `HighlightLayer` — and lowercasing them
    // whole yields `itemstatusbadge`, which nobody writing an id would produce.
    // Without this the coverage check reports a mismatch on output that is
    // perfectly correct.
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')   // HTMLParser → HTML-Parser
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Split an arch.md into its four H2 concern sections.
function sections(text) {
  const out = {};
  const lines = String(text).split('\n');
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(\S+)/);
    if (h2) { current = h2[1]; out[current] ??= []; continue; }
    if (current) out[current].push(line);
  }
  return out;
}

// Every `### ` heading in a block, with its line text.
const headingsOf = (body) => body.filter((l) => /^###\s/.test(l));

/**
 * Mechanical checks for one feature's arch.md.
 * `others` maps other features' arch.md paths to their text, for the
 * cross-feature origin-uniqueness check.
 */
export function archLintViolations(rel, text, others = {}) {
  const v = [];
  const secs = sections(text);

  for (const name of SECTIONS) {
    if (!(name in secs)) {
      v.push(`${rel}: missing the "## ${name}" section — all four of ${SECTIONS.join(', ')} must be present, each specified or marked Not Applicable`);
      continue;
    }
    const body = secs[name];
    const heads = headingsOf(body);
    const na = NOT_APPLICABLE.test(body.slice(0, 6).join(' '));
    if (na) {
      if (heads.length) v.push(`${rel}: "## ${name}" is marked Not Applicable but still defines ${heads.length} item(s) — one line and a reason is the whole section`);
      continue;
    }
    if (!heads.length) {
      v.push(`${rel}: "## ${name}" is neither specified nor marked Not Applicable — add its items, or say why it does not apply`);
      continue;
    }
    for (const h of heads) {
      if (!ANCHOR_GRAMMAR[name].test(h.trim())) {
        v.push(`${rel}: heading "${h.trim()}" does not match the anchor grammar for ## ${name} (${ANCHOR_SHAPE[name]})`);
      }
    }
  }

  // Uniqueness within the file: two blocks with one anchor make the grep
  // ambiguous, which is the whole mechanism.
  //
  // Compared by SLUG, not by heading string. Every *reference* to an anchor
  // resolves through slugifyAnchor, so `Entity: TunableConstants` and
  // `Entity: Tunable Constants` are already one anchor to `tasks.md` and to
  // `design.html` — two blocks under those two headings are ambiguous in exactly
  // the way this check exists to prevent, and a string compare reports them
  // clean.
  const all = headingsOf(String(text).split('\n')).map((h) => h.trim());
  const seen = new Map();
  for (const h of all) {
    const slug = slugifyAnchor(h);
    if (seen.has(slug)) {
      const first = seen.get(slug);
      v.push(first === h
        ? `${rel}: duplicate anchor "${h}" — one block per item`
        : `${rel}: "${h}" and "${first}" are the same anchor once slugified (${slug}) — one block per item, and a punctuation or case variant is not a distinction`);
      continue;
    }
    seen.set(slug, h);
  }

  // Origin uniqueness across the tree. This is the deterministic backstop for
  // the race the serial fan-out used to prevent; under declare/resolve it is no
  // longer a race but a WORK LIST — two features legitimately declaring the same
  // anchor is the input consolidation consumes, not a writer's mistake. The
  // computation is unchanged; what changed is who reads the output.
  //
  // Slug-keyed for the same reason as above (C8): `### Rule: Progressive
  // Enhancement Contract` and `### Rule: Progressive-Enhancement Contract` are
  // two origins that every reference resolves to as one anchor, and a `===`
  // compare reported that pair clean.
  for (const [anchor, kind] of originAnchors(text)) {
    if (kind !== 'origin') continue;
    const slug = slugifyAnchor(anchor);
    for (const [otherRel, otherText] of Object.entries(others)) {
      if (otherRel === rel) continue;
      const match = originAnchors(otherText).find(([a, k]) => k === 'origin' && slugifyAnchor(a) === slug);
      if (match) {
        v.push(match[0] === anchor
          ? `${rel}: "${anchor}" is also defined as an origin in ${otherRel} — exactly one origin per anchor; make one of them an amendment`
          : `${rel}: "${anchor}" and "${match[0]}" in ${otherRel} are the same anchor once slugified (${slug}) — exactly one origin per anchor; make one of them an amendment`);
      }
    }
  }

  return v;
}

/**
 * Duplicate origins across a whole set of arch.md files, as DATA rather than as
 * findings — the work list the resolve step consumes.
 *
 * `files` maps path → text. Returns one entry per slug that more than one file
 * originates, carrying every spelling it was written under, so a caller can both
 * merge them and report what it merged.
 *
 * This is the same computation `archLintViolations` does for its cross-file
 * check, hoisted so it can be run once over N files instead of N times over N−1.
 */
export function duplicateOrigins(files = {}) {
  const bySlug = new Map();
  for (const [rel, text] of Object.entries(files)) {
    for (const [anchor, kind] of originAnchors(text)) {
      if (kind !== 'origin') continue;
      const slug = slugifyAnchor(anchor);
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push({ rel, anchor });
    }
  }
  return [...bySlug.entries()]
    .filter(([, sites]) => sites.length > 1)
    .map(([slug, sites]) => ({ slug, sites }));
}

/**
 * Anchor names that CONTAIN another anchor's name as a whole-token subsequence —
 * `Rule: Glossary Progressive Enhancement Contract` ⊃ `Rule: Progressive
 * Enhancement Contract`. The containment half of "one definition per shared
 * concept", and the half that needs no judgment.
 *
 * A synonym with no shared tokens is NOT detectable here and never will be;
 * that half is a judging step, and this function deliberately does not guess.
 *
 * Returns `{ slug, anchor, rel, contains: { slug, anchor, rel } }` per hit —
 * the wider name first, because it is the one that should have amended.
 */
export function containedAnchors(files = {}) {
  const all = [];
  for (const [rel, text] of Object.entries(files)) {
    for (const [anchor] of originAnchors(text)) {
      const m = anchor.trim().match(/^###\s+(\w+):\s*(.+)$/);
      if (!m) continue;
      all.push({ rel, anchor: anchor.trim(), kind: m[1], tokens: tokensOf(m[2]), slug: slugifyAnchor(anchor) });
    }
  }
  const out = [];
  for (const wide of all) {
    for (const narrow of all) {
      if (wide.slug === narrow.slug || wide.kind !== narrow.kind) continue;
      // An Endpoint name is a URL PATH, and paths nest by design: `GET /books`
      // is a prefix of `GET /books/:id` because REST says so, not because one
      // feature prefixed the other's name. Containment cannot tell the two
      // apart, and every hit on a dogfood build was this false positive.
      if (wide.kind.toLowerCase() === 'endpoint') continue;
      // Same file means one writer named both, so there was no canonical anchor
      // to amend and nothing to adjudicate — the failure this check exists for
      // is a LATER writer prefixing an EARLIER feature's name.
      if (wide.rel === narrow.rel) continue;
      if (narrow.tokens.length >= wide.tokens.length) continue;
      if (!isSubsequence(narrow.tokens, wide.tokens)) continue;
      out.push({ slug: wide.slug, anchor: wide.anchor, rel: wide.rel, contains: { slug: narrow.slug, anchor: narrow.anchor, rel: narrow.rel } });
    }
  }
  return out;
}

const tokensOf = (name) => slugifyAnchor(name).split('-').filter(Boolean);

// Whole-token subsequence, in order. `[progressive, enhancement, contract]` is
// inside `[glossary, progressive, enhancement, contract]`; `[contract,
// progressive]` is not, because order carries meaning in a name.
function isSubsequence(needle, haystack) {
  let i = 0;
  for (const t of haystack) if (t === needle[i]) i++;
  return i === needle.length;
}

// Does this block declare `key:` as a status line, however it is dressed up?
//
// Matching the one shape writers happen to use today — `- **amends:**` — made
// the origin-uniqueness backstop silently STOP CHECKING any anchor written
// another way. An anchor whose key came out `- amends:` or `- *amends*:`
// matched neither branch below, so it was classified as neither origin nor
// delta and dropped from the comparison entirely. That is the worst direction
// for a check to fail: a genuine duplicate origin — the failure mode durable
// feature folders cannot tolerate — would pass in silence, and the run would
// report the floor as clean.
//
// Emphasis, bullets and backticks carry no meaning here, so strip them and pin
// the word. Same reasoning as `parseVerdict` reading `VERDICT: **PASS**`.
const declaresKey = (block, key) =>
  new RegExp(`^\\s*[-*+]?\\s*${key}\\s*:`, 'im').test(String(block).replace(/[*_`]/g, ''));

// [anchorHeading, 'origin' | 'delta' | 'use'] for each block that declares itself.
//
// `uses:` is the third kind, and it is what makes a shared anchor's home movable
// without breaking anything downstream. A feature that merely CONSUMES a spine
// anchor keeps a two-line stub under the right `##` section — the heading, and
// `uses:` pointing at the module tier — so the anchor is still greppable in that
// feature's own arch.md. `planLintViolations` (task `arch:` refs resolve against
// arch.md headings) and `designLintViolations` (every `<section id="screen-*">`
// needs a `### Screen:`) therefore keep working with no change at all.
//
// It has to be checked BEFORE `defined-in:`, and it has to be its own kind:
// classifying a stub as an origin would make every consumer of a shared anchor a
// duplicate origin, which is the exact opposite of what the stub is for.
export function originAnchors(text) {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s/.test(lines[i])) continue;
    const anchor = lines[i].trim();
    const block = lines.slice(i + 1, i + 8).join('\n');
    if (declaresKey(block, 'amends')) out.push([anchor, 'delta']);
    else if (declaresKey(block, 'uses')) out.push([anchor, 'use']);
    else if (declaresKey(block, 'defined-in')) out.push([anchor, 'origin']);
  }
  return out;
}

/**
 * Where each block says its definition lives: `[anchor, kind, target]`.
 *
 * `target` is the path on the `amends:` / `uses:` / `defined-in:` line, which is
 * what O3 turns on — a delta an agent reads has to arrive with its base, and the
 * only way to check that mechanically is to resolve the path and ask whether it
 * is in the reader's scope.
 */
export function anchorRefs(text) {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s/.test(lines[i])) continue;
    const anchor = lines[i].trim();
    const block = lines.slice(i + 1, i + 8).join('\n');
    for (const key of ['amends', 'uses', 'defined-in']) {
      const target = keyValue(block, key);
      if (target === null) continue;
      out.push([anchor, key === 'defined-in' ? 'origin' : key === 'uses' ? 'use' : 'delta', target]);
      break;
    }
  }
  return out;
}

// The value on a `- **key:** value` status line, stripped of markdown dressing.
// Same tolerance as declaresKey — emphasis, bullets and backticks carry no
// meaning, and pinning one spelling is how the origin backstop silently stopped
// checking anchors once before.
function keyValue(block, key) {
  const m = String(block).replace(/[*_`]/g, '')
    .match(new RegExp(`^\\s*[-*+]?\\s*${key}\\s*:\\s*(.*)$`, 'im'));
  return m ? m[1].trim() : null;
}

// The module a block belongs to, from its `- **module:** <name>` status line.
//
// The ANCHOR carries the module, not the feature. A feature spanning `api` and
// `web` declares anchors in both, so the feature-level frontmatter cannot be the
// unit: an anchor names a thing in the codebase, and code lives in one module's
// dir. Returns a Map of anchor heading → module name for every block that says.
export function anchorModules(text) {
  const out = new Map();
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s/.test(lines[i])) continue;
    const mod = keyValue(lines.slice(i + 1, i + 8).join('\n'), 'module');
    if (mod) out.set(lines[i].trim(), mod);
  }
  return out;
}

// Coverage between arch.md's ## UI section and design.html, both ways.
//
// Screens both ways; components are the validator's job (see below).
export function designLintViolations(rel, designHtml, archText) {
  const v = [];
  const ui = sections(archText).UI || [];
  if (NOT_APPLICABLE.test(ui.slice(0, 6).join(' '))) return v;

  const declared = headingsOf(ui)
    .map((h) => h.trim().match(/^### (Screen|Component): (.+)$/))
    .filter(Boolean)
    .map((m) => ({ kind: m[1].toLowerCase(), name: m[2].trim(), id: `${m[1].toLowerCase()}-${slugifyAnchor(m[2])}` }));

  // Scan the MARKUP, never the commentary. A design routinely documents its own
  // structure ("one <section id=\"screen-*\"> per arch.md ### Screen:"), and
  // matching that text made the lint report ids nobody wrote — which then FAILED
  // A BUILD on a file that was perfectly correct. A false positive in a blocking
  // deterministic check is worse than not checking at all.
  // Only BODY MARKUP counts. Comments explain the structure, and a <style> or
  // <script> block routinely contains both prose (in /* */ comments) and
  // selector text that looks like markup. Scanning any of it made the lint
  // report ids nobody wrote — and it FAILED A BUILD on a correct file, first on
  // an HTML comment and then on a CSS one. Strip all three rather than chase
  // comment syntaxes one at a time.
  const markup = String(designHtml)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const ids = new Set([...markup.matchAll(/<section[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));

  // SCREENS ONLY, deliberately.
  //
  // An earlier version also required every `### Component:` to appear in the
  // design. It could not be made reliable: a designer writes semantic CSS
  // (`class="item-card"`), not the architecture's identifier
  // (`LibraryItemCard`), so matching them is guesswork — and this check BLOCKS,
  // so a wrong guess stops a build over a correct file. "Is every component
  // drawn?" is a judgment call; it belongs to feature-design-validator, which
  // can read the mockup. What stays here is what regex can actually settle: a
  // screen is a place, it gets its own section, and both directions must agree.
  for (const d of declared) {
    if (d.kind !== 'screen') continue;
    if (!ids.has(d.id)) v.push(`${rel}: no <section id="${d.id}"> for screen "${d.name}" — every screen in the architecture must be rendered`);
  }
  for (const id of ids) {
    // Only ids that CLAIM to be a screen or component are held to the mapping;
    // a design may add its own scaffolding sections (a token swatch, a legend).
    if (!id.startsWith('screen-')) continue;   // a design may name its own sections
    if (!declared.some((d) => d.id === id)) {
      v.push(`${rel}: <section id="${id}"> has no matching "### Screen:" in the architecture's ## UI section`);
    }
  }

  // Self-contained: the file's whole value is that a human can open it.
  for (const m of markup.matchAll(/\b(?:src|href)="(https?:)?\/\/[^"]*"/g)) {
    v.push(`${rel}: external reference ${m[0]} — design.html must render standalone from file://`);
  }
  return v;
}

// The canonical `arch:` value is a bracketed list — `arch: [A, B, C]` — so the
// closing `]` rides on the LAST element after the split. That bracket silently
// defeats the provenance-aside strip in normalizeAnchorRef, which is anchored to
// end-of-string: `Rule: X (api.md)]` slugs to `rule-x-api-md` and resolves to
// nothing. A BARE anchor survives the same bracket (slugifyAnchor drops it as
// punctuation), so this only ever bit refs carrying a `(…)` aside — which is to
// say every cross-tier reference, the one thing the two-tier split added. On a
// dogfood build it fired nine times in one file, all false, and the free
// self-heal "fixed" them by abandoning the bracketed format entirely.
//
// Unwrap only a list that wraps the WHOLE value and contains no inner `]`, so a
// markdown link (`[Entity: X](arch.md)`, ending in `)`) and the pathological
// `[A], [B]` are both left alone.
const unwrapList = (value) => {
  const t = String(value).trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return t;
  const inner = t.slice(1, -1);
  return inner.includes(']') ? t : inner.trim();
};

// Every `arch:` anchor an UNCHECKED task names must resolve in the sibling
// arch.md. Checked tasks are immutable, so their anchors freeze with them and
// may legitimately point at something a later feature superseded — they route
// nothing, so they are never checked here.
export function planLintViolations(rel, tasksText, archText) {
  const v = [];
  const known = new Set(headingsOf(String(archText).split('\n')).map((h) => slugifyAnchor(h)));
  const lines = String(tasksText).split('\n');
  let checked = false;
  for (const line of lines) {
    const task = line.match(/^\s*[-*]\s*\[([ xX])\]\s*\*\*T(\d+)\*\*/);
    if (task) { checked = task[1] !== ' '; continue; }
    const arch = line.match(TASK_FIELD.arch);
    if (!arch || checked) continue;
    // Split on separators OUTSIDE parentheses: a reference like
    // "UI (intro, integration contract) > ### Component: Panel" carries a comma
    // inside its aside, and splitting there invents two anchors from one.
    for (const raw of unwrapList(arch[1]).split(/[,;](?![^(]*\))/)) {
      const a = normalizeAnchorRef(raw);
      if (!a) continue;
      if (!known.has(a)) v.push(`${rel}: task anchor "${raw.trim()}" does not resolve to a heading in arch.md`);
    }
  }
  return v;
}

// A task's metadata line, WITH OR WITHOUT its list bullet.
//
// The canonical format bullets these ("  - deps: …"), but a writer that indents
// them plainly ("  deps: …") is producing the same document — markdown, not
// meaning. A bullet-only pattern found ZERO of 88 real `arch:` lines and
// reported the file clean, which is the worst outcome available: a check that
// silently verifies nothing. Tolerate the cosmetic difference; never fail on it.
// …and WITH OR WITHOUT emphasis, for the same reason. Tolerating only the
// bullet left the identical hole one cosmetic step away: these writers bold
// freely — the task line itself is `**T12**` and every anchor status line comes
// out `- **defined-in:**` — so `- **covers:**` finds nothing, and a task that
// covers a capability reads as a task covering none. Silent again, in the check
// whose entire job is linking tasks to the PRD.
//
// The trailing `**` after the colon is stepped over rather than captured, so the
// value stays exactly what the writer wrote — `covers:` quotes have to match the
// PRD verbatim, and a stray marker in the captured text would break the compare
// this is meant to protect.
const taskField = (key) => new RegExp(`^\\s*[-*+]?\\s*[*_\`]{0,2}\\s*${key}\\s*[*_\`]{0,2}\\s*:\\s*[*_\`]{0,2}\\s*(.+?)\\s*$`);

export const TASK_FIELD = {
  arch: taskField('arch'),
  covers: taskField('covers'),
  deps: taskField('deps'),
};

// One `arch:` reference → the anchor slug it names, or null when it names none.
//
// Writers reference an anchor several equally-clear ways — `#entity-order`,
// `### Entity: Order`, `Data > ### Entity: Order`, or the bare `Entity: Order` —
// and all of them mean the same block. Normalize rather than dictate: take the
// last `Kind: Name` in the reference and slug it.
export function normalizeAnchorRef(ref) {
  const raw = String(ref).trim()
    .replace(/^#+\s*/, '')
    // A list-closing bracket that survived the split (see unwrapList) has to come
    // off BEFORE the aside strip below, which is anchored to end-of-string and is
    // silently defeated by it. Belt-and-braces: unwrapList already handles the
    // canonical shape, this covers a writer who brackets an individual ref.
    .replace(/\s*\]\s*$/, '')
    // A trailing aside — "Rule: Content Extraction (amends .../arch.md)" — is
    // provenance the writer added for a human, not part of the anchor's name.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  if (!raw || raw === '—' || raw === '-' || /^none$/i.test(raw)) return null;
  const kinded = raw.match(/(Entity|Endpoint|Screen|Component|Rule|Machine)\s*:\s*(.+)$/i);
  return kinded ? slugifyAnchor(`${kinded[1]}: ${kinded[2]}`) : slugifyAnchor(raw);
}

// Every task in a plan, as a record. The task line carries the id, the optional
// `[P]` marker and the capability id; the indented fields follow it.
export function parseTasks(tasksText) {
  const out = [];
  let cur = null;
  for (const line of String(tasksText).split('\n')) {
    const t = line.match(/^\s*[-*]\s*\[([ xX])\]\s*\*\*T(\d+)\*\*(.*)$/);
    if (t) {
      cur = { id: `T${t[2]}`, checked: t[1] !== ' ', parallel: /^\s*\[P\]/.test(t[3]), deps: [], covers: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const d = line.match(TASK_FIELD.deps);
    if (d) {
      const raw = d[1].trim();
      if (!/^none$/i.test(raw) && raw !== '-' && raw !== '—') {
        cur.deps.push(...(raw.match(/T\d+/g) || []));
      }
      continue;
    }
    const c = line.match(TASK_FIELD.covers);
    if (c) cur.covers.push(...coversQuotes(c[1]));
  }
  return out;
}

/**
 * A `[P]` marker claims a task can start immediately, in parallel with its
 * siblings. That is false the moment it depends on a task that is not itself
 * `[P]` — the dependency has to finish first, so the two cannot overlap.
 *
 * This is graph arithmetic, and it was being adjudicated by a language model:
 * across one dogfood run the plan validator raised it FIVE times over four
 * revision rounds ("T8 is marked [P] but declares deps: T7"), each round costing
 * a validator run plus a writer run. The rule existed only as the prose
 * "honest [P] markers". Now it is computed.
 *
 * Only UNCHECKED tasks are judged: a checked task is immutable history, and
 * flagging it would demand an edit the writer is forbidden to make.
 */
export function parallelismViolations(rel, tasksText) {
  const tasks = parseTasks(tasksText);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const v = [];
  for (const t of tasks) {
    if (!t.parallel || t.checked) continue;
    // The hazard is between SIBLINGS — the tasks [P] says may run alongside one
    // another. If one of them depends on another, they cannot, and one of the
    // two markers is wrong.
    //
    // This check used to be inverted: it flagged a [P] task for depending on a
    // NON-[P] one, and let a [P]-on-[P] dependency through. That reading makes
    // the marker unusable. `[P]` means "deps met when this runs" (engineer bar:
    // "its deps are all complete AND it writes no files a [P] sibling writes"),
    // and a plan is written before any work exists — so under the old rule no
    // task with a dependency could ever carry [P] on a fresh plan, while
    // plan-decomposer is required to produce "honest [P] markers" and report how
    // many. It also made the verdict move with execution: the same file failed
    // before its foundation task was checked and passed afterwards.
    //
    // A non-[P] dependency is a BARRIER, which is the normal shape — one
    // foundation task, then a fan-out. Measured on a real plan: 11 findings
    // across 3 of 8 features, every one of them that shape, every one wrong.
    const conflicting = t.deps.filter((d) => {
      const dep = byId.get(d);
      return dep && !dep.checked && dep.parallel;
    });
    if (conflicting.length) {
      v.push(`${rel}: ${t.id} is marked [P] but depends on ${conflicting.join(', ')}, which ${conflicting.length === 1 ? 'is' : 'are'} also [P] — tasks marked to run alongside each other cannot depend on one another, so one of the markers is not honest`);
    }
    if (t.deps.includes(t.id)) v.push(`${rel}: ${t.id} lists itself in deps`);
  }
  return v;
}

/**
 * `covers:` quotes a capability from the PRD *verbatim* — that is what makes it
 * a link rather than a paraphrase, and every downstream check that maps tasks to
 * capabilities depends on the exact match. A near-quote silently covers nothing.
 *
 * Also caught by an agent on the same run, one capability at a time. String
 * containment does not need judgment.
 *
 * Matching is whitespace-normalized: a writer that rewraps a long capability
 * across lines has not changed the quote, and failing that would teach writers
 * the check is noise.
 */
export function coversViolations(rel, tasksText, prdText) {
  const prd = normalizeSpace(String(prdText));
  if (!prd.trim()) return []; // no PRD to check against — not this floor's call
  const v = [];
  const seen = new Set();
  for (const t of parseTasks(tasksText)) {
    for (const quote of t.covers) {
      const key = `${t.id}\u0000${quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!prd.includes(normalizeSpace(quote))) {
        v.push(`${rel}: ${t.id} covers: "${truncate(quote)}" but that text does not appear verbatim in the PRD — the quote is the link to the capability, so a paraphrase covers nothing`);
      }
    }
  }
  return v;
}

/**
 * The capability quotes on one `covers:` line.
 *
 * Writers routinely put SEVERAL adjacent quoted capabilities on a single line —
 * `covers: "first capability" "second capability"` — which is what a person
 * writing markdown does, and every real plan in a dogfood run used that form.
 * A parser that split on `;` and stripped the outer quotes turned the whole
 * line into one bogus capability that matched nothing, so the checks built on
 * it passed VACUOUSLY. Take the quotes wherever they are; fall back to
 * separator-splitting only when the line carries no quotes at all.
 */
export function coversQuotes(raw) {
  const line = String(raw).trim();
  // A capability may itself contain quotation marks — UI capabilities routinely
  // do ("shows a clear \"no results\" state") — and the only unambiguous way to
  // write one is to escape them. Stopping at the first inner quote made that
  // impossible: the escaped capability came out as a fragment ending in a
  // backslash, which then "does not appear verbatim in the PRD", failing a plan
  // whose covers: line was right.
  //
  // Seen live in a build. A writer escaped the inner quotes, the lint rejected
  // it, and the mechanical fix "repaired" the line by REMOVING the escapes —
  // leaving one capability parsed as two fragments that each happen to be a
  // PRD substring. The check then passes while the link it exists to verify is
  // gone: the third vacuous pass this function has had, after splitting on `;`
  // and after ignoring adjacent quotes.
  //
  // Unescaped inner quotes stay ambiguous by construction — `"a "b" c"` is
  // equally readable as one capability or three — so they are left exactly as
  // they were. What changes is that escaping now WORKS, which gives a writer a
  // correct way to say it.
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  const quoted = [];
  for (const m of line.matchAll(re)) {
    const q = (m[1] ?? m[2] ?? '').replace(/\\(["'\\])/g, '$1').trim();
    if (q) quoted.push(q);
  }
  if (quoted.length) return quoted;
  return line.split(/[;]/).map((p) => p.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}

function normalizeSpace(s) {
  return String(s).replace(/\s+/g, ' ');
}

function truncate(s, n = 70) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
