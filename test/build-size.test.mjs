// Size measurement end-to-end (feedback §1). The writer prompts carry the
// budget, but a model asked to self-limit reports compliance while producing
// lines twice as long — so the driver measures what actually landed on disk and
// says so while the run is still going.
//
// The contract these tests pin: measurement is ADVISORY. An over-budget spec is
// reported loudly and the run continues; size alone must never fail a stage.
// Offline like the other build tests — a fake `pi` binary plays every agent, and
// here the profile writer really does write an oversized file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

const AGENTS = STAGE_AGENTS;

// The profile writer writes a 5,000-word profile — 2.5× the standard budget.
// Every other agent is a no-op that exits 0.
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *"Product profile"*)
    mkdir -p gspec
    i=0; : > gspec/profile.md
    while [ $i -lt 100 ]; do
      printf 'word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word\\n' >> gspec/profile.md
      i=$((i+1))
    done
    printf 'wrote the profile\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *) fake_default "$*" ;;
esac
`;

// Everything except the profile is pre-seeded, so only the profile stage runs a
// writer; the rest skip as already-present.
async function seedProject(dir) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo app.\nscope: standard\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test('an over-budget spec is reported with its size, and does not fail the stage', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);

  const r = await runCli(['build', '--no-qa', 'an idea'], dir, env);

  // Exit 0 = paused at the spec-review gate, i.e. the run carried on past the
  // oversized profile. This is the whole point: advisory, never a gate.
  assert.equal(r.code, 2, r.output); // exit 2 = paused at the spec-review gate, not complete
  assert.match(r.output, /gspec\/profile\.md — 5000 words, 2\.5× its 2000-word budget/);
  assert.match(r.output, /does not block/);
  assert.match(r.output, /✓ Product profile/, 'the stage still passed');
});

test('--scope scales the budget and is recorded on the manifest', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);

  const r = await runCli(['build', '--no-qa', '--scope', 'small', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output); // exit 2 = paused at the spec-review gate, not complete
  assert.match(r.output, /scope: small/);
  // 2000 × 0.6 = 1200, so the same file is now 4.2× over.
  assert.match(r.output, /4\.2× its 1200-word budget, small scope/);
});

test('an unknown --scope is rejected before anything runs', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);

  const r = await runCli(['build', '--scope', 'enormous', 'an idea'], dir, env);
  assert.equal(r.code, 1);
  assert.match(r.output, /--scope must be one of: small, standard, large/);
});

test('a spec inside its budget is reported quietly, with no over-budget warning', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir);
  // A profile already present and small: the stage skips the writer entirely,
  // so nothing is measured and nothing is warned about.
  await writeFile(join(dir, 'gspec', 'profile.md'), '# Profile\n\nA short profile.\n');

  const r = await runCli(['build', '--no-qa', 'an idea'], dir, env);
  assert.equal(r.code, 2, r.output); // exit 2 = paused at the spec-review gate, not complete
  assert.doesNotMatch(r.output, /budget.*\(advisory/);
});
