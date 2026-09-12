// The brief for a CONTINUED implementer run — pure where it can be.
//
// A scope runs to completion across fresh agents: when one exhausts its
// context, the next starts from the reduced unchecked set. Every continuation
// used to re-send the same whole-feature brief — the full scope instruction
// plus the feature folder, every module tier and practices — even when one
// task remained. Input is transcript × turns, so a whole-feature brief on a
// one-task run is the most expensive way to finish.
//
// This module derives what a continuation actually needs from the plan: the
// unchecked tasks, the `arch:` anchors they cite, the headings those anchors
// resolve to in the feature's arch.md, and the module-tier files those
// anchors live in. Nothing else is named, and the brief says so.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { TASK_FIELD, normalizeAnchorRef, slugifyAnchor, looseSlug, anchorModules, anchorRefs } from '../plugin/hooks/floors/plan-lint.mjs';

// How many tasks a feature may carry before the FIRST run is briefed on a
// group rather than the whole plan (§3.3 of the efficiency brief).
export const TASK_GROUP_THRESHOLD = 8;

const TASK_LINE = /^\s*[-*]\s*\[([ xX])\]\s*\*\*T(\d+)\*\*(.*)$/;

// Split an `arch:` value the way planLintViolations does: on separators outside
// parentheses, tolerating a bracketed list.
function splitRefs(raw) {
  const t = String(raw).trim();
  const inner = t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t;
  return inner.split(/[,;](?![^(]*\))/);
}

/**
 * Every task in a plan with the text and anchor slugs a brief needs:
 * `[{ id, checked, parallel, text, deps, anchors }]` in plan order.
 */
