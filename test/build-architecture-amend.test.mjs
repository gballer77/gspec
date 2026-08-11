// Adding a feature to a product that already has an architecture.
//
// The architecture stage is deliberately NOT skip-if-present: a new feature
// routinely needs a new module, contract or spine anchor, and skipping would
// leave its arch.md pointing at a tier that never learned about it. But that
// means the writer runs against a REVIEWED document, and it used to run with no
// idea that it was amending one — the agent prose was written entirely in
// create voice and the stage passed no note.
//
// The failure that makes this worth a floor rather than a prompt: the Modules &
// Verification table is the derivation key for the whole module tier. Each row
// name produces gspec/architecture/<name>.md, and every feature arch.md points
// into the tier by path. Rename a row and nothing re-points the features —
// they keep parsing, keep linting clean (archLintViolations reads one file at a
// time and never resolves a path), and now name a file that is not there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { architectureSnapshot, lintArchitectureAmend, STAGES } from '../lib/build.js';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS, REPO_ROOT } from './helpers.mjs';

const archWithModule = (name) => `---
spec-version: v2
---

# Architecture

## Modules & Verification

| name | dir | build | test |
| --- | --- | --- | --- |
| ${name} | . | npm run build | npm test |
`;

// --- the floor, in isolation ------------------------------------------------

test('the snapshot is the table, and an unwritten architecture has no rows', async () => {
  const dir = await makeProject();
  try {
    assert.deepEqual(await architectureSnapshot(dir), []);
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'), archWithModule('app'), 'utf-8');
    assert.deepEqual(await architectureSnapshot(dir), [
      { name: 'app', dir: '.', build: 'npm run build', test: 'npm test' },
    ]);
  } finally { await cleanup(dir); }
});

test('a row that survives the rewrite raises nothing', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'), archWithModule('app'), 'utf-8');
    const before = await architectureSnapshot(dir);
    assert.deepEqual(await lintArchitectureAmend(dir, before), []);
  } finally { await cleanup(dir); }
});

test('a renamed row is a violation that names the module and the orphaned path', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'), archWithModule('api'), 'utf-8');
    const before = await architectureSnapshot(dir);

    // The rewrite the floor exists to catch.
    await writeFile(join(dir, 'gspec', 'architecture.md'), archWithModule('backend'), 'utf-8');
    const violations = await lintArchitectureAmend(dir, before);
    assert.equal(violations.length, 1);
    // The message has to carry the old name AND the path it derives, because a
    // writer handed only "a row is missing" cannot tell which way to fix it.
    assert.match(violations[0], /"api"/);
    assert.match(violations[0], /gspec\/architecture\/api\.md/);
  } finally { await cleanup(dir); }
});

test('a table gutted entirely reports every row it lost', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    const two = archWithModule('web').replace(
      '| web | . | npm run build | npm test |',
      '| web | . | npm run build | npm test |\n| api | api | make | make test |');
    await writeFile(join(dir, 'gspec', 'architecture.md'), two, 'utf-8');
    const before = await architectureSnapshot(dir);
    assert.equal(before.length, 2);

    await writeFile(join(dir, 'gspec', 'architecture.md'),
      '---\nspec-version: v2\n---\n\n# Architecture\n\n## Overview\n\nNo table at all.\n', 'utf-8');
    assert.equal((await lintArchitectureAmend(dir, before)).length, 2);
  } finally { await cleanup(dir); }
});

test('a greenfield write cannot trip the floor — there is no baseline to lose', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'), archWithModule('app'), 'utf-8');
    assert.deepEqual(await lintArchitectureAmend(dir, []), []);
  } finally { await cleanup(dir); }
});

test('the architecture stage carries the amend wiring', () => {
  const stage = STAGES.find((s) => s.id === 'architecture');
  assert.equal(typeof stage.snapshot, 'function', 'the baseline has to be captured before the writer runs');
  assert.equal(typeof stage.amendLint, 'function', 'the floor has to be attached to the stage, not the case block');
  assert.match(stage.note, /AMENDING/, 'the writer is told which mode it is in');
  assert.match(stage.note, /Modules & Verification/, 'and told the specific invariant the floor will enforce');
});

