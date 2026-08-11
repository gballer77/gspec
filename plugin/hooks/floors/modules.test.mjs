// Unit tests for the Modules & Verification table parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModulesTable, moduleSpecPaths, moduleSpecDrift, droppedModules } from './modules.mjs';

const TWO_MODULES = `---
spec-version: v2
---

# Architecture

## Overview

Prose that mentions a table but is not one.

## Modules & Verification

| name | dir | build | test |
| --- | --- | --- | --- |
| [web](architecture/web.md) | apps/web | npm run build | npm test |
| **api** | services/api | ./gradlew build | ./gradlew test |

## Technical Gap Analysis

| gap | resolution |
| --- | --- |
| caching | none for now |
`;

test('parses rows, stripping links and emphasis from the name', () => {
  const rows = parseModulesTable(TWO_MODULES);
  assert.deepEqual(rows, [
    { name: 'web', dir: 'apps/web', build: 'npm run build', test: 'npm test' },
    { name: 'api', dir: 'services/api', build: './gradlew build', test: './gradlew test' },
  ]);
});

test('a following section ends the table — later tables are not absorbed', () => {
  // The Gap Analysis table above must not leak in as a module row.
  assert.equal(parseModulesTable(TWO_MODULES).length, 2);
});

test('the legacy Deployables heading still parses (pre-migrate projects)', () => {
  const legacy = TWO_MODULES.replace('Modules & Verification', 'Deployables & Verification');
  assert.equal(parseModulesTable(legacy).length, 2);
});

test('absent or Not Applicable section yields no rows', () => {
  assert.deepEqual(parseModulesTable('# Architecture\n\n## Overview\n\nNothing.\n'), []);
  assert.deepEqual(
    parseModulesTable('## Modules & Verification\n\n**Not Applicable** — nothing to build.\n'), []);
});

test('one file per row, single-module included — the tier holds the spine', () => {
  // The old layout gate returned [] below two rows. It cannot now: the module
  // tier mints the shared anchors, and a one-module project has a spine too.
  const one = [{ name: 'app', dir: '.', build: 'b', test: 't' }];
  assert.deepEqual(moduleSpecPaths(one), ['gspec/architecture/app.md']);
  assert.deepEqual(moduleSpecPaths([]), []);
  assert.deepEqual(moduleSpecPaths(parseModulesTable(TWO_MODULES)), [
    'gspec/architecture/web.md',
    'gspec/architecture/api.md',
  ]);
});

test('a dropped row is caught by name — a rename is a drop plus an addition', () => {
  const before = parseModulesTable(TWO_MODULES);
  assert.deepEqual(droppedModules(before, before), []);

  // Renamed: 'api' is gone from the table, so gspec/architecture/api.md is no
  // longer derivable and every feature pointing at it is now dangling.
  const renamed = [before[0], { ...before[1], name: 'backend' }];
  assert.deepEqual(droppedModules(before, renamed), ['api']);

  // Deleted outright.
  assert.deepEqual(droppedModules(before, [before[0]]), ['api']);

  // Same names, different build command — the file does not move, so nothing dropped.
  const retooled = [before[0], { ...before[1], build: 'make' }];
  assert.deepEqual(droppedModules(before, retooled), []);

  // No prior table (a greenfield write) can drop nothing.
  assert.deepEqual(droppedModules([], before), []);
});

test('drift reports both directions — a half-done rename leaves one of each', () => {
  const rows = parseModulesTable(TWO_MODULES);
  assert.deepEqual(
    moduleSpecDrift(rows, ['gspec/architecture/web.md', 'gspec/architecture/api.md']),
    { missing: [], orphans: [] });

  // 'api' was renamed in the table but the file still has the old name.
  assert.deepEqual(
    moduleSpecDrift(rows, ['gspec/architecture/web.md', 'gspec/architecture/backend.md']),
    { missing: ['gspec/architecture/api.md'], orphans: ['gspec/architecture/backend.md'] });

  // A single-module project owes its own sub-file, and a leftover from a rename
  // is still an orphan.
  assert.deepEqual(
    moduleSpecDrift([{ name: 'app', dir: '.', build: 'b', test: 't' }], ['gspec/architecture/old.md']),
    { missing: ['gspec/architecture/app.md'], orphans: ['gspec/architecture/old.md'] });
});
