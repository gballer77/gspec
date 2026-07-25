// QA-gate failure reporting tests for `gspec build`: the regression suite for
// "the build paused at a QA gate but never said why it failed or that action
// was needed" (hit on the architecture stage under the pi engine). A fake `pi`
// binary first on PATH plays every stage agent, so the whole run is
// deterministic and offline: writers exit 0, validators return a canned
// verdict selected by FAKE_PI_VERDICT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, exists, seedInstall } from './helpers.mjs';
import { revisePrompt } from '../lib/build.js';

const RUN_JSON = join('.gspec', 'build', 'run.json');
const LAST_FAILURE = join('.gspec', 'build', 'last-failure.md');
const QA_LOG = join('.gspec', 'build', 'qa-failures.md');

// Every agent a full run can invoke (foundations are pre-seeded so their
// writers never run, but the files are cheap to create).
const AGENTS = [
  'profile-writer', 'stack-writer', 'practices-writer', 'style-writer',
  'feature-planner', 'feature-writer', 'feature-validator',
  'architecture-writer', 'architecture-validator',
  'plan-decomposer', 'plan-validator',
  'build-orchestrator', 'implementer', 'implementation-validator',
  'codebase-inspector',
];

// Validator prompts are the only ones containing "Validate" (see
// validatorPrompt in lib/build.js); everything else just needs to exit 0.
const FAKE_PI = `#!/bin/sh
case "$*" in
  *Validate*)
    if [ "$FAKE_PI_VERDICT" = "PASS" ]; then
      printf 'VERDICT: PASS\\nLooks complete.\\n'
    else
      printf 'VERDICT: FAIL\\nBlocking findings:\\n- The Deployables table is missing from gspec/architecture.md.\\n- No failure-mode section for the queue worker.\\n'
    fi
    ;;
  *) printf 'ok\\n' ;;
esac
`;

// A validator that FAILs its FIRST call and PASSes every call after it, so a
// stage recovers on its self-heal revision and the whole run completes. The
// call count lives in a file ($FAKE_PI_COUNTER) so it survives across the fake's
// short-lived processes.
const FAKE_PI_RECOVER = `#!/bin/sh
case "$*" in
  *Validate*)
    n=$(cat "$FAKE_PI_COUNTER" 2>/dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "$FAKE_PI_COUNTER"
    if [ "$n" = "1" ]; then
      printf 'VERDICT: FAIL\\nBlocking findings:\\n- The Deployables table is missing from gspec/architecture.md.\\n'
    else
      printf 'VERDICT: PASS\\nLooks complete.\\n'
    fi
    ;;
  *) printf 'ok\\n' ;;
esac
`;

