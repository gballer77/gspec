// SPEC_VERSION lives in lib/spec-version.js. Two consumers import it, but two
// copies cannot: the spec-integrity floor is copied standalone into
// .claude/hooks/floors/ (no lib/ to import from), and templates/preamble.md
// states the format in prose. Nothing used to assert they agreed — this does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC_VERSION } from '../lib/spec-version.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFile(join(ROOT, rel), 'utf-8');

test('SPEC_VERSION is a plain vN marker', () => {
  assert.match(SPEC_VERSION, /^v\d+$/);
});

test('bin/gspec.js imports the constant rather than redeclaring it', async () => {
  const src = await read('bin/gspec.js');
  assert.doesNotMatch(src, /^const SPEC_VERSION = /m, 'bin/gspec.js still declares its own copy');
  assert.match(src, /import \{[^}]*SPEC_VERSION[^}]*\} from '\.\.\/lib\/spec-version\.js'/);
});

test('scripts/build.js imports the constant rather than redeclaring it', async () => {
  const src = await read('scripts/build.js');
  assert.doesNotMatch(src, /^const SPEC_VERSION = /m, 'scripts/build.js still declares its own copy');
  assert.match(src, /import \{[^}]*SPEC_VERSION[^}]*\} from '\.\.\/lib\/spec-version\.js'/);
});

test('the spec-integrity floor copy matches (it cannot import — floors ship standalone)', async () => {
  const { SPEC_VERSION: floorVersion } = await import('../plugin/hooks/floors/spec-integrity.mjs');
  assert.equal(floorVersion, SPEC_VERSION,
    'plugin/hooks/floors/spec-integrity.mjs drifted from lib/spec-version.js');
});

test('templates/preamble.md states the current version in its prose example', async () => {
  const preamble = await read('templates/preamble.md');
  const marker = preamble.match(/<!--\s*spec-version:\s*(v\d+)\s*-->/);
  assert.ok(marker, 'preamble no longer shows a spec-version comment example');
  assert.equal(marker[1], SPEC_VERSION, 'templates/preamble.md drifted from lib/spec-version.js');
});
