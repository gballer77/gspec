// Unit tests for the full-tree floor scan (the Codex Stop gate / git / build core).
// Run: node --test plugin/hooks/floors/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanGspecTree } from './scan.mjs';

const PROFILE = '# Acme Rocket\n\nProduct name: Acme Rocket\n';

test('clean tree yields no violations', () => {
  const specs = [
    { rel: 'gspec/stack.md', content: '---\nspec-version: v1\n---\n\n# Stack\nGeneric prose.\n' },
    { rel: 'gspec/tasks/login.md', content: '---\nfeature: login\nspec-version: v1\n---\n\n## Plan\n- [x] **T1** Do it\n' },
  ];
  const baselines = { 'gspec/tasks/login.md': specs[1].content };
  assert.deepEqual(scanGspecTree({ specs, profile: PROFILE, taskBaselines: baselines }), []);
});

test('catches all three floors at once', () => {
  const specs = [
    { rel: 'gspec/stack.md', content: '# Stack\nBuilt for Acme Rocket.\n' }, // no frontmatter + identity leak
    { rel: 'gspec/tasks/login.md', content: '---\nspec-version: v1\n---\n\n## Plan\n- [x] **T1** Changed\n' },
  ];
  const baselines = { 'gspec/tasks/login.md': '---\nspec-version: v1\n---\n\n## Plan\n- [x] **T1** Original\n' };
  const found = scanGspecTree({ specs, profile: PROFILE, taskBaselines: baselines });
  const floors = found.map((f) => f.floor).sort();
  assert.deepEqual(floors, ['agnosticism', 'spec-integrity', 'task-immutability']);
});

test('task-immutability skipped when no baseline for the file', () => {
  const specs = [{ rel: 'gspec/tasks/login.md', content: '---\nspec-version: v1\n---\n\n## Plan\n- [x] **T1** Changed\n' }];
  const found = scanGspecTree({ specs, profile: null, taskBaselines: {} });
  assert.equal(found.some((f) => f.floor === 'task-immutability'), false);
});

test('no profile means agnosticism does not run', () => {
  const specs = [{ rel: 'gspec/stack.md', content: '---\nspec-version: v1\n---\n\nBuilt for Acme Rocket.\n' }];
  const found = scanGspecTree({ specs, profile: null, taskBaselines: {} });
  assert.equal(found.some((f) => f.floor === 'agnosticism'), false);
});
