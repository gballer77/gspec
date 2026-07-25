// QA-loop behavior tests for `gspec build` (v2.5.0). Covers the fixes from the
// "QA gate behavior" field report: severity-based gating so the loop has a
// reachable exit (§1), resume re-validating a failed stage instead of skipping
// it (§4), content-hash memoization of passing PRDs (§5), crash-vs-gate
// distinction (§7), and the per-stage cost signal (§8). A fake `pi` first on
// PATH plays every stage agent, so runs are deterministic and offline.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, exists, seedInstall } from './helpers.mjs';
import { gradeVerdict } from '../lib/build.js';

const RUN_JSON = join('.gspec', 'build', 'run.json');
const QA_LOG = join('.gspec', 'build', 'qa-failures.md');

const AGENTS = [
  'profile-writer', 'profile-validator', 'stack-writer', 'stack-validator',
  'practices-writer', 'practices-validator', 'style-writer', 'style-validator',
  'feature-planner', 'feature-writer', 'feature-validator',
  'architecture-writer', 'architecture-validator',
  'plan-decomposer', 'plan-validator',
  'build-orchestrator', 'implementer', 'implementation-validator',
  'codebase-inspector',
];

// Seed a pi project that runs headlessly to completion: brief present (no
// intake), foundations pre-seeded (skip-if-present), fake `pi` first on PATH.
// `extraFiles` lets a test pre-place feature PRDs etc.
async function seedProject(dir, fakePi, extraFiles = {}) {
  await seedInstall(dir, 'pi', { agentFiles: AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  for (const [rel, body] of Object.entries(extraFiles)) {
    await mkdir(join(dir, join(rel, '..')), { recursive: true });
    await writeFile(join(dir, rel), body);
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), fakePi);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}`, FAKE_PI_COUNTER: join(dir, 'qa-counter') };
}

// ---------------------------------------------------------------------------
// §1 — gradeVerdict: the driver enforces "FAIL only on blocker/major".
// ---------------------------------------------------------------------------

test('gradeVerdict downgrades a minor/nit-only FAIL to PASS, but never a blocking one', () => {
  assert.deepEqual(gradeVerdict('VERDICT: PASS\nall good'), { verdict: 'PASS', downgraded: false });

  // FAIL whose findings are all minor/nit → effective PASS carrying notes.
  const soft = gradeVerdict('VERDICT: FAIL\n- [minor] naming\n- [nit] whitespace');
  assert.deepEqual(soft, { verdict: 'PASS', downgraded: true });

  // A blocker/major keeps the FAIL, even alongside minors.
  assert.deepEqual(gradeVerdict('VERDICT: FAIL\n- [major] contradiction\n- [nit] typo'), { verdict: 'FAIL', downgraded: false });
  assert.deepEqual(gradeVerdict('VERDICT: FAIL\n- [blocker] unsafe'), { verdict: 'FAIL', downgraded: false });

  // A FAIL with no gradeable [severity] tags is left untouched — the driver
  // never invents a pass it cannot positively justify.
  assert.deepEqual(gradeVerdict('VERDICT: FAIL\n- the table is missing'), { verdict: 'FAIL', downgraded: false });
});

// A validator that only ever returns minor/nit findings. Pre-2.5.0 this drained
// the whole retry budget and paused the run; now the gate passes with notes.
const FAKE_PI_MINOR = `#!/bin/sh
case "$*" in
  *Validate*) printf 'VERDICT: FAIL\\n- [minor] naming could be tighter\\n- [nit] trailing whitespace\\n' ;;
  *) printf 'ok\\n' ;;
esac
`;

test('a minor/nit-only FAIL passes the gate with advisory notes — no wasted revision, run completes', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir, FAKE_PI_MINOR);

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /✓ Build complete/);
  // The stage passed on severity, not after burning the budget.
  assert.match(r.output, /passing per the severity contract/);
  assert.doesNotMatch(r.output, /revision 1\//);
  assert.match(r.output, /Architecture — PASS \(advisory notes\)/);

  // The advisory notes are kept in the durable log, tagged ADVISORY (not a
  // failure, not a self-heal event).
  const qalog = await readFile(join(dir, QA_LOG), 'utf-8');
  assert.match(qalog, /· ADVISORY/);
  assert.match(qalog, /trailing whitespace/);

  // §8 — a per-stage elapsed marker is shown, and the manifest carries a total.
  assert.match(r.output, /\(\d+[smh]/);
  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(typeof manifest.totalElapsedMs, 'number');
  assert.ok(manifest.totalElapsedMs >= 0);
});

// ---------------------------------------------------------------------------
// §4 — resume re-validates a failed stage instead of skipping it.
// ---------------------------------------------------------------------------

const FAKE_PI_PASS = `#!/bin/sh
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nlooks complete\\n' ;;
  *) printf 'ok\\n' ;;
