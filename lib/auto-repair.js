// Deterministic repair of mechanical violations — pure.
//
// A floor that fires costs a writer run to fix, and on a measured run every
// one of the five lint rounds was a fix a regex could have made: an anchor
// reference off by hyphenation, a `[P]` on a task that depends on a `[P]`,
// a `### Rule:` filed under `## API`. The rung below "a writer fixes it" is
// "the driver fixes it", and it is only taken when the fix is UNIQUE and
// LOSSLESS — one candidate, nothing dropped, meaning unchanged. Anything
// short of that is left for the writer, exactly as before.
//
// Text in, `{ text, repairs }` out. The driver does the I/O and the logging.

import { slugifyAnchor, TASK_FIELD, normalizeAnchorRef } from '../plugin/hooks/floors/plan-lint.mjs';

const loose = (slug) => String(slug).replace(/-/g, '').toLowerCase();

const TASK_LINE = /^(\s*[-*]\s*\[)([ xX])(\]\s*\*\*T\d+\*\*)(\s*\[P\])?(.*)$/;

// Every `### ` heading in a document: [{ heading, slug }].
function headings(archText) {
  return String(archText).split('\n').filter((l) => /^###\s/.test(l)).map((l) => ({ heading: l.trim(), slug: slugifyAnchor(l) }));
}

// The one heading a reference means, ignoring hyphens and case — or null
// when there is none or more than one.
function uniqueLooseMatch(refSlug, known) {
  const want = loose(refSlug);
  const hits = known.filter((k) => loose(k.slug) === want);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Repair a plan against its architecture:
 *   • an `arch:` reference that resolves to nothing but matches exactly one
 *     heading once hyphens/case are ignored is rewritten to that heading's slug;
 *   • an unchecked `[P]` task that depends on an unchecked `[P]` task loses
 *     its marker (the conservative direction — serial is never wrong).
 * Checked tasks are never touched: they are immutable history.
 */
export function repairPlan(tasksText, archText) {
  const known = headings(archText);
  const knownSlugs = new Set(known.map((k) => k.slug));
  const lines = String(tasksText).split('\n');
  const repairs = [];

  // Pass 1: parse tasks (id, checked, parallel, deps, line index).
  const tasks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].match(TASK_LINE);
    if (t) { cur = { id: lines[i].match(/\*\*T(\d+)\*\*/)[1], line: i, checked: t[2] !== ' ', parallel: Boolean(t[4]), deps: [] }; tasks.push(cur); continue; }
    if (!cur) continue;
    const d = lines[i].match(TASK_FIELD.deps);
    if (d) cur.deps.push(...(d[1].match(/T\d+/g) || []).map((x) => x.slice(1)));
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Pass 2: anchor refs on unchecked tasks.
  cur = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].match(TASK_LINE);
    if (t) { cur = byId.get(lines[i].match(/\*\*T(\d+)\*\*/)[1]); continue; }
    if (!cur || cur.checked) continue;
    const a = lines[i].match(TASK_FIELD.arch);
    if (!a) continue;
    const raw = a[1];
    let value = raw;
    const inner = raw.trim().startsWith('[') && raw.trim().endsWith(']') ? raw.trim().slice(1, -1) : raw;
    for (const ref of inner.split(/[,;](?![^(]*\))/)) {
      const slug = normalizeAnchorRef(ref);
      if (!slug || knownSlugs.has(slug)) continue;
      const hit = uniqueLooseMatch(slug, known);
      if (!hit) continue;
      value = value.replace(ref.trim(), `#${hit.slug}`);
      repairs.push(`T${cur.id}: arch reference "${ref.trim()}" → #${hit.slug} (the one heading it matches once hyphens are ignored: ${hit.heading})`);
    }
    if (value !== raw) lines[i] = lines[i].replace(raw, value);
  }

  // Pass 3: [P] on a task that depends on an unchecked [P] task.
  for (const t of tasks) {
    if (t.checked || !t.parallel) continue;
    const conflicting = t.deps.filter((d) => { const dep = byId.get(d); return dep && !dep.checked && dep.parallel; });
    if (!conflicting.length) continue;
    lines[t.line] = lines[t.line].replace(/(\*\*T\d+\*\*)\s*\[P\]\s?/, '$1 ');
    t.parallel = false;
    repairs.push(`T${t.id}: dropped [P] — it depends on T${conflicting.join(', T')}, which ${conflicting.length === 1 ? 'is' : 'are'} also [P]; running it after them is always safe`);
  }

  return { text: lines.join('\n'), repairs };
}

