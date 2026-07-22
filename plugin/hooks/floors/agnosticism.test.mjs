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
  assert.equal(isGuardedSpec('gspec/profile.md'), false);
  assert.equal(isGuardedSpec('gspec/design/mockup.html'), false);
});

test('derives identity candidates from the profile', () => {
  const c = identityCandidates(PROFILE);
  assert.ok(c.includes('Acme Rocket'));
});

test('flags leaked product identity, whole-word only', () => {
  const c = identityCandidates(PROFILE);
  assert.deepEqual(agnosticismHits('The Acme Rocket dashboard shows metrics.', c), ['Acme Rocket']);
  assert.deepEqual(agnosticismHits('The application dashboard shows metrics.', c), []);
});

test('no candidates means no hits', () => {
  assert.deepEqual(agnosticismHits('anything at all', []), []);
});