test('the writer agent itself carries the rule, not just the build runtime', async () => {
  // /gspec-architect delegates to the same agent with no runtime around it, so a
  // rule that lives only in lib/build.js protects the autonomous path and leaves
  // the interactive one exactly as exposed as it was.
  const md = await readFile(join(REPO_ROOT, 'plugin', 'agents', 'architecture-writer.md'), 'utf-8');
  assert.match(md, /already exists/i);
  assert.match(md, /Never rename or delete a row/i);
  const cmd = await readFile(join(REPO_ROOT, 'plugin', 'commands', 'gspec-architect.md'), 'utf-8');
  assert.match(cmd, /amendment, not a rewrite/i);
});

// --- end to end, through the driver -----------------------------------------

// An architecture-writer that renames the project's one module on its first
// pass and puts it back only when the floor hands it the violation.
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
write_arch_table() {
  mkdir -p gspec gspec/architecture
  printf '%s\\n' '---' 'spec-version: v2' '---' '' '# Architecture' '' '## Modules & Verification' '' '| name | dir | build | test |' '| --- | --- | --- | --- |' "| $1 | . | npm run build | npm test |" > gspec/architecture.md
  printf '%s\\n' '---' 'spec-version: v2' "module: $1" '---' '' '# Module architecture' '' 'Fake.' > "gspec/architecture/$1.md"
}
case "$*" in
  *feature-plan*) printf '\`\`\`json\\n{"features":[{"slug":"only-thing","title":"Only thing","brief":"just this","priority":"P0","dependencies":[]}]}\\n\`\`\`\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *"Fix these mechanical problems in gspec/architecture.md"*) printf '%s\\n' "$*" >> arch-fix-prompt.txt; write_arch_table app; printf 'fixed\\n' ;;
  *'"Architecture" stage'*) printf '%s\\n' "$*" >> arch-prompt.txt; write_arch_table core; printf 'ok\\n' ;;
  *) fake_default "$*" ;;
esac
`;

async function seedBuildProject(dir, { existingArchitecture = false } = {}) {
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Add one feature to it.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  if (existingArchitecture) {
    // The brownfield shape: a reviewed architecture and its module tier.
    await mkdir(join(dir, 'gspec', 'architecture'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'), archWithModule('app'), 'utf-8');
    await writeFile(join(dir, 'gspec', 'architecture', 'app.md'),
      '---\nspec-version: v2\nmodule: app\n---\n\n# Module architecture\n\nReviewed.\n', 'utf-8');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test('an existing architecture is amended, and a dropped module row is caught and fixed', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, { existingArchitecture: true });

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);

  // The writer was told it was amending — this is the half a floor cannot do.
  const prompt = await readFile(join(dir, 'arch-prompt.txt'), 'utf-8');
  assert.match(prompt, /AMENDING a reviewed architecture/,
    'the stage note has to reach the writer, not just sit in the stage table');
  assert.match(r.output, /already exists — amending it/, 'and the run has to say so');

  // The floor caught the rename and said exactly what was lost.
  assert.match(r.output, /lint issue/, 'the dropped row is a mechanical finding, not a validator one');
  assert.match(r.output, /no longer has a row named "app"/);
  const fix = await readFile(join(dir, 'arch-fix-prompt.txt'), 'utf-8');
  assert.match(fix, /gspec\/architecture\/app\.md/, 'the fix prompt names the path that would be orphaned');

  // And the run recovered rather than pausing: the row is back.
  const arch = await readFile(join(dir, 'gspec', 'architecture.md'), 'utf-8');
  assert.match(arch, /\|\s*app\s*\|/, 'the original module name survived the amendment');
  assert.equal(r.code, 0, r.output);
});

test('a greenfield run is not told it is amending anything', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir, { existingArchitecture: false });

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);

  const prompt = await readFile(join(dir, 'arch-prompt.txt'), 'utf-8');
  assert.doesNotMatch(prompt, /AMENDING/,
    'there is nothing to preserve on a first authoring, and saying otherwise invites the writer to invent a history');
  // Nothing existed, so nothing can have been dropped — the floor stays quiet.
  assert.doesNotMatch(r.output, /no longer has a row named/);
  assert.equal(r.code, 0, r.output);
});
