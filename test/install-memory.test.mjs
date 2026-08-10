// The memory store, both tiers.
//
// A committed memory used to be written into `.claude/skills/<name>/SKILL.md`,
// which the next install overwrites — while the review step deleted the pending
// copy that would have survived. Committing a memory therefore moved it from the
// store that outlives an upgrade into the one that does not, then deleted the
// survivor. These tests pin the fix: memory lives outside the overwrite path and
// is composed back in on every install, so an upgrade is idempotent rather than
// destructive.
//
// Recording then joined it: `.gspec/memory/pending/` replaced the Claude-only
// per-agent memory silo, so the loop runs on every engine. The second half of
// this file pins the property that keeps the two tiers honest — pending is a
// SUBDIRECTORY the composer never reads, so nothing reaches a skill unreviewed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { runCli, makeProject, cleanup, isolatedHome } from './helpers.mjs';

const SKILL = join('.claude', 'skills', 'gspec-practices', 'SKILL.md');

const seedProject = async (dir, name, body) => {
  await mkdir(join(dir, '.gspec', 'memory'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'memory', `${name}.md`), body, 'utf-8');
};
const seedPersonal = async (name, body) => {
  const home = await isolatedHome();
  await mkdir(join(home, '.gspec', 'memory'), { recursive: true });
  await writeFile(join(home, '.gspec', 'memory', `${name}.md`), body, 'utf-8');
};
const clearPersonal = (name) => seedPersonal(name, '');

const install = (dir) => runCli(['-t', 'claude', '--models', 'none'], dir, {}, 'y\n');

test('a project memory is composed into the installed skill', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedProject(dir, 'gspec-practices', '## Always require a root README\nOtherwise a reader guesses which folder to open.\n');
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.match(skill, /Always require a root README/);
  assert.match(skill, /Otherwise a reader guesses which folder to open/, 'the memory body must survive, not just its heading');
});

test('project composes after personal, so the more specific one wins', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedPersonal('gspec-practices', '## Personal habit\nCarried onto every project.\n');
  await seedProject(dir, 'gspec-practices', '## Project rule\nTrue only of this repository.\n');
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  const personalAt = skill.indexOf('Personal habit');
  const projectAt = skill.indexOf('Project rule');
  assert.ok(personalAt > -1 && projectAt > -1, 'both stores must compose');
  assert.ok(projectAt > personalAt, 'project must come last — precedence is carried by ordering');
  assert.match(skill, /the project memory wins/, 'and stated in prose, not left to ordering alone');
});

