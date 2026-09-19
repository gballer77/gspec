// A Mac that sleeps between engine turns stalls the build. 51 suspend events
// across one run's transcripts, with idle sleep set to one minute — and
// nothing in the run said so.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { parseSleepMinutes, sleepTooShort } from '../lib/preflight.js';

const PMSET = `System-wide power settings:
Currently in use:
 standby              1
 sleep                1 (sleep prevented by caffeinate)
 displaysleep         2
 hibernatemode        3
`;

test('idle sleep minutes are read from pmset -g', () => {
  assert.equal(parseSleepMinutes(PMSET), 1);
  assert.equal(parseSleepMinutes(PMSET.replace(' sleep                1', ' sleep                0')), 0);
  assert.equal(parseSleepMinutes(''), null);
  assert.equal(parseSleepMinutes(null), null);
});

test('only a short, enabled idle sleep warrants a warning', () => {
  assert.equal(sleepTooShort(1), true);
  assert.equal(sleepTooShort(9), true);
  assert.equal(sleepTooShort(10), false);
  assert.equal(sleepTooShort(0), false, 'never sleeps');
  assert.equal(sleepTooShort(null), false);
});

test('the driver warns at run start, on macOS only, and never blocks', async () => {
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  assert.match(src, /process\.platform === 'darwin'[\s\S]{0,200}captureCommand\('pmset', \['-g'\]/);
  assert.match(src, /caffeinate -i gspec build/);
  const block = src.match(/if \(!dryRun && process\.platform === 'darwin'\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(block, /process\.exit/);
});