esac
`;

// A resumable manifest: profile done, stack FAILED (its file exists on disk),
// everything after it pending. This is the exact state the field report hit —
// stack.md present, recorded failed.
function resumableManifest() {
  const pending = { status: 'pending', attempts: 0, verdict: null };
  return {
    idea: 'an idea', engine: 'pi', noQa: false, noReview: false, research: false,
    qaRetries: 1, permissionMode: 'acceptEdits',
    createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
    stages: {
      profile: { status: 'done', attempts: 1, verdict: 'skipped' },
      research: { status: 'skipped', attempts: 0, verdict: null },
      stack: { status: 'failed', attempts: 2, verdict: 'FAIL', detail: 'VERDICT: FAIL\n- the stack is wrong' },
      practices: { ...pending }, style: { ...pending }, features: { ...pending },
      architecture: { ...pending }, plan: { ...pending }, review: { ...pending },
      implement: { ...pending }, reconcile: { ...pending },
    },
    learnings: [], learningsBaseline: {},
  };
}

test('resume re-validates a FAILED single-file stage (respecting hand-edits) instead of skipping it', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  // The validator now PASSes — as if the user hand-fixed gspec/stack.md before resuming.
  const env = await seedProject(dir, FAKE_PI_PASS);
  await writeFile(join(dir, RUN_JSON), JSON.stringify(resumableManifest(), null, 2) + '\n');

  const r = await runCli(['build', '--resume', '--no-review'], dir, env);
  assert.equal(r.code, 0, r.output);

  // The stack stage RE-RAN its gate — it was not skipped because the file exists.
  assert.match(r.output, /▸ Technology stack/);
  assert.match(r.output, /re-validating the current draft/);
  assert.doesNotMatch(r.output, /↷ Technology stack — skipped/);
  assert.match(r.output, /✓ Build complete/);

  const manifest = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.equal(manifest.stages.stack.status, 'done');
});

// ---------------------------------------------------------------------------
// §7 — a writer that crashes after producing a valid artifact is accepted.
// ---------------------------------------------------------------------------

// The monolithic feature-writer exits 1 (a post-write crash), but the PRD it was
// meant to produce already exists and is well-formed.
const FAKE_PI_WRITER_CRASH = `#!/bin/sh
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nlooks complete\\n' ;;
  *Write\\ the\\ feature\\ PRD\\ for\\ this\\ idea*) exit 1 ;;  # monolithic feature-writer crashes post-write
  *) printf 'ok\\n' ;;
esac
`;

test('a writer that exits non-zero but left a valid artifact is accepted, not treated as a gate failure', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  // Pre-place the PRD the crashing writer "already produced".
  const prd = '---\nfeature: game\n---\n\n# Game\n\nA complete, well-formed PRD.\n';
  const env = await seedProject(dir, FAKE_PI_WRITER_CRASH, { 'gspec/features/game.md': prd });

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /retrying once/);
  assert.match(r.output, /accepting and letting QA judge it/);
  assert.match(r.output, /✓ Feature PRDs — PASS/);
  assert.match(r.output, /✓ Build complete/);
  // The crash did NOT halt the stage: no failure banner, no pause.
  assert.doesNotMatch(r.output, /✗ Feature PRDs/);
  assert.doesNotMatch(r.output, /Action required/);
});

// ---------------------------------------------------------------------------
// §5 — a PRD unchanged since it passed is not re-validated on resume.
// ---------------------------------------------------------------------------

// feat-a always passes; feat-b fails through run 1's budget, then passes on the
// resume. The features stage therefore fails on run 1 (memoizing feat-a) and
// re-runs on the resume — where feat-a must be skipped as unchanged.
// Match the FEATURE validator specifically (Validate + features/<slug>.md), so
// neither the writer's revision prompt (which also names the file) nor the plan
// validator (tasks/<slug>.md) touches feat-b's counter.
const FAKE_PI_MEMO = `#!/bin/sh
case "$*" in
  *Validate*features/feat-a.md*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *Validate*features/feat-b.md*)
    n=$(cat "$FAKE_PI_COUNTER" 2>/dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "$FAKE_PI_COUNTER"
    if [ "$n" -le 2 ]; then printf 'VERDICT: FAIL\\n- [major] feat-b is incomplete\\n'
    else printf 'VERDICT: PASS\\nnow fine\\n'; fi
    ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) printf 'ok\\n' ;;
esac
`;

test('a PRD unchanged since it passed is skipped on resume, not re-gated', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const files = {
    'gspec/features/feat-a.md': '---\nfeature: feat-a\n---\n\n# Feat A\n\nDone.\n',
    'gspec/features/feat-b.md': '---\nfeature: feat-b\n---\n\n# Feat B\n\nDone.\n',
  };
  const env = await seedProject(dir, FAKE_PI_MEMO, files);

  // Run 1: feat-a passes (memoized), feat-b drains its budget → features fails.
  const first = await runCli(['build', '--no-review', 'an idea'], dir, env);
  assert.equal(first.code, 1, first.output);
  assert.match(first.output, /QA gate failed for gspec\/features\/feat-b\.md/);
  const m1 = JSON.parse(await readFile(join(dir, RUN_JSON), 'utf-8'));
  assert.ok(m1.stages.features.passed?.['feat-a.md'], 'feat-a should be memoized after passing');

  // Resume: feat-a is unchanged → skipped without a validator call; feat-b now passes.
  const resumed = await runCli(['build', '--resume', '--no-review'], dir, env);
  assert.equal(resumed.code, 0, resumed.output);
  assert.match(resumed.output, /feat-a\.md — unchanged since it passed; skipping re-validation/);
  assert.match(resumed.output, /✓ Build complete/);
});
