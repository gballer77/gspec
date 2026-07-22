// Unit tests for the spec-integrity floor. Run: node --test plugin/hooks/floors/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliesToSpecIntegrity, specIntegrityViolations } from './spec-integrity.mjs';

test('applies only to gspec specs, not design/ or README', () => {
  assert.equal(appliesToSpecIntegrity('gspec/stack.md'), true);
  assert.equal(appliesToSpecIntegrity('gspec/style.html'), true);
  assert.equal(appliesToSpecIntegrity('gspec/design/mockup.html'), false);
  assert.equal(appliesToSpecIntegrity('gspec/README.md'), false);
  assert.equal(appliesToSpecIntegrity('src/index.js'), false);
});

test('clean markdown spec passes', () => {
  assert.deepEqual(specIntegrityViolations('gspec/stack.md', '---\nspec-version: v1\n---\n\n# Stack\n'), []);
});

test('missing frontmatter is flagged', () => {
  const v = specIntegrityViolations('gspec/stack.md', '# Stack\nno frontmatter\n');
  assert.equal(v.length, 1);
  assert.match(v[0], /missing its YAML frontmatter/);
});

test('wrong spec-version is flagged with migrate hint', () => {
  const v = specIntegrityViolations('gspec/stack.md', '---\nspec-version: v0\n---\n');
  assert.match(v[0], /has spec-version v0, expected v1\. Run \/gspec-migrate/);
});

test('html style guide needs first-line comment', () => {
  assert.deepEqual(specIntegrityViolations('gspec/style.html', '<!-- spec-version: v1 -->\n<html>'), []);
  const v = specIntegrityViolations('gspec/style.html', '<html>no comment</html>');
  assert.match(v[0], /missing its first-line/);
});
