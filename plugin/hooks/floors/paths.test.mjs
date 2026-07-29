// Unit tests for the shared path vocabulary. These are the checks that keep the
// floors agreeing with each other — the class of bug that let module-tier specs
// escape the agnosticism guard for a whole release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  norm, isRootSpec, isProfile, isModuleArch, moduleName, isFeaturePrd,
  isLegacyPlan, isEnrichedDoc, isFeatureDesign, isFeatureTasks, isPlanDoc, featureSlug,
  isGspecSpec,
} from './paths.mjs';

test('paths are normalized before matching', () => {
  assert.equal(norm('gspec\\stack.md'), 'gspec/stack.md');
  assert.equal(norm('./gspec/stack.md'), 'gspec/stack.md');
  assert.equal(isRootSpec('gspec\\stack.md'), true);
});

test('root specs are an exact filename set directly under gspec/', () => {
  assert.equal(isRootSpec('gspec/stack.md'), true);
  assert.equal(isRootSpec('gspec/style.html'), true);
  assert.equal(isRootSpec('gspec/architecture.md'), true);
  assert.equal(isRootSpec('gspec/notes.md'), false);      // not a gspec deliverable
  assert.equal(isRootSpec('gspec/architecture/web.md'), false); // that's the module tier
  assert.equal(isRootSpec('elsewhere/stack.md'), false);
});

test('the profile is identified on its own — every identity rule exempts it', () => {
  assert.equal(isProfile('gspec/profile.md'), true);
  assert.equal(isProfile('gspec/stack.md'), false);
});

test('the module tier is gspec/architecture/<name>.md, and yields its row name', () => {
  assert.equal(isModuleArch('gspec/architecture/web.md'), true);
  assert.equal(moduleName('gspec/architecture/web.md'), 'web');
  assert.equal(isModuleArch('gspec/architecture.md'), false);        // system tier
  assert.equal(isModuleArch('gspec/architecture/deep/nested.md'), false);
  assert.equal(moduleName('gspec/architecture.md'), null);
});

test('feature PRDs are recognized flat AND in a folder (the migration window)', () => {
  assert.equal(isFeaturePrd('gspec/features/auth.md'), true);
  assert.equal(isFeaturePrd('gspec/features/auth/prd.md'), true);
  assert.equal(isFeaturePrd('gspec/features/auth/arch.md'), false);  // enriched, not the PRD
});

test('legacy flat plans stay recognizable', () => {
  assert.equal(isLegacyPlan('gspec/tasks/auth.md'), true);
  assert.equal(isLegacyPlan('gspec/tasks/nested/auth.md'), false);
});

test('the enriched set is a closed basename set that excludes prd.md', () => {
  assert.equal(isEnrichedDoc('gspec/features/auth/arch.md'), true);
  assert.equal(isEnrichedDoc('gspec/features/auth/design.html'), true);
  assert.equal(isEnrichedDoc('gspec/features/auth/tasks.md'), true);
  // The boundary the agnosticism floor runs on: the PRD is never enriched.
  assert.equal(isEnrichedDoc('gspec/features/auth/prd.md'), false);
  assert.equal(isEnrichedDoc('gspec/features/auth/notes.md'), false);
  assert.equal(isFeatureDesign('gspec/features/auth/design.html'), true);
  assert.equal(isFeatureTasks('gspec/features/auth/tasks.md'), true);
});

test('isPlanDoc covers BOTH plan layouts — the hard block must never stop firing', () => {
  // task-immutability is the only hard PreToolUse block on a spec path and it
  // fails open. A matcher that knew one layout would go silent — no error, no
  // log, checked tasks quietly editable — so both forms are asserted here and
  // every consumer derives from this one predicate.
  assert.equal(isPlanDoc('gspec/features/auth/tasks.md'), true);  // current
  assert.equal(isPlanDoc('gspec/tasks/auth.md'), true);           // legacy, still live
  assert.equal(isPlanDoc('gspec/features/auth/prd.md'), false);
  assert.equal(isPlanDoc('gspec/features/auth/arch.md'), false);
  assert.equal(isPlanDoc('gspec/architecture.md'), false);
});

test('featureSlug reads the slug out of every layout that carries one', () => {
  assert.equal(featureSlug('gspec/features/auth.md'), 'auth');
  assert.equal(featureSlug('gspec/features/auth/arch.md'), 'auth');
  assert.equal(featureSlug('gspec/tasks/auth.md'), 'auth');
  assert.equal(featureSlug('gspec/stack.md'), null);
});

test('isGspecSpec is the union — and excludes mockups, READMEs, and outsiders', () => {
  for (const p of [
    'gspec/profile.md', 'gspec/stack.md', 'gspec/style.html',
    'gspec/architecture.md', 'gspec/architecture/web.md',
    'gspec/features/auth.md', 'gspec/tasks/auth.md',
    'gspec/features/auth/prd.md', 'gspec/features/auth/arch.md',
  ]) assert.equal(isGspecSpec(p), true, `${p} should be a gspec spec`);

  for (const p of [
    'gspec/design/mockup.html',   // external mockups: gspec neither writes nor governs them
    'gspec/README.md',            // documentation ABOUT the specs
    'src/index.js',
    'docs/architecture.md',       // same basename, outside gspec/
    'vendor/gspec/architecture.md',
  ]) assert.equal(isGspecSpec(p), false, `${p} should not be a gspec spec`);
});
