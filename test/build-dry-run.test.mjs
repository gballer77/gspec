// `gspec build --dry-run` is a PREVIEW: it prints the stage plan and touches
// nothing. The regression it guards is not cosmetic.
//
// A dry run used to persist its whole run record — run.json with every stage
// marked done/PASS, plus audit-report.md and unparsed-plan.md. So previewing a
// plan and then building for real was refused with "a build run already
// exists", and a user following that message's own advice (`--resume`) resumed
// the fake finished run: every stage already "done", nothing built, exit 0.
//
// These assertions run a REAL dry run and read the directory back, rather than
// checking a fixture — the bug survived because the tests that could have seen
// it were seeding themselves from the very file that should not have existed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { runCli, makeProject, cleanup, exists, seedInstall, seedRun } from './helpers.mjs';

const BUILD_DIR = join('.gspec', 'build');

async function buildDirEntries(dir) {
  try { return (await readdir(join(dir, BUILD_DIR))).sort(); } catch { return []; }
}

test('--dry-run leaves no run state behind at all', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  const r = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /DRY RUN/, 'sanity: the run really was a preview');
  assert.match(r.output, /would run: pi /, 'sanity: it really walked the stage graph');

  assert.deepEqual(
    await buildDirEntries(dir),
    [],
    'a preview must write nothing into .gspec/build/ — not run.json, not audit-report.md, not unparsed-plan.md',
  );
});

test('--dry-run does not block the real build that follows it', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  // The exact sequence a user performs: preview the plan, then commit to it.
  const preview = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(preview.code, 0, preview.output);

  // The real build must get as far as intake (the first interactive step),
  // NOT be turned away because the preview left a run record behind.
  const real = await runCli(['build', 'an idea'], dir);
  assert.doesNotMatch(
    real.output,
    /A build run already exists/,
    'a preview must not look like a run in progress to the build that follows it',
  );
});

test('a dry run over an existing run does not mutate it', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });

  // A real run that has already paused mid-way, with a brief on disk so the
  // dry run walks the full graph instead of stopping at intake.
  await mkdir(join(dir, BUILD_DIR), { recursive: true });
  await writeFile(join(dir, BUILD_DIR, 'brief.md'), '# Brief\n\nscope: standard\n');
  await seedRun(dir, { engine: 'pi', idea: 'the real idea' });
  const before = await buildDirEntries(dir);

  const r = await runCli(['build', '--resume', '--dry-run'], dir);
  assert.equal(r.code, 0, r.output);

  assert.deepEqual(await buildDirEntries(dir), before, 'a preview must not add files to a real run');
  const after = JSON.parse(await readFile(join(dir, BUILD_DIR, 'run.json'), 'utf-8'));
  assert.equal(after.idea, 'the real idea');
  assert.equal(
    after.stages.profile.status,
    'pending',
    'the preview walked every stage — none of that may land on the real run record',
  );
  assert.ok(!(await exists(join(dir, BUILD_DIR, 'status.json'))), 'no status.json from a preview');
});
