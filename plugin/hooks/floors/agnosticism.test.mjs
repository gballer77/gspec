// Unit tests for the profile-agnosticism floor. Run: node --test plugin/hooks/floors/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGuardedSpec, identityCandidates, agnosticismHits } from './agnosticism.mjs';

const PROFILE = `# Acme Rocket - Product Profile

Product name: Acme Rocket

Acme Rocket helps teams ship faster.
`;

test('guards non-profile specs, never the profile itself', () => {
  assert.equal(isGuardedSpec('gspec/stack.md'), true);
  assert.equal(isGuardedSpec('gspec/features/login.md'), true);
  assert.equal(isGuardedSpec('gspec/tasks/login.md'), true);
  assert.equal(isGuardedSpec('gspec/profile.md'), false);
  assert.equal(isGuardedSpec('gspec/design/mockup.html'), false);
  assert.equal(isGuardedSpec('gspec/README.md'), false);
  assert.equal(isGuardedSpec('src/index.js'), false);
});

test('module-tier sub-files are guarded — the basename allowlist used to miss them', () => {
  // Regression: `gspec/architecture/api.md` matched none of the old allowlist's
  // basenames, so per-module architecture shipped a release unguarded.
  assert.equal(isGuardedSpec('gspec/architecture/api.md'), true);
  assert.equal(isGuardedSpec('gspec/architecture/web.md'), true);
  // Same basename outside gspec/ is still nothing to do with us.
  assert.equal(isGuardedSpec('docs/architecture/api.md'), false);
});

test('a feature folder guards the PRD but exempts its enriched siblings', () => {
  // The boundary runs BETWEEN BASENAMES inside one directory: the PRD stays
  // product-agnostic; arch/design/tasks are denormalized on purpose.
  assert.equal(isGuardedSpec('gspec/features/login/prd.md'), true);
  assert.equal(isGuardedSpec('gspec/features/login/arch.md'), false);
  assert.equal(isGuardedSpec('gspec/features/login/design.html'), false);
  assert.equal(isGuardedSpec('gspec/features/login/tasks.md'), false);
});

test('derives identity candidates from the profile', () => {
  const c = identityCandidates(PROFILE);
  assert.ok(c.includes('Acme Rocket'));
});

// Regression: identity extraction only understood a name-FIRST H1. A writer that
// emitted name-last ("# Product Profile — Shelfkeeper") left the single mangled
// candidate "Product  — Shelfkeeper", which matches nothing, so the guard failed
// OPEN and the product name shipped in stack.md and practices.md. Nothing pins
// the order, so the leak was nondeterministic across builds — the worst failure
// mode available to a guard.
test('identity extraction does not depend on H1 word order', () => {
  assert.deepEqual(identityCandidates('# Product Profile — Shelfkeeper'), ['Shelfkeeper']);
  assert.deepEqual(identityCandidates('# Shelfkeeper - Product Profile'), ['Shelfkeeper']);
  assert.deepEqual(identityCandidates('# Shelfkeeper: Product Profile'), ['Shelfkeeper']);
  // A hyphenated name stays whole: separators need surrounding space.
  assert.deepEqual(identityCandidates('# Product Profile — Foo-Bar'), ['Foo-Bar']);
  // The exact leak that shipped: a guarded spec titled after the product.
  assert.deepEqual(
    agnosticismHits('# Technology Stack — Shelfkeeper', identityCandidates('# Product Profile — Shelfkeeper')),
    ['Shelfkeeper'],
  );
});

test('flags leaked product identity, whole-word only', () => {
  const c = identityCandidates(PROFILE);
  assert.deepEqual(agnosticismHits('The Acme Rocket dashboard shows metrics.', c), ['Acme Rocket']);
  assert.deepEqual(agnosticismHits('The application dashboard shows metrics.', c), []);
});

test('no candidates means no hits', () => {
  assert.deepEqual(agnosticismHits('anything at all', []), []);
});
