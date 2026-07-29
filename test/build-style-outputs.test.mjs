// A stage's `outputs` are ALTERNATIVES, not a checklist. The style stage
// declares ['gspec/style.md', 'gspec/style.html'] and its writer produces
// exactly one of them (the validator target even joins the pair with " or ").
// The delivery check used to require ALL of them, so "did the writer deliver?"
// was permanently false for style: a clean write was reported as "produced no
// deliverable", retried, and then dead-ended — and the post-write-crash
// recovery path (accept a present, well-formed artifact despite a non-zero
// exit) could never fire either.
//
// Offline like the other build tests: a fake `pi` first on PATH plays every
// stage agent, and here it writes gspec/style.html only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, exists, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');

const AGENTS = STAGE_AGENTS;

// Everything passes; every writer delivers. FAKE_ENGINE_SH's style arm writes
// gspec/style.html and nothing else.
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nlooks complete\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// The style writer crashes AFTER writing its artifact, twice — the §7
// transient-post-write-crash shape, on the stage with alternative outputs.
const FAKE_PI_CRASH_AFTER_WRITE = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *'"Style guide" stage'*) write_spec gspec/style.html; printf 'wrote it, then died\\n'; exit 1 ;;
  *Validate*) printf 'VERDICT: PASS\\nlooks complete\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// Foundations OTHER than style are pre-seeded, so the style stage is the one
// that actually runs its writer.
async function seedProject(dir, fakePi) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), fakePi);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test('a style writer that produces ONE of its alternative outputs counts as delivered', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI);

  // Runs to the spec-review pause (exit 2) — well past the style stage.
  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);

  assert.ok(await exists(join(dir, 'gspec', 'style.html')));
  assert.ok(!(await exists(join(dir, 'gspec', 'style.md'))));
  // The bug's signature: a clean write mistaken for an empty one.
  assert.doesNotMatch(r.output, /style-writer exited 0 but produced no deliverable/);

  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(manifest.stages.style.status, 'done');
  assert.equal(manifest.stages.style.attempts, 1);
});

test('a style writer that crashes after writing one alternative output is recovered, not failed', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI_CRASH_AFTER_WRITE);

  const r = await runCli(['build', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output);
  assert.match(r.output, /its artifact is present and well-formed — accepting/);

  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(manifest.stages.style.status, 'done');
});