// The property that makes an upgrade safe: re-running the installer must not
// stack a second copy of the block, or the skill grows without bound.
test('composing is idempotent across repeated installs', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedProject(dir, 'gspec-practices', '## Only once\nBody.\n');
  await install(dir);
  await install(dir);
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.equal((skill.match(/gspec:memory:start/g) || []).length, 1, 'exactly one fenced block');
  assert.equal((skill.match(/^## Only once$/gm) || []).length, 0, 'the memory is demoted, never left at H2');
  assert.equal((skill.match(/^#### Only once$/gm) || []).length, 1, 'present exactly once, at H4');
});

// A memory heading sits under `### Personal` / `### Project`, so it has to be
// demoted or it becomes a sibling of "Remembered" and breaks the section it
// belongs to. The whole heading text must survive the rewrite.
test('memory headings are demoted without losing their text', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedProject(dir, 'gspec-practices', '## Always require a root README\ntext\n\n### A nested heading\nmore\n');
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.match(skill, /^#### Always require a root README$/m, 'H2 → H4, full text intact');
  assert.match(skill, /^##### A nested heading$/m, 'H3 → H5');
});

// A fenced code block in a memory may legitimately contain `#` lines; rewriting
// those would corrupt an example the memory exists to show.
test('headings inside a fenced code block are left alone', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedProject(dir, 'gspec-practices', '## Shell example\n\n```bash\n# not a heading\necho hi\n```\n');
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.match(skill, /^# not a heading$/m, 'a comment inside a fence keeps its level');
});

// A typo in a memory filename looks exactly like a memory that never applied.
test('a memory naming no installed skill is reported, not dropped silently', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  await seedProject(dir, 'gspec-nonexistent', '## Orphan\nBody.\n');
  const r = await install(dir);

  assert.match(r.output, /gspec-nonexistent.*matches no installed skill/);
});

test('memory apply recomposes without a full install', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedProject(dir, 'gspec-practices', '## Added later\nWithout reinstalling.\n');

  const r = await runCli(['memory', 'apply'], dir);
  assert.equal(r.code, 0, r.output);
  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.match(skill, /Without reinstalling/);
});

// --- The third category: reports about gspec itself ---

const seedReport = async (name, body) => {
  const home = await isolatedHome();
  await mkdir(join(home, '.gspec', 'memory', 'gspec'), { recursive: true });
  await writeFile(join(home, '.gspec', 'memory', 'gspec', `${name}.md`), body, 'utf-8');
};

test('a gspec report is never composed into a skill', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedReport('a-bug', '---\ntitle: a bug\nstatus: unsent\n---\n\nNEVER_COMPOSE_ME\n');
  // A stray `gspec.md` beside the real stores would otherwise be read as a
  // memory for a skill literally named "gspec".
  const home = await isolatedHome();
  await writeFile(join(home, '.gspec', 'memory', 'gspec.md'), '## also never\nNEVER_COMPOSE_ME_EITHER\n', 'utf-8');
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.doesNotMatch(skill, /NEVER_COMPOSE_ME/, 'a bug report is not agent guidance');
  await writeFile(join(home, '.gspec', 'memory', 'gspec.md'), '', 'utf-8');
});

test('an unsent report yields a prefilled issue url; filed records it', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedReport('lint-false-positive', '---\ntitle: "lint: fires falsely"\nstatus: unsent\n---\n\nThe check rejects a valid anchor.\n');

  const listed = await runCli(['memory', 'report'], dir);
  assert.match(listed.output, /1 unsent/);
  assert.match(listed.output, /github\.com\/gballer77\/gspec\/issues\/new\?title=/);
  assert.doesNotMatch(listed.output, /title=%22/, 'a quoted YAML title must not carry its quotes into the issue');

  const filed = await runCli(['memory', 'filed', 'lint-false-positive', 'https://example.test/issues/7'], dir);
  assert.equal(filed.code, 0, filed.output);

  const after = await runCli(['memory', 'report'], dir);
  assert.match(after.output, /0 unsent/);
  assert.match(after.output, /example\.test\/issues\/7/);
});

test('an oversized report is truncated to a usable url, and says so', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedReport('huge', `---\ntitle: huge\nstatus: unsent\n---\n\n${'x'.repeat(20000)}\n`);

  const r = await runCli(['memory', 'report'], dir);
  const url = (r.output.match(/https:\/\/github\.com\S+/) || [''])[0];
  assert.ok(url.length > 0 && url.length < 8000, `url must stay requestable, got ${url.length}`);
  assert.match(r.output, /truncated/, 'a silently shortened report is worse than one that admits it');
});

// --- The pending tier ---
//
// Pending is a SUBDIRECTORY of the memory store, not a sibling file, precisely so
// the composer cannot reach it. An unreviewed memory composing into a skill would
// be auto-committing — the exact thing producer≠checker exists to prevent.

const seedPending = async (dir, agent, file, body) => {
  await mkdir(join(dir, '.gspec', 'memory', 'pending', agent), { recursive: true });
  await writeFile(join(dir, '.gspec', 'memory', 'pending', agent, file), body, 'utf-8');
};

test('a pending memory is never composed into a skill', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  await seedPending(dir, 'practices-writer', 'auth--never-compose.md',
    '---\ntarget: gspec-practices\nlayer: skill\n---\n\n## Unreviewed\nNEVER_COMPOSE_PENDING\n');
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.doesNotMatch(skill, /NEVER_COMPOSE_PENDING/, 'committing is the reviewed path, not a directory scan');
});

// A stray `pending.md` beside the real stores would otherwise be read as a memory
// for a skill literally named "pending" — the same trap `gspec.md` sets.
test('a stray pending.md is not composed either', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  await mkdir(join(dir, '.gspec', 'memory'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'memory', 'pending.md'), '## stray\nNEVER_COMPOSE_STRAY\n', 'utf-8');
  const r = await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.doesNotMatch(skill, /NEVER_COMPOSE_STRAY/);
  assert.doesNotMatch(r.output, /"pending\.md" matches no installed skill/, 'skipped outright, not reported as an orphan');
});

test('memory list surfaces pending memories separately from composed ones', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  await seedPending(dir, 'practices-writer', 'auth--require-a-readme.md',
    '---\ntarget: gspec-practices\nlayer: skill\n---\n\n## Always require a root README\nBody.\n');

  const r = await runCli(['memory'], dir);
  assert.match(r.output, /1 pending memory/);
  assert.match(r.output, /practices-writer/);
  assert.match(r.output, /Always require a root README/, 'the heading is what a human reads, not the filename');
  assert.match(r.output, /awaiting review/, 'pending changes nothing until committed — say so');
});

