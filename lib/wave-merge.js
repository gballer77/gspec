// Honest parallelism — pure.
//
// The runtime already fans out within a wave, but the orchestrator emitted
// six one-scope waves for six mutually disjoint features on the measured
// build. Its skill says "when in doubt, don't parallelize" — right, and it had
// no evidence to resolve the doubt with. Two things change that here:
//
//   1. A feature × module matrix and a file-disjointness table, computed
//      driver-side from the specs, inlined into the orchestrator's prompt as
//      the authoritative answer to "do these two write the same files?".
//   2. A conservative merge, applied after the plan is normalized: consecutive
//      single-scope waves that are PROVABLY disjoint and carry no dependency
//      between them become one wave, capped at PARALLEL_CAP scopes.
//
// Provable means: the two features' module sets do not intersect (a module
// owns its directories, so disjoint modules are disjoint files), neither
// amends an anchor the other amends, and neither PRD names the other as a
// dependency. Anything short of that stays serial.

export const PARALLEL_CAP = 3;

/**
 * `features` — [{ slug, modules: [name], amends: [anchorSlug], deps: [slug] }].
 * Returns { disjoint: [[a, b]], shared: [{ pair, modules, anchors }], deps: [[from, to]] }
 * over every unordered pair, sorted by slug.
 */
export function disjointnessTable(features = []) {
  const list = [...features].sort((a, b) => a.slug.localeCompare(b.slug));
  const disjoint = [];
  const shared = [];
  const deps = [];
  for (const f of list) for (const d of f.deps || []) if (d !== f.slug) deps.push([f.slug, d]);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const modules = (a.modules || []).filter((m) => (b.modules || []).includes(m));
      const anchors = (a.amends || []).filter((x) => (b.amends || []).includes(x));
      if (modules.length || anchors.length) shared.push({ pair: [a.slug, b.slug], modules, anchors });
      else disjoint.push([a.slug, b.slug]);
    }
  }
  return { disjoint, shared, deps };
}

/** The fenced table the orchestrator prompt inlines. '' with fewer than two features. */
export function formatOverlapTable(features = [], table = disjointnessTable(features)) {
  if (features.length < 2) return '';
  const lines = [
    'File-overlap evidence, computed by the driver from each feature\'s arch.md anchors and the Modules table. This table is authoritative for the file-overlap call — do not re-derive it by reading code:',
    '```',
    '| feature | modules |',
    '| --- | --- |',
    ...[...features].sort((a, b) => a.slug.localeCompare(b.slug)).map((f) => `| ${f.slug} | ${(f.modules || []).join(', ') || '(none declared)'} |`),
    '```',
  ];
  if (table.disjoint.length) {
    lines.push('These pairs are provably file-disjoint (no shared module, no shared amended anchor):');
    for (const [a, b] of table.disjoint) lines.push(`  ${a} · ${b}`);
  }
  if (table.shared.length) {
    lines.push('These pairs share modules or amend the same anchor — never the same wave:');
    for (const s of table.shared) lines.push(`  ${s.pair[0]} · ${s.pair[1]} — ${[...s.modules.map((m) => `module ${m}`), ...s.anchors.map((x) => `anchor ${x}`)].join(', ')}`);
  }
  if (table.deps.length) {
    lines.push('Declared dependencies (PRD Dependencies sections) — the dependent builds in a later wave:');
    for (const [from, to] of table.deps) lines.push(`  ${from} depends on ${to}`);
  }
  lines.push('Provably-disjoint scopes with no dependency between them belong in the SAME wave. Pairs not listed as disjoint stay in separate waves.');
  return lines.join('\n');
}

const isDisjoint = (table, a, b) => table.disjoint.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const hasDep = (table, a, b) => table.deps.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * Merge consecutive single-scope waves whose features are pairwise disjoint
 * and dependency-free, up to `cap` scopes per wave. `slugOf(scope)` maps a
 * scope to its feature slug (null for a scaffold or a multi-feature scope —
 * those are never merged). `mode` 'off' returns the plan untouched.
 *
 * Returns { waves, merges: [{ from: [waveIndexes], labels }] } so the caller
 * can log what changed.
 */
export function mergeWaves(waves = [], table, { slugOf = (s) => s.slug ?? null, cap = PARALLEL_CAP, mode = 'auto' } = {}) {
  if (mode !== 'auto' || !table || waves.length < 2) return { waves, merges: [] };
  const out = [];
  const merges = [];
  let group = null; // { scopes, slugs, from }
  const close = () => {
    if (!group) return;
    out.push(group.scopes);
    if (group.from.length > 1) merges.push({ from: group.from, labels: group.scopes.map((s) => s.label) });
    group = null;
  };
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    const single = wave.length === 1 ? wave[0] : null;
    const slug = single ? slugOf(single) : null;
    const scaffold = single && (!(single.plan || []).length || /scaffold/i.test(single.label || ''));
    if (!single || !slug || scaffold) { close(); out.push(wave); continue; }
    if (group && group.scopes.length < cap
      && group.slugs.every((s) => isDisjoint(table, s, slug) && !hasDep(table, s, slug))) {
      group.scopes.push(single); group.slugs.push(slug); group.from.push(i);
      continue;
    }
    close();
    group = { scopes: [single], slugs: [slug], from: [i] };
  }
  close();
  return { waves: out, merges };
}
