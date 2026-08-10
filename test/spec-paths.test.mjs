// Where specs live, asserted against the prose that tells agents where to look.
//
// The v2 folder layout (gspec/features/<slug>/prd.md + tasks.md) landed in
// /gspec-migrate and in the hooks, but the commands, agents, skills and the
// always-on preamble kept naming the flat v1 paths for a full release. The
// result was worse than a broken command: /gspec-feature wrote a new PRD back
// to the flat path a migration had just cleared, and the preamble rule that
// syncs checkboxes globbed gspec/features/*.md — which matches nothing once a
// project is migrated, so spec sync silently no-opped.
//
// These guards are drift detectors. They read the shipped prose, not the code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Paths that no longer exist once a project has migrated.
const RETIRED = [
  { re: /gspec\/features\/\*\.md/, name: 'gspec/features/*.md (flat PRD glob)' },
  { re: /gspec\/features\/<(?:slug|feature)>\.md/, name: 'gspec/features/<slug>.md (flat PRD)' },
  { re: /gspec\/tasks\//, name: 'gspec/tasks/ (removed by /gspec-migrate)' },
  { re: /\.plan\.md/, name: '.plan.md (pre-2.0 plan)' },
];

// A line may name a retired path when it is explicitly talking about the old
// layout — migration sources, and the read-both-layouts fallbacks.
const LEGACY_CONTEXT = /pre-migration|has not (?:yet )?run|older layout|oldest location|legacy/i;

// /gspec-migrate exists to read the old layout; every path in it is a source.
const EXEMPT_FILES = new Set(['plugin/commands/gspec-migrate.md']);

async function proseFiles() {
  const out = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'v1') continue; // v1 compat commands describe v1 on purpose
        await walk(p);
      } else if (e.name.endsWith('.md')) {
        out.push(p);
      }
    }
  };
  await walk(join(ROOT, 'plugin'));
  out.push(join(ROOT, 'templates', 'preamble.md'));
  return out;
}

test('no shipped prose sends an agent to a retired spec path', async () => {
  const offenders = [];
  for (const file of await proseFiles()) {
    const rel = relative(ROOT, file);
    if (EXEMPT_FILES.has(rel)) continue;
    const lines = (await readFile(file, 'utf-8')).split('\n');
    lines.forEach((line, i) => {
      if (LEGACY_CONTEXT.test(line)) return;
      for (const { re, name } of RETIRED) {
        if (re.test(line)) offenders.push(`${rel}:${i + 1} names ${name}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `retired spec paths in shipped prose:\n  ${offenders.join('\n  ')}`);
});

test('no EMITTED artifact, on any engine, names a retired spec path', async () => {
  // The source sweep above walks plugin/ and templates/ — it does not see the
  // frontmatter `description:` strings, which live in scripts/manifest.js and are
  // the ROUTING signal an engine reads to decide when to invoke a skill. Both
  // feature-writer and /gspec-plan shipped v1 paths there long after their bodies
  // were fixed, on all six targets. Scanning dist/ is the only check that covers
  // every source of an installed artifact at once.
  const dist = join(ROOT, 'dist');
  const offenders = [];
  const walk = async (dir) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!/\.(md|mdc|toml)$/.test(e.name)) continue;
      const rel = relative(ROOT, p);
      if (/gspec[-.]migrate/.test(rel)) continue; // reads the old layout on purpose
      (await readFile(p, 'utf-8')).split('\n').forEach((line, i) => {
        if (LEGACY_CONTEXT.test(line)) return;
        for (const { re, name } of RETIRED) {
          if (re.test(line)) offenders.push(`${rel}:${i + 1} names ${name}`);
        }
      });
    }
  };
  await walk(dist);
  assert.deepEqual(offenders.slice(0, 12), [], `retired spec paths in emitted artifacts:\n  ${offenders.join('\n  ')}`);
});

test('the writers name the v2 folder layout', async () => {
  const cases = [
    ['plugin/agents/feature-writer.md', /gspec\/features\/<slug>\/prd\.md/, 'a new PRD'],
    ['plugin/commands/gspec-plan.md', /gspec\/features\/<slug>\/tasks\.md/, 'a new plan'],
  ];
  for (const [rel, re, what] of cases) {
    const body = await readFile(join(ROOT, rel), 'utf-8');
    assert.match(body, re, `${rel} must say where ${what} is written`);
  }
});

test('migration is told to repair the links relocating a PRD breaks', async () => {
  // Moving features/<slug>.md to features/<slug>/prd.md breaks every relative
  // link pointing at it. Migrating a real repo left 21 dead links in
  // architecture.md alone: the migrator repaired PRD-to-PRD links by judgment,
  // but nothing told it to sweep specs that did not themselves move — and
  // architecture.md is stamp-only by design, so it was never revisited.
  const body = await readFile(join(ROOT, 'plugin', 'commands', 'gspec-migrate.md'), 'utf-8');
  assert.match(body, /repair every link/i, 'step 3 must mandate link repair');
  assert.match(body, /architecture\.md/, 'it must name the file that inbound links come from');
  assert.match(body, /resolves? on disk/i, 'repaired targets must be verified, not assumed');
});

test('a feature folder has an interactive producer for all four of its files', async () => {
  // FEATURE_FILES says a v2 feature is prd.md + arch.md + design.html + tasks.md.
  // Only `gspec build` ever wrote the middle two — feature-architect and
  // feature-designer are driven from lib/build.js, and no command invoked them.
  // /gspec-migrate meanwhile told users /gspec-plan would write them, which is
  // backwards: plan-decomposer READS the architecture to order its work. So a
  // migrated project could never complete a feature folder by hand.
  const cmd = async (n) => readFile(join(ROOT, 'plugin', 'commands', `${n}.md`), 'utf-8');

  const architect = await cmd('gspec-architect');
  assert.match(architect, /feature-architect/, '/gspec-architect must produce feature arch.md');
  assert.match(architect, /feature-designer/, '/gspec-architect must produce design.html');

  const plan = await cmd('gspec-plan');
  assert.doesNotMatch(plan, /delegate to the `feature-architect`/i, '/gspec-plan consumes arch.md, it does not write it');

  const migrate = await cmd('gspec-migrate');
  assert.match(migrate, /`\/gspec-architect`[^.]*writes them/, 'migration must name the command that actually writes them');
});

test('the preamble checkbox rule points at files that exist after migration', async () => {
  const body = await readFile(join(ROOT, 'templates', 'preamble.md'), 'utf-8');
  const rule = body.split('\n').find((l) => l.includes('Update feature checkboxes'));
  assert.ok(rule, 'the checkbox-sync rule must still be in the preamble');
  // This is the rule that makes "edit code, specs follow" work at all. Globbing
  // the flat path made it a silent no-op in every migrated project.
  assert.match(rule, /gspec\/features\/<slug>\/prd\.md/, 'must name the PRD location');
  assert.match(rule, /gspec\/features\/<slug>\/tasks\.md/, 'must name the plan location');
});
