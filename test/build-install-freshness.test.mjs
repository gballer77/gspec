// Installed agents are COPIES, and upgrading gspec does not rewrite them.
//
// A measured dogfood run spent ten hours against agent definitions that were a
// full day stale — all 29 of them. A QA bar fixed that morning failed the same
// stage SEVEN times, twice terminally, because the fix never reached the
// project. Nothing anywhere said so: there was no version stamp to compare, so
// the build could not have known even in principle.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const build = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const cli = await readFile(join(REPO_ROOT, 'bin', 'gspec.js'), 'utf-8');

test('install stamps the version that wrote the agent files', () => {
  assert.match(cli, /writeProjectConfig\(process\.cwd\(\), \{ target: targetName, gspecVersion: pkg\.version \}\)/);
});

test('the build compares the stamp against its own version', () => {
  assert.match(build, /const GSPEC_VERSION = createRequire/);
  assert.match(build, /installedVersion !== GSPEC_VERSION/);
  assert.match(build, /are NOT active here/, 'it must say what the mismatch means');
});

test('a stale install warns but never blocks', () => {
  // The mismatch is usually harmless, and a project may deliberately pin its
  // agents. Blocking would make an upgrade a hard stop for every user.
  const check = build.match(/const installedVersion[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(check, /process\.exit|status: 'failed'/);
  assert.match(check, /chalk\.yellow/);
});

test('a project with no stamp says the check could not run', () => {
  // Silence would read as "agents are fresh", which is the failure this exists
  // to end. Pre-stamp projects must be told the check is unavailable.
  const check = build.match(/const installedVersion[\s\S]*?\n  \}/)[0];
  assert.match(check, /else if \(!installedVersion\)/);
  assert.match(check, /cannot be checked/);
});
