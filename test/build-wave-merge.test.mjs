// Honest parallelism. The runtime fans out within a wave, but the orchestrator
// emitted six one-scope waves for six disjoint features because it had no
// evidence to resolve its (correct) doubt with. The driver now computes the
// evidence, hands it over, and merges what is provably safe.
//
// Pure: drives lib/wave-merge.js and the exported evidence helpers; no engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { disjointnessTable, formatOverlapTable, mergeWaves, separateOverlapping, PARALLEL_CAP } from '../lib/wave-merge.js';
import { prdDependencies, scopeSlug, PARALLEL_MODES } from '../lib/build.js';

const scope = (slug) => ({ label: slug, instruction: `Build ${slug}.`, plan: [`gspec/features/${slug}/tasks.md`] });
const single = (slug) => [scope(slug)];

const FEATURES = [
  { slug: 'auth', modules: ['api'], amends: [], deps: [] },
  { slug: 'catalog', modules: ['web'], amends: [], deps: [] },
  { slug: 'reports', modules: ['worker'], amends: [], deps: [] },
];

test('three single-scope waves over disjoint modules become one wave', () => {
  const table = disjointnessTable(FEATURES);
  const { waves, merges } = mergeWaves([single('auth'), single('catalog'), single('reports')], table, { slugOf: scopeSlug });
  assert.equal(waves.length, 1);
  assert.deepEqual(waves[0].map((s) => s.label), ['auth', 'catalog', 'reports']);
  assert.equal(merges.length, 1);
  assert.deepEqual(merges[0].from, [0, 1, 2]);
});

test('two features sharing a module stay in separate waves', () => {
  const features = [...FEATURES, { slug: 'billing', modules: ['api', 'web'], amends: [], deps: [] }];
  const table = disjointnessTable(features);
  const { waves } = mergeWaves([single('auth'), single('billing'), single('reports')], table, { slugOf: scopeSlug });
  assert.deepEqual(waves.map((w) => w.map((s) => s.label)), [['auth'], ['billing', 'reports']]);
  assert.ok(table.shared.some((s) => s.pair.join() === 'auth,billing' && s.modules.includes('api')));
});

test('two features amending the same anchor are not disjoint, whatever their modules', () => {
  const features = [
    { slug: 'a', modules: ['api'], amends: ['entity-order'], deps: [] },
    { slug: 'b', modules: ['web'], amends: ['entity-order'], deps: [] },
  ];
  const table = disjointnessTable(features);
  assert.deepEqual(table.disjoint, []);
  assert.deepEqual(table.shared[0].anchors, ['entity-order']);
});

test('a declared dependency across two disjoint features keeps them serial', () => {
  const features = FEATURES.map((f) => (f.slug === 'catalog' ? { ...f, deps: ['auth'] } : f));
  const table = disjointnessTable(features);
  const { waves } = mergeWaves([single('auth'), single('catalog'), single('reports')], table, { slugOf: scopeSlug });
  assert.deepEqual(waves.map((w) => w.map((s) => s.label)), [['auth'], ['catalog', 'reports']]);
});

test('--parallel off leaves the plan untouched', () => {
  const table = disjointnessTable(FEATURES);
  const plan = [single('auth'), single('catalog'), single('reports')];
  const { waves, merges } = mergeWaves(plan, table, { slugOf: scopeSlug, mode: 'off' });
  assert.equal(waves, plan);
  assert.deepEqual(merges, []);
  assert.deepEqual(PARALLEL_MODES, ['auto', 'off']);
});

test('a scaffold wave and a multi-scope wave pass through unmerged', () => {
  const table = disjointnessTable(FEATURES);
  const scaffold = [{ label: 'scaffold', instruction: 'Scaffold.' }];
  const { waves } = mergeWaves([scaffold, single('auth'), single('catalog')], table, { slugOf: scopeSlug });
  assert.deepEqual(waves.map((w) => w.map((s) => s.label)), [['scaffold'], ['auth', 'catalog']]);
  const multi = [scope('auth'), scope('catalog')];
  const r = mergeWaves([multi, single('reports')], table, { slugOf: scopeSlug });
  assert.deepEqual(r.waves.map((w) => w.map((s) => s.label)), [['auth', 'catalog'], ['reports']]);
});

test('a merged wave never exceeds the concurrency cap', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ slug: `f${i}`, modules: [`m${i}`], amends: [], deps: [] }));
  const table = disjointnessTable(many);
  const { waves } = mergeWaves(many.map((f) => single(f.slug)), table, { slugOf: scopeSlug });
  assert.equal(PARALLEL_CAP, 3);
  assert.deepEqual(waves.map((w) => w.length), [3, 3, 1]);
});

