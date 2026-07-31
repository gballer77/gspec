// The reconcile audit produces nothing but a report — so it has to keep it.
//
// The driver set `detail` only when the stage FAILED, meaning the single run
// that preserved the audit's text was the one where the agent crashed. On every
// normal run a 4-minute, ~3M-token stage ended in the word "report" and the
// findings — spec/code drift, capabilities nothing implements — were gone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const audit = src.match(/case 'audit': \{[\s\S]*?\n    \}/)[0];

test('a successful audit writes its findings to a file', () => {
  assert.match(src, /const AUDIT_REPORT_PATH = join\(BUILD_DIR, 'audit-report\.md'\)/);
  assert.match(audit, /writeFile\(join\(ctx\.cwd, AUDIT_REPORT_PATH\)/);
});

test('the report is kept on SUCCESS, not only on failure', () => {
  // The exact inversion that lost it: `detail: out.code === 0 ? undefined : out.text`.
  assert.doesNotMatch(audit, /detail: out\.code === 0 \? undefined/);
  const ok = audit.match(/if \(out\.code !== 0\) \{[\s\S]*?\n      \}/);
  assert.ok(ok, 'failure returns early');
  const write = audit.indexOf('AUDIT_REPORT_PATH');
  assert.ok(write > audit.indexOf('if (out.code !== 0)'), 'the write is on the success path');
});

test('the baseline still only advances on success', () => {
  // Recording a baseline for a run that failed would silence the next audit.
  const baseline = audit.indexOf('recordAuditBaseline');
  const early = audit.indexOf('return { status: \'failed\'');
  assert.ok(baseline > early, 'the baseline must come after the failure return');
});