/**
 * Repair an arch.md: a `### Rule:` / `### Machine:` block filed under
 * `## Data`, `## API` or `## UI` moves to the end of `## Logic`. A `## Logic`
 * that was Not Applicable loses that line, since it now has content. Nothing
 * else is moved: only these two kinds have exactly one legal home.
 */
export function repairArch(archText) {
  const lines = String(archText).split('\n');
  const repairs = [];
  // Locate H2 sections.
  const h2 = [];
  for (let i = 0; i < lines.length; i++) { const m = lines[i].match(/^##\s+(\S+)/); if (m) h2.push({ name: m[1], at: i }); }
  const logic = h2.find((s) => s.name === 'Logic');
  if (!logic) return { text: archText, repairs };
  const sectionOf = (i) => { let cur = null; for (const s of h2) if (s.at < i) cur = s; return cur; };
  const blockEnd = (i) => { let j = i + 1; while (j < lines.length && !/^#{1,3}\s/.test(lines[j])) j++; return j; };

  const moves = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s+(Rule|Machine):/.test(lines[i])) continue;
    const sec = sectionOf(i);
    if (!sec || sec.name === 'Logic') continue;
    moves.push({ start: i, end: blockEnd(i), from: sec.name, heading: lines[i].trim() });
  }
  if (!moves.length) return { text: archText, repairs };

  // Cut from the bottom up so indexes stay valid, collect the blocks.
  const blocks = [];
  for (const m of [...moves].sort((a, b) => b.start - a.start)) {
    const block = lines.splice(m.start, m.end - m.start);
    while (block.length && !block[block.length - 1].trim()) block.pop();
    blocks.unshift({ ...m, block });
  }
  // Re-locate Logic after the cuts and append at its end.
  let logicAt = lines.findIndex((l) => /^##\s+Logic\b/.test(l));
  let end = logicAt + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  // Drop a Not Applicable line: the section has content now.
  for (let i = logicAt + 1; i < end; i++) {
    if (/not\s+applicable/i.test(lines[i])) { lines.splice(i, 1); end--; repairs.push('## Logic: removed its "Not Applicable" line — it now holds the moved anchors'); break; }
  }
  while (end > logicAt + 1 && !lines[end - 1].trim()) end--;
  const insert = [];
  for (const b of blocks) { insert.push('', ...b.block); repairs.push(`moved "${b.heading}" from ## ${b.from} to ## Logic — a ${b.heading.match(/^###\s+(\w+)/)[1]} has exactly one legal section`); }
  lines.splice(end, 0, ...insert, '');
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), repairs };
}

/**
 * Repair a design.html against its architecture: a `<section id="screen-…">`
 * that matches no declared screen but matches exactly one once hyphens/case
 * are ignored is renamed to the declared id.
 */
export function repairDesign(designHtml, archText) {
  const declared = headings(archText)
    .filter((h) => /^###\s+Screen:/.test(h.heading))
    .map((h) => ({ id: `screen-${slugifyAnchor(h.heading.replace(/^###\s+Screen:\s*/, ''))}`, name: h.heading }));
  const ids = new Set(declared.map((d) => d.id));
  const repairs = [];
  let text = String(designHtml);
  for (const m of [...text.matchAll(/<section([^>]*)\bid="(screen-[^"]+)"/g)]) {
    const id = m[2];
    if (ids.has(id)) continue;
    const hits = declared.filter((d) => loose(d.id) === loose(id));
    if (hits.length !== 1) continue;
    text = text.split(`id="${id}"`).join(`id="${hits[0].id}"`);
    repairs.push(`<section id="${id}"> → id="${hits[0].id}" (the one screen it matches once hyphens are ignored: ${hits[0].name})`);
  }
  return { text, repairs };
}
