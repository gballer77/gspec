// A build records the run STOPPING. It also has to record the run being STOPPED.
//
// Interruptions are only opened on the stage-failure path, so everything that
// ends a run without a failing verdict — closing a laptop, killing the driver,
// losing power — leaves no trace. On resume there is no open interruption to
// close, and the gap simply is not there.
//
// Measured on a real build: run.json reported 3 stops totalling ~2.5 hours for
// a run whose engine transcripts show 91.2 idle hours out of 99.6 wall clock,
// including one 75.9-hour gap that nothing recorded. "How much of this run was
// just waiting?" came back wrong by 36x — worse than keeping no record, because
// the number reads like an answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, seedRun } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');

async function seedStoppedRun(dir, agoMs) {
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), '# Brief\n\nscope: small\n');
  const stopped = new Date(Date.now() - agoMs).toISOString();
  // A run that was alive and then simply stopped: no pause record, because
  // nothing was running to write one.
  await seedRun(dir, { engine: 'pi', createdAt: stopped, updatedAt: stopped });
}

test('a resume records the time the run was not running at all', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });
  await seedStoppedRun(dir, 3 * 60 * 60_000); // driver dead for three hours

  const r = await runCli(['build', '--resume', '--dry-run'], dir);
  assert.equal(r.code, 0, r.output);
  // --dry-run must still not write: the preview reports nothing and records
  // nothing, which is what makes this safe to assert against a real run.
  const untouched = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.ok(!untouched.pauses?.length, 'a preview must not record an interruption');

  const real = await runCli(['build', '--resume'], dir);
  assert.match(real.output, /was not running for/, 'the gap must be announced on the way in');

  // Filter rather than count: with no engine on PATH the stages themselves
  // fail, which opens the ordinary failure interruption too. The one under test
  // is the gap BEFORE any of that ran.
  const m = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  const unattended = (m.pauses || []).filter((x) => x.unattended);
  assert.equal(unattended.length, 1, 'the stop must be recorded even though nothing failed');
  const p = unattended[0];
  assert.equal(p.unattended, true, 'and marked as the driver being stopped');
  assert.equal(p.limit, false, 'a stopped driver is not a usage limit');
  assert.ok(p.waitedMs >= 2.5 * 60 * 60_000, `the measured wait must be the real gap (got ${p.waitedMs})`);
  assert.ok(p.resumedAt, 'and it is closed immediately — the waiting already happened');
  assert.match(real.output, /not running/, 'reported as "not running", never as a failure');
});

test('an immediate resume is not an interruption', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });
  await seedStoppedRun(dir, 5_000); // stopped and restarted right away

  const r = await runCli(['build', '--resume'], dir);
  const m = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.ok(
    !(m.pauses || []).some((x) => x.unattended),
    'a few seconds between runs is not a stop worth recording',
  );
  assert.doesNotMatch(r.output, /was not running for/);
});