test('the overlap table names the disjoint pairs, the shared pairs, and the dependencies', () => {
  const features = [...FEATURES.map((f) => (f.slug === 'catalog' ? { ...f, deps: ['auth'] } : f)), { slug: 'billing', modules: ['api'], amends: [], deps: [] }];
  const text = formatOverlapTable(features);
  assert.match(text, /\| auth \| api \|/);
  assert.match(text, /provably file-disjoint/);
  assert.match(text, /auth · catalog/);
  assert.match(text, /auth · billing — module api/);
  assert.match(text, /catalog depends on auth/);
  assert.match(text, /authoritative/);
  assert.equal(formatOverlapTable([FEATURES[0]]), '', 'one feature has nothing to compare');
});

test('PRD dependencies are read from the Dependencies section, by slug or spaced title', () => {
  const prd = `## Overview\nx\n\n## Dependencies\n\n- **Home Page** ([home-page.md](home-page.md)) — links here.\n- **Getting Started** — the walkthrough.\n\n## Assumptions & Risks\n- docs is mentioned here but not as a dependency\n`;
  assert.deepEqual(prdDependencies(prd, ['home-page', 'getting-started', 'docs', 'build-page']), ['home-page', 'getting-started']);
  assert.deepEqual(prdDependencies('# no deps section\n', ['a']), []);
});

test('scopeSlug is the single feature a scope is confined to', () => {
  assert.equal(scopeSlug(scope('auth')), 'auth');
  assert.equal(scopeSlug({ label: 'scaffold' }), null);
  assert.equal(scopeSlug({ plan: ['gspec/features/a/tasks.md', 'gspec/features/b/tasks.md'] }), null);
});

// A wave runs its scopes concurrently, so every wave — not only the merged
// ones — must hold only provably disjoint scopes.

test('a split scope whose features share a module becomes serial waves', () => {
  // The orchestrator emitted ONE scope spanning a and b; splitScopesByFeature
  // made them siblings in one wave. They share `api`, so they must not run at once.
  const table = disjointnessTable([
    { slug: 'a', modules: ['api'], amends: [], deps: [] },
    { slug: 'b', modules: ['api'], amends: [], deps: [] },
  ]);
  const { waves, splits } = separateOverlapping([[scope('a'), scope('b')]], table, { slugOf: scopeSlug });
  assert.deepEqual(waves.map((w) => w.map((s) => s.label)), [['a'], ['b']]);
  assert.deepEqual(splits, [{ wave: 0, into: 2, labels: ['a', 'b'] }]);
});

test('disjoint siblings keep running together; only the overlapping one is moved out', () => {
  const table = disjointnessTable([...FEATURES, { slug: 'billing', modules: ['api'], amends: [], deps: [] }]);
  const { waves } = separateOverlapping([[scope('auth'), scope('catalog'), scope('billing'), scope('reports')]], table, { slugOf: scopeSlug });
  assert.deepEqual(waves.map((w) => w.map((s) => s.label)), [['auth', 'catalog', 'reports'], ['billing']]);
});

test('a declared dependency separates two otherwise disjoint scopes', () => {
  const table = disjointnessTable([
    { slug: 'auth', modules: ['api'], amends: [], deps: [] },
    { slug: 'catalog', modules: ['web'], amends: [], deps: ['auth'] },
  ]);
  const { waves } = separateOverlapping([[scope('auth'), scope('catalog')]], table, { slugOf: scopeSlug });
  assert.equal(waves.length, 2);
});

test('a scaffold, a multi-feature scope and an unknown feature each run alone', () => {
  const table = disjointnessTable(FEATURES);
  const scaffold = { label: 'scaffold', instruction: 'set up', plan: [] };
  const multi = { label: 'both', instruction: 'x', plan: ['gspec/features/auth/tasks.md', 'gspec/features/catalog/tasks.md'] };
  const { waves } = separateOverlapping([[scaffold, scope('auth'), multi, scope('ghost'), scope('catalog')]], table, { slugOf: scopeSlug });
  assert.deepEqual(waves.map((w) => w.map((s) => s.label)), [['scaffold'], ['auth', 'catalog'], ['both'], ['ghost']]);
});

test('single-scope waves and an absent table pass through unchanged or fully serial', () => {
  const plan = [single('auth'), single('catalog')];
  assert.deepEqual(separateOverlapping(plan, disjointnessTable(FEATURES), { slugOf: scopeSlug }).waves, plan);
  const { waves } = separateOverlapping([[scope('auth'), scope('catalog')]], null, { slugOf: scopeSlug });
  assert.equal(waves.length, 2, 'no evidence is not proof');
});