// A pi project ready to run headlessly straight to the architecture gate:
// brief present (skips the interactive intake), foundation outputs pre-seeded
// (skip-if-present), no feature PRDs (so the features/plan stages are cheap),
// fake `pi` first on PATH. `fakePi` swaps the validator behavior per test.
async function seedBuildProject(dir, fakePi = FAKE_PI) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), fakePi);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}`, FAKE_PI_COUNTER: join(dir, 'qa-counter') };
}

test('a failed QA gate pauses with the verdict, an action banner, and a durable report', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', 'an idea'], dir, { ...env, FAKE_PI_VERDICT: 'FAIL' });
  assert.equal(r.code, 1, r.output);

  // The pause says WHY: the verdict that ended the run, not a truncated excerpt…
  assert.match(r.output, /Architecture — QA gate did not pass after one revision/);
  assert.match(r.output, /Why it failed:/);
  assert.match(r.output, /Deployables table is missing/);
  assert.match(r.output, /failure-mode section for the queue worker/);
  // …and says THAT action is needed, and how to continue.
  assert.match(r.output, /Action required: the build is paused at "Architecture"/);
  assert.match(r.output, /--resume/);

  // The full verdict survives the terminal: last-failure.md and the manifest.
  const report = await readFile(join(dir, LAST_FAILURE), 'utf-8');
  assert.match(report, /Build paused: Architecture \(architecture\) failed/);
  assert.match(report, /Deployables table is missing/);
  assert.match(report, /gspec build --resume/);
  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(manifest.stages.architecture.status, 'failed');
  assert.match(manifest.stages.architecture.detail, /Deployables table is missing/);

  // …and the cumulative QA log has the full verdict, including a TERMINAL entry
  // marking where the run paused.
  const qalog = await readFile(join(dir, QA_LOG), 'utf-8');
  assert.match(qalog, /gspec build — QA failure log/);
  assert.match(qalog, /architecture · TERMINAL/);
  assert.match(qalog, /Deployables table is missing/);
});

test('a QA failure the self-heal recovers from is still logged durably, and the log survives completion', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  // Validator fails once (architecture), then passes — the stage recovers on its
  // revision and the run completes. --no-review so it runs straight through.
  const env = await seedBuildProject(dir, FAKE_PI_RECOVER);

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /revision 1\/1/);          // the self-heal happened
  assert.match(r.output, /✓ Build complete/);       // …and the run still finished
  assert.match(r.output, /qa-failures\.md/);        // the report points at the durable log

  // A recovered failure never writes last-failure.md, but the full verdict IS in
  // the cumulative log — tagged a revision (not TERMINAL, since it recovered) —
  // and that log is NOT removed when the build completes.
  assert.ok(!(await exists(join(dir, LAST_FAILURE))), 'a recovered failure writes no last-failure.md');
  assert.ok(await exists(join(dir, QA_LOG)), 'the durable QA log survives a completed build');
  const qalog = await readFile(join(dir, QA_LOG), 'utf-8');
  assert.match(qalog, /architecture · rev 1/);
  assert.match(qalog, /Deployables table is missing/);
  assert.doesNotMatch(qalog, /· TERMINAL/);   // it recovered — no terminal entry
});

test('--qa-retries widens every QA gate to n revisions before pausing', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', '--qa-retries', '2', 'an idea'], dir, { ...env, FAKE_PI_VERDICT: 'FAIL' });
  assert.equal(r.code, 1, r.output);

  assert.match(r.output, /qa-retries: 2/);
  assert.match(r.output, /revision 1\/2/);
  assert.match(r.output, /revision 2\/2/);
  assert.match(r.output, /Architecture — QA gate did not pass after 2 revisions/);

  // The count is pinned into the run manifest, so an unattended resume keeps it.
  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(manifest.qaRetries, 2);
});

test('--qa-retries at resume time overrides the pinned count for that invocation', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const failed = await runCli(['build', 'an idea'], dir, { ...env, FAKE_PI_VERDICT: 'FAIL' });
  assert.equal(failed.code, 1, failed.output);
  assert.match(failed.output, /after one revision/);

  const retried = await runCli(['build', '--resume', '--qa-retries', '3'], dir, { ...env, FAKE_PI_VERDICT: 'FAIL' });
  assert.equal(retried.code, 1, retried.output);
  assert.match(retried.output, /revision 3\/3/);
  assert.match(retried.output, /after 3 revisions/);
});

test('an invalid --qa-retries is rejected before any run state is written', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', '--qa-retries', 'lots', 'an idea'], dir, env);
  assert.equal(r.code, 1);
  assert.match(r.output, /--qa-retries must be a whole number >= 0/);
  assert.ok(!(await exists(join(dir, RUN_JSON))));
});

// The revision prompt is the regression surface for "revisions regenerate
// instead of repairing": it must NOT carry the original authoring prompt, must
// name the deliverable and demand surgical edits, and must accumulate every
// verdict so attempt N sees what N-1 was told (with repeats called out).
test('revisePrompt repairs surgically and accumulates verdicts across attempts', () => {
  const stage = { title: 'Style guide', outputs: ['gspec/style.md', 'gspec/style.html'] };

  const first = revisePrompt(stage, 'gspec/style.html', ['VERDICT: FAIL\n- contrast claim unverified for dark']);
  assert.match(first, /gspec\/style\.html/);
  assert.match(first, /ONLY the edits the findings below name/);
  assert.match(first, /byte-for-byte/);
  assert.match(first, /gspec-memory/); // capture-on-failure is a stated step of the run
  assert.doesNotMatch(first, /comprehensive|Produce your deliverable/); // no authoring prompt re-sent
  assert.doesNotMatch(first, /reappears/); // one verdict — no history framing yet

  const second = revisePrompt(stage, 'gspec/style.html', ['first verdict text', 'second verdict text']);
  assert.match(second, /first verdict text/);
  assert.match(second, /second verdict text/);
  assert.match(second, /Verdict 1 of 2.*earlier attempt/);
  assert.match(second, /Verdict 2 of 2.*current — fix this one/);
  assert.match(second, /reappears in a later verdict means the earlier fix did not land/);
});

test('after a QA pause, --resume continues from the failed stage and clears the failure report', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  // --no-review keeps this scenario about the FAILURE pause; the review gate
  // has its own suite (build-review-gate.test.mjs).
  const failed = await runCli(['build', '--no-review', 'an idea'], dir, { ...env, FAKE_PI_VERDICT: 'FAIL' });
  assert.equal(failed.code, 1, failed.output);

  const resumed = await runCli(['build', '--resume'], dir, { ...env, FAKE_PI_VERDICT: 'PASS' });
  assert.equal(resumed.code, 0, resumed.output);
  assert.match(resumed.output, /✓ Build complete/);

  // The retried stage passed, so its stale failure fields and the on-disk
  // report are gone.
  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(manifest.stages.architecture.status, 'done');
  assert.equal(manifest.stages.architecture.detail, undefined);
  assert.ok(!(await exists(join(dir, LAST_FAILURE))), 'a completed build must remove last-failure.md');

  // …but the cumulative QA log is NOT cleared: the verdict from the failed run
  // is still reviewable after the resume completes.
  assert.ok(await exists(join(dir, QA_LOG)), 'the durable QA log outlives a completed build');
  assert.match(await readFile(join(dir, QA_LOG), 'utf-8'), /Deployables table is missing/);
});
