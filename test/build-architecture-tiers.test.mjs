// The architecture stage's deliverable is a SET, not a file.
//
// `outputs: ['gspec/architecture.md']` answers "did the writer produce its
// artifact?" for every other stage, but the architecture's real deliverable is
// two-tier: the system file PLUS one gspec/architecture/<name>.md per row of its
// own Modules table. The root existing does not imply the module tier does, so
// without a derived check a multi-module run reports `done` having written only
// half its architecture — and every later stage then routes against module
// boundaries that were never written. Nothing errors; the build just quietly
// builds the wrong thing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { architectureDeliverables, splitScopesByFeature } from '../lib/build.js';
import { makeProject, cleanup } from './helpers.mjs';

const withTable = (rows) => `---
spec-version: v2
---

# Architecture

## Modules & Verification

| name | dir | build | test |
| --- | --- | --- | --- |
${rows.map((r) => `| ${r} | ${r === 'app' ? '.' : r} | npm run build | npm test |`).join('\n')}
`;

test('a single-module project owes only the system tier', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'), withTable(['app']), 'utf-8');
    assert.deepEqual(await architectureDeliverables(dir), ['gspec/architecture.md']);
  } finally { await cleanup(dir); }
});

test('a multi-module project owes one file per row, named by the row', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'), withTable(['web', 'api']), 'utf-8');
    assert.deepEqual(await architectureDeliverables(dir), [
      'gspec/architecture.md',
      'gspec/architecture/web.md',
      'gspec/architecture/api.md',
    ]);
  } finally { await cleanup(dir); }
});

test('an unwritten or tableless architecture owes just the root', async () => {
  const dir = await makeProject();
  try {
    // Nothing written yet — the stage still owes its root file.
    assert.deepEqual(await architectureDeliverables(dir), ['gspec/architecture.md']);

    // Written, but the system genuinely has nothing to build.
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'),
      '---\nspec-version: v2\n---\n\n## Modules & Verification\n\n**Not Applicable** — nothing to build.\n', 'utf-8');
    assert.deepEqual(await architectureDeliverables(dir), ['gspec/architecture.md']);
  } finally { await cleanup(dir); }
});

test('the legacy Deployables heading still resolves its tier (pre-migrate projects)', async () => {
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'architecture.md'),
      withTable(['web', 'api']).replace('Modules & Verification', 'Deployables & Verification'), 'utf-8');
    assert.deepEqual(await architectureDeliverables(dir), [
      'gspec/architecture.md',
      'gspec/architecture/web.md',
      'gspec/architecture/api.md',
    ]);
  } finally { await cleanup(dir); }
});

// --- scope shape -----------------------------------------------------------
//
// The context argument for feature folders holds only if a scope covers ONE
// feature. Enriched folders inline the stack and style decisions, so a scope
// spanning three features reads three copies — worse than the shared-spec model
// it replaced. Nothing errors when that happens; the build just costs more, so
// the split is enforced by the driver rather than requested of the orchestrator.

test('a scope spanning several features is split into one scope per feature', async () => {
  const dir = await makeProject();
  try {
    const wave = [{
      label: 'everything',
      instruction: 'Build it all.',
      plan: ['gspec/features/auth/tasks.md', 'gspec/features/billing/tasks.md'],
    }];
    const split = await splitScopesByFeature(dir, wave);
    assert.equal(split.length, 2);
    assert.deepEqual(split.map((s) => s.plan), [
      ['gspec/features/auth/tasks.md'],
      ['gspec/features/billing/tasks.md'],
    ]);
    // Each scope still says which feature it is, for the log and the prompt.
    assert.ok(split.every((s) => /auth|billing/.test(s.instruction)));
  } finally { await cleanup(dir); }
});

test('a single-feature scope passes through untouched', async () => {
  const dir = await makeProject();
  try {
    const wave = [{ label: 'auth', instruction: 'Build auth.', plan: ['gspec/features/auth/tasks.md'] }];
    assert.deepEqual(await splitScopesByFeature(dir, wave), wave);
  } finally { await cleanup(dir); }
});

test('a stale flat plan path is rewritten when the folder form exists', async () => {
  // The orchestrator emits paths from a prose example; that example lags a
  // layout change for a while. countUnchecked reads nothing from a stale path,
  // returns 0, and the continuation loop exits declaring the scope complete —
  // a silent under-build, so the driver repairs the path rather than trusting it.
  const dir = await makeProject();
  try {
    await mkdir(join(dir, 'gspec', 'features', 'auth'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'features', 'auth', 'tasks.md'), '## Plan\n\n- [ ] **T1** x\n', 'utf-8');
    const split = await splitScopesByFeature(dir, [{ label: 'auth', instruction: 'go', plan: ['gspec/tasks/auth.md'] }]);
    assert.deepEqual(split[0].plan, ['gspec/features/auth/tasks.md']);
  } finally { await cleanup(dir); }
});