export function parsePlanTasks(tasksText) {
  const out = [];
  let cur = null;
  for (const line of String(tasksText).split('\n')) {
    const t = line.match(TASK_LINE);
    if (t) {
      cur = { id: `T${t[2]}`, checked: t[1] !== ' ', parallel: /^\s*\[P\]/.test(t[3]), text: t[3].replace(/^\s*\[P\]\s*/, '').trim(), deps: [], anchors: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const d = line.match(TASK_FIELD.deps);
    if (d) { cur.deps.push(...(d[1].match(/T\d+/g) || [])); continue; }
    const a = line.match(TASK_FIELD.arch);
    if (a) {
      for (const raw of splitRefs(a[1])) {
        const slug = normalizeAnchorRef(raw);
        if (slug && !cur.anchors.includes(slug)) cur.anchors.push(slug);
      }
    }
  }
  return out;
}

// heading slug → { heading, module, target } for every H3 in an arch.md.
function archIndex(archText) {
  const index = new Map();
  const mods = anchorModules(archText);
  const refs = new Map(anchorRefs(archText).map(([anchor, , target]) => [anchor, target]));
  for (const line of String(archText).split('\n')) {
    if (!/^###\s/.test(line)) continue;
    const heading = line.trim();
    index.set(slugifyAnchor(heading), { heading, module: mods.get(heading) || null, target: refs.get(heading) || null });
  }
  return index;
}

/**
 * The pure core: given one plan and its sibling architecture, what a
 * continuation must read. `moduleFileExists(rel)` lets the caller say which
 * module-tier files are real; absent, every implied file is listed.
 *
 * Returns { tasks, sections, files, empty } where `sections` are the arch.md
 * headings the remaining tasks cite (in file order) and `files` the
 * module-tier files those anchors resolve to.
 */
export function remainingBriefFor({ tasksRel, tasksText, archRel, archText = '', moduleFileExists = () => true }) {
  const remaining = parsePlanTasks(tasksText).filter((t) => !t.checked);
  const index = archIndex(archText);
  // Loose on hyphens, like the floor: a task's `#entity-ingredientline` still
  // pulls in `### Entity: IngredientLine`.
  const cited = new Set(remaining.flatMap((t) => t.anchors).map(looseSlug));
  const sections = [];
  const files = new Set();
  for (const [slug, entry] of index) {
    if (!cited.has(looseSlug(slug))) continue;
    sections.push(entry.heading);
    if (entry.module) {
      const rel = `gspec/architecture/${entry.module}.md`;
      if (moduleFileExists(rel)) files.add(rel);
    }
    // A `uses:`/`amends:` stub points at the file holding the definition; a
    // delta an implementer reads has to arrive with its base.
    if (entry.target && /^gspec\/architecture\//.test(entry.target) && entry.target !== archRel && moduleFileExists(entry.target)) files.add(entry.target);
  }
  // Anchors the plan cites that the arch.md does not carry: the lint would have
  // caught these on an unchecked task, but a checked one may cite a superseded
  // anchor — say nothing rather than point at a heading that is not there.
  return {
    tasksRel,
    archRel,
    tasks: remaining.map(({ id, text, anchors, deps, parallel }) => ({ id, text, anchors, deps, parallel })),
    sections,
    files: [...files],
    empty: remaining.length === 0,
  };
}

/**
 * Render one or more feature briefs as the prompt block a continuation run
 * receives. An empty brief renders to '' — the caller skips the run.
 */
export function formatRemainingBrief(briefs) {
  const list = (Array.isArray(briefs) ? briefs : [briefs]).filter((b) => b && !b.empty);
  if (!list.length) return '';
  const lines = [];
  for (const b of list) {
    lines.push(`Remaining tasks in ${b.tasksRel}:`);
    for (const t of b.tasks) lines.push(`  ${t.id}${t.parallel ? ' [P]' : ''} — ${t.text}${t.anchors.length ? ` (arch: ${t.anchors.map((a) => `#${a}`).join(', ')})` : ''}`);
    if (b.sections.length) {
      lines.push(`Read these sections of ${b.archRel} only:`);
      for (const h of b.sections) lines.push(`  ${h}`);
    }
    if (b.files.length) {
      lines.push('Read these module files only (the anchors above resolve into them):');
      for (const f of b.files) lines.push(`  ${f}`);
    }
  }
  lines.push('Everything else in the feature folder and the architecture is done or not needed for these tasks — do not re-read it. Open other files only when a remaining task names them.');
  return lines.join('\n');
}

/**
 * The I/O wrapper: read each plan and its sibling arch.md, resolve module
 * files against the tree, and return the briefs (one per plan file).
 */
export async function remainingTaskBrief(cwd, planFiles = []) {
  const out = [];
  for (const tasksRel of planFiles) {
    const rel = String(tasksRel).replace(/\\/g, '/');
    let tasksText;
    try { tasksText = await readFile(join(cwd, rel), 'utf-8'); } catch { continue; }
    const archRel = `${dirname(rel)}/arch.md`;
    let archText = '';
    try { archText = await readFile(join(cwd, archRel), 'utf-8'); } catch { /* headless feature or legacy layout */ }
    const cache = new Map();
    const exists = async (p) => {
      if (!cache.has(p)) cache.set(p, await readFile(join(cwd, p), 'utf-8').then(() => true, () => false));
      return cache.get(p);
    };
    // Resolve existence up front so the core stays synchronous.
    const draft = remainingBriefFor({ tasksRel: rel, tasksText, archRel, archText });
    const present = new Set();
    for (const f of draft.files) if (await exists(f)) present.add(f);
    out.push(remainingBriefFor({ tasksRel: rel, tasksText, archRel, archText, moduleFileExists: (p) => present.has(p) }));
  }
  return out;
}

/**
 * Ordered task groups for a large plan (§3.3): successive dependency layers
 * of the UNCHECKED tasks, each layer split into chunks of at most `size` in
 * plan order. A task joins a layer once every unchecked dep it names sits in
 * an earlier layer, so `[P]` siblings land together and a barrier task
 * precedes its fan-out. Returns [] when the plan has `size` tasks or fewer —
 * the caller then briefs the whole plan as before.
 */
export function taskGroups(tasksText, size = TASK_GROUP_THRESHOLD) {
  const tasks = parsePlanTasks(tasksText);
  const unchecked = tasks.filter((t) => !t.checked);
  if (unchecked.length <= size) return [];
  const pending = new Set(unchecked.map((t) => t.id));
  const groups = [];
  let guard = 0;
  while (pending.size && guard++ < 1000) {
    const layer = unchecked.filter((t) => pending.has(t.id) && t.deps.every((d) => !pending.has(d)));
    // A cycle (or a forward dep the lint missed): take the rest in plan order
    // rather than spin.
    const take = layer.length ? layer : unchecked.filter((t) => pending.has(t.id));
    for (let i = 0; i < take.length; i += size) groups.push(take.slice(i, i + size).map((t) => t.id));
    for (const t of take) pending.delete(t.id);
  }
  return groups;
}

/**
 * The first-run brief for a large plan: the first group only, with the rest
 * named so the implementer knows to stop rather than press on. '' when the
 * plan is small enough to brief whole.
 */
export function firstRunGroupBrief(tasksRel, tasksText, size = TASK_GROUP_THRESHOLD) {
  const groups = taskGroups(tasksText, size);
  if (groups.length < 2) return '';
  const [first, ...rest] = groups;
  const byId = new Map(parsePlanTasks(tasksText).map((t) => [t.id, t]));
  return [
    `This plan has ${byId.size} tasks; this run implements group 1 of ${groups.length} only — the tasks below, in order. Check each as you finish it, then STOP: a fresh run continues with the next group (${rest.flat().join(', ')}).`,
    `Group 1 (${tasksRel}):`,
    ...first.map((id) => `  ${id}${byId.get(id)?.parallel ? ' [P]' : ''} — ${byId.get(id)?.text || ''}`),
  ].join('\n');
}

/**
 * The task ids an orchestrator instruction names — ranges (`T1–T6`, `T1-T6`,
 * `T1..T6`) expanded, singles collected. Empty when it names none.
 */
export function namedTaskIds(instruction) {
  const text = String(instruction || '');
  const ids = new Set();
  for (const m of text.matchAll(/\bT(\d+)\s*(?:–|—|-|\.\.|to)\s*T?(\d+)\b/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    if (b >= a && b - a < 500) for (let i = a; i <= b; i++) ids.add(`T${i}`);
  }
  for (const m of text.matchAll(/\bT(\d+)\b/g)) ids.add(`T${m[1]}`);
  return ids;
}

/**
 * Does the instruction confine the run to a PROPER subset of the plan's
 * unchecked tasks? "All tasks T1–T17" over a 17-task plan is the whole
 * feature; "tasks T1–T6" over the same plan is a subset the orchestrator
 * chose. Naming no ids at all is the whole feature too.
 */
export function instructionNamesSubset(instruction, tasksText) {
  const named = namedTaskIds(instruction);
  if (!named.size) return false;
  const unchecked = parsePlanTasks(tasksText).filter((t) => !t.checked).map((t) => t.id);
  if (!unchecked.length) return false;
  return !unchecked.every((id) => named.has(id));
}
