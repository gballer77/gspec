// Template-library tests for `gspec build`: the user's saved specs under
// ~/.gspec must reach the writers of an AUTONOMOUS run. The interactive
// commands resolve the library with a shell and hand the writer an absolute
// path; a build has no such command, and the writers have no Bash — so the
// driver resolves it and names the candidates in the stage brief. Without that,
// a build silently ignored every saved template.
//
// Offline like the other build tests: a fake `pi` binary plays every agent and
// dumps each prompt it is handed, so the brief can be inspected directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, isolatedHome, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';
import { templateMeta, templateNote } from '../lib/build.js';

const AGENTS = STAGE_AGENTS;

// Every prompt this run hands out, one per file, so a test can read the brief a
// given stage's writer actually received.
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
printf '%s\\n' "$*" >> "$PROMPT_LOG"
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// Seed the user's library inside the test's isolated HOME (homedir() honors
// $HOME, so this never touches the developer's real ~/.gspec).
async function seedLibrary(files) {
  const home = await isolatedHome();
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(home, '.gspec', rel.split('/')[0]), { recursive: true });
    await writeFile(join(home, '.gspec', rel), body);
  }
  return home;
}

async function seedProject(dir, { seedFoundations = [] } = {}) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of seedFoundations) await writeFile(join(dir, 'gspec', f), 'seeded\n');
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}`, PROMPT_LOG: join(dir, 'prompts.log') };
}

async function prompts(dir) {
  return readFile(join(dir, 'prompts.log'), 'utf-8');
}

const PRACTICES_TEMPLATE = `---
description: Standard TDD, pipeline first, well named features
name: uber-practices
gspec-version: v1
---

# Development Practices Guide

Real content.
`;

// ---------------------------------------------------------------------------
// Reading the library
// ---------------------------------------------------------------------------

test('templateMeta reads name and description from a saved spec\'s frontmatter', () => {
  assert.deepEqual(templateMeta(PRACTICES_TEMPLATE, 'fallback'), {
    name: 'uber-practices',
    description: 'Standard TDD, pipeline first, well named features',
  });
  // Order-independent, quote-tolerant, and degrades to the filename.
  assert.deepEqual(templateMeta('---\nname: "quoted"\n---\nbody\n', 'fallback'), { name: 'quoted', description: '' });
  assert.deepEqual(templateMeta('no frontmatter at all', 'saas-stack'), { name: 'saas-stack', description: '' });
});

test('templateNote offers a stage its own library and nothing else', () => {
  const library = { practices: [{ path: '/home/u/.gspec/practices/uber.md', name: 'uber', description: 'TDD' }] };
  const note = templateNote({ id: 'practices' }, library);
  assert.match(note, /\/home\/u\/\.gspec\/practices\/uber\.md — uber: TDD/);
  assert.match(note, /ABSOLUTE paths/);

  // A stage whose library is empty says nothing at all about templates…
  assert.equal(templateNote({ id: 'stack' }, library), '');
  // …and profile/architecture have no library by design: they are inherently
  // project-specific and must never be seeded.
  assert.equal(templateNote({ id: 'profile' }, { profile: [{ path: '/x', name: 'x' }] }), '');
  assert.equal(templateNote({ id: 'architecture' }, { architecture: [{ path: '/x', name: 'x' }] }), '');
});

// ---------------------------------------------------------------------------
// Reaching the writer in an autonomous run
// ---------------------------------------------------------------------------

test('a saved practices template reaches the practices writer, by absolute path', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const home = await seedLibrary({ 'practices/uber-practices.md': PRACTICES_TEMPLATE });
  // Everything but practices is pre-seeded, so the practices writer is the one
  // stage writer that runs.
  const env = await seedProject(dir, { seedFoundations: ['profile.md', 'stack.md', 'style.md', 'style.html'] });

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output); // pauses at the spec-review gate
  assert.match(r.output, /templates: practices 1/);

  const log = await prompts(dir);
  const abs = join(home, '.gspec', 'practices', 'uber-practices.md');
  assert.ok(log.includes(abs), `the writer's brief must name the template's absolute path (${abs})`);
  assert.match(log, /uber-practices: Standard TDD/);
  assert.match(log, /Saved templates you may seed from \(practices library\)/);
});

test('a stage with no saved templates is told nothing about them', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedLibrary({ 'practices/uber-practices.md': PRACTICES_TEMPLATE });
  // The stack writer runs (stack.md absent), and the library has no stacks.
  const env = await seedProject(dir, { seedFoundations: ['profile.md', 'practices.md', 'style.md', 'style.html'] });

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);

  const log = await prompts(dir);
  assert.ok(!log.includes('Saved templates you may seed from'), 'no library for this stage → no templates block');
  // …and specifically never the practices library, which is not this stage's.
  assert.ok(!log.includes('uber-practices'), 'a stage is never offered another type\'s templates');
});

test('with no library at all the build runs exactly as before', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, { seedFoundations: ['profile.md', 'stack.md', 'style.md', 'style.html'] });

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);
  assert.ok(!r.output.includes('templates:'), 'an absent library is silent, not an error');
  assert.ok(!(await prompts(dir)).includes('Saved templates'));
});

test('feature PRDs get the features library; the planner does not', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const home = await seedLibrary({
    'features/checkout.md': '---\nname: checkout\ndescription: A standard checkout PRD\n---\n\n# Checkout\n',
  });
  const env = await seedProject(dir, { seedFoundations: ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html'] });

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);

  const abs = join(home, '.gspec', 'features', 'checkout.md');
  // One prompt per line: the writer's names the template, the planner's must not
  // — a planner decides the breakdown, not the content.
  const lines = (await prompts(dir)).split('\n').filter(Boolean);
  const planner = lines.filter((l) => l.includes('feature-plan JSON'));
  const writer = lines.filter((l) => l.includes('gspec/features/') && !l.includes('feature-plan JSON') && !l.includes('Validate'));
  assert.ok(planner.length, 'the feature planner ran');
  assert.ok(writer.some((l) => l.includes(abs)), 'the PRD writer was offered the features library');
  assert.ok(!planner.some((l) => l.includes(abs)), 'the planner was not');
});