// Capture moved off the Claude-only memory silo so the loop runs everywhere. A
// target that INLINES skills rather than preloading them resolves them by name,
// and gspec-memory lives in its own catalog — so it is exactly the thing a
// V2_SKILLS-only lookup drops silently, leaving those engines with no loop at all.
test('a non-preloading target inlines the capture convention into its writers', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await runCli(['-t', 'opencode', '--models', 'none'], dir, {}, 'y\n');

  const agent = await readFile(join(dir, '.opencode', 'agent', 'practices-writer.md'), 'utf-8');
  assert.match(agent, /gspec-memory/, 'the convention must be inlined, not dropped');
  assert.match(agent, /\.gspec\/memory\/pending\//, 'and it must name where a memory goes');

  const validator = await readFile(join(dir, '.opencode', 'agent', 'practices-validator.md'), 'utf-8');
  assert.doesNotMatch(validator, /## gspec-memory/, 'a read-only agent has no Write tool and so cannot record');
});

// --- Migration off the pre-3.7 per-agent memory silos ---

test('a pre-3.7 memory silo is swept into pending, one file per memory', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  const silo = join(dir, '.claude', 'agent-memory', 'practices-writer');
  await mkdir(silo, { recursive: true });
  await writeFile(join(silo, 'MEMORY.md'),
    '# practices-writer\n\n## Always require a root README\n- target: gspec-practices\n- layer: skill\n\n## Pin the package manager\n- target: gspec-architect\n- layer: skill\n', 'utf-8');

  const r = await install(dir);
  assert.match(r.output, /Migrated 2 memories/);

  const pendingDir = join(dir, '.gspec', 'memory', 'pending', 'practices-writer');
  const files = (await readdir(pendingDir)).sort();
  assert.equal(files.length, 2, 'one file per memory, not one file per silo');
  const first = await readFile(join(pendingDir, files[0]), 'utf-8');
  assert.match(first, /## Always require a root README/);
  assert.match(first, /target: gspec-practices/, 'the old address tag carries across verbatim');

  // Nothing destroyed, and the rename is what stops a second sweep.
  await assert.rejects(readFile(join(silo, 'MEMORY.md'), 'utf-8'), /ENOENT/);
  assert.match(await readFile(join(silo, 'MEMORY.md.migrated'), 'utf-8'), /Always require a root README/);

  const again = await install(dir);
  assert.doesNotMatch(again.output, /Migrated \d+ memor/, 're-running the installer is a no-op');
  assert.equal((await readdir(pendingDir)).length, 2, 'and never duplicates what it already swept');
});

// The store's own rename. A project sitting on the old path would otherwise stop
// composing silently — the loader looks only at `memory/`, so nothing would error.
test('a pre-3.7 .gspec/lessons/ store is renamed to .gspec/memory/ and composes', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  await mkdir(join(dir, '.gspec', 'lessons'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'lessons', 'gspec-practices.md'), '## Always require a root README\nMOVED_ACROSS\n', 'utf-8');

  const r = await install(dir);
  assert.match(r.output, /Moved .*\.gspec\/lessons\/ → \.gspec\/memory\//);
  assert.match(await readFile(join(dir, '.gspec', 'memory', 'gspec-practices.md'), 'utf-8'), /MOVED_ACROSS/);
  await assert.rejects(readdir(join(dir, '.gspec', 'lessons')), /ENOENT/, 'a rename, so the old path is gone');
  // Composed on the very install that moved it — not one install later.
  assert.match(await readFile(join(dir, SKILL), 'utf-8'), /MOVED_ACROSS/);
});

// Merging two stores could resurrect a memory the user deleted, so a collision is
// reported and left alone rather than resolved by guesswork.
test('a lessons/ store beside an existing memory/ store is left alone and named', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  await seedProject(dir, 'gspec-practices', '## Current\nKEPT.\n');
  await mkdir(join(dir, '.gspec', 'lessons'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'lessons', 'gspec-practices.md'), '## Stale\nRESURRECTED.\n', 'utf-8');

  const r = await install(dir);
  assert.match(r.output, /still exists and .*memory.* does too/);
  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.match(skill, /KEPT/);
  assert.doesNotMatch(skill, /RESURRECTED/, 'only the memory/ store is read');
});

test('migrated memories are still not composed into a skill', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await install(dir);
  const silo = join(dir, '.claude', 'agent-memory-local', 'practices-writer');
  await mkdir(silo, { recursive: true });
  await writeFile(join(silo, 'MEMORY.md'), '## Migrated memory\n- target: gspec-practices\n- layer: skill\nNEVER_COMPOSE_MIGRATED\n', 'utf-8');
  await install(dir);

  const skill = await readFile(join(dir, SKILL), 'utf-8');
  assert.doesNotMatch(skill, /NEVER_COMPOSE_MIGRATED/, 'a migrated memory lands in the review queue, not in a skill');
});

test('memory list names each skill and both store paths', async (t) => {
  const dir = await makeProject();
  t.after(async () => { await clearPersonal('gspec-practices'); await cleanup(dir); });
  await install(dir);
  await seedProject(dir, 'gspec-practices', '## One\nA.\n\n## Two\nB.\n');

  const r = await runCli(['memory'], dir);
  assert.match(r.output, /gspec-practices/);
  assert.match(r.output, /2 project/, 'counts the `## ` entries');
  assert.match(r.output, /Project memories override personal/);
});
