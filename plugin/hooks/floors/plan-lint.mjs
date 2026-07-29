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
  const all = headingsOf(String(text).split('\n')).map((h) => h.trim());
  const seen = new Set();
  for (const h of all) {
    if (seen.has(h)) v.push(`${rel}: duplicate anchor "${h}" — one block per item`);
    seen.add(h);
  }

  // Origin uniqueness across the tree. This is the deterministic backstop for
  // the race the serial fan-out prevents; belt and braces, because two origins
  // silently disagreeing is the failure mode durable feature folders cannot
  // tolerate.
  for (const [anchor, kind] of originAnchors(text)) {
    if (kind !== 'origin') continue;
    for (const [otherRel, otherText] of Object.entries(others)) {
      if (otherRel === rel) continue;
      const match = originAnchors(otherText).find(([a, k]) => a === anchor && k === 'origin');
      if (match) {
        v.push(`${rel}: "${anchor}" is also defined as an origin in ${otherRel} — exactly one origin per anchor; make one of them an amendment`);
      }
    }
  }

  return v;
}

// [anchorHeading, 'origin' | 'delta'] for each block that declares itself.
export function originAnchors(text) {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s/.test(lines[i])) continue;
    const anchor = lines[i].trim();
    const block = lines.slice(i + 1, i + 8).join('\n');
    if (/^\s*-\s*\*\*amends:\*\*/m.test(block)) out.push([anchor, 'delta']);
    else if (/^\s*-\s*\*\*defined-in:\*\*/m.test(block)) out.push([anchor, 'origin']);
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
    const task = line.match(/^\s*-\s*\[([ xX])\]\s*\*\*T(\d+)\*\*/);
    if (task) { checked = task[1] !== ' '; continue; }
    const arch = line.match(/^\s*-\s*arch:\s*(.+)$/);
    if (!arch || checked) continue;
    for (const raw of arch[1].split(',')) {
      const a = raw.trim().replace(/^#/, '');
      if (!a || a === '—' || a === '-') continue;
      if (!known.has(a)) v.push(`${rel}: task anchor "#${a}" does not resolve to a heading in arch.md`);
    }
  }
  return v;
}
