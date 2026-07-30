// Unit tests for the implementation lint — the checks that catch what a green
// verify.sh cannot, because the implementer wrote both the code and the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filesNamedByCheckedTasks, missingWorkViolations, stubViolations, checkboxConsistency,
} from './implementation-lint.mjs';

const TASKS = `---
feature: auth
---

## Plan

- [x] **T1** scaffold the route at \`src/pages/login.astro\`
  - covers: "User can sign in with email and password"
- [ ] **T2** wire the session cookie in \`src/lib/session.ts\`
  - covers: "User can sign in with email and password"
- [x] **T3** add the logout handler in \`src/pages/logout.ts\`
  - covers: "User can sign out"
`;

test('only CHECKED tasks contribute the files we expect to exist', () => {
  assert.deepEqual(filesNamedByCheckedTasks(TASKS), [
    { id: 'T1', path: 'src/pages/login.astro' },
    { id: 'T3', path: 'src/pages/logout.ts' },
  ]);
});

test('a checked task whose file was never written is caught', () => {
  const present = new Set(['src/pages/login.astro']);
  const v = missingWorkViolations('a/tasks.md', TASKS, present);
  assert.equal(v.length, 1);
  assert.match(v[0], /T3 is checked but src\/pages\/logout\.ts does not exist/);

  assert.deepEqual(
    missingWorkViolations('a/tasks.md', TASKS, new Set(['src/pages/login.astro', 'src/pages/logout.ts'])), []);
});

test('stub markers in finished work are flagged', () => {
  assert.deepEqual(stubViolations('src/a.ts', 'export const f = () => 1;\n'), []);
  assert.match(stubViolations('src/a.ts', '// TODO: wire this up\n', 'T1')[0], /unfinished-work marker \(claimed complete by T1\)/);
  assert.match(stubViolations('src/a.ts', 'def f(): raise NotImplementedError\n')[0], /unfinished-work marker/);
  assert.match(stubViolations('src/a.ts', 'throw new Error("stub")\n')[0], /unfinished-work marker/);
  // A UI string that merely contains the word is not an annotation.
  assert.deepEqual(stubViolations('src/a.ts', 'const label = "Your todo list";\n'), []);
});

test('a capability cannot be checked while a covering task is open', () => {
  const prd = `# Auth

- [x] **P0**: User can sign in with email and password
- [x] **P1**: User can sign out
`;
  const v = checkboxConsistency('a/prd.md', prd, TASKS);
  assert.equal(v.length, 1, v.join('\n'));
  assert.match(v[0], /"User can sign in with email and password" is checked but T2 still is not/);
});

test('an unchecked capability, or one with no plan coverage, is not this check\'s business', () => {
  const prd = '- [ ] **P0**: User can sign in with email and password\n- [x] **P2**: Something nothing covers\n';
  assert.deepEqual(checkboxConsistency('a/prd.md', prd, TASKS), []);
});

test('every covering task checked means the capability may be checked', () => {
  const done = TASKS.replace('- [ ] **T2**', '- [x] **T2**');
  const prd = '- [x] **P0**: User can sign in with email and password\n';
  assert.deepEqual(checkboxConsistency('a/prd.md', prd, done), []);
});

test('the metadata bullet is optional — a bullet-only pattern verified nothing', () => {
  // Found by dogfooding: a real plan indented `covers:` without a bullet, so a
  // bullet-only pattern matched NONE of 88 tasks and passed every capability
  // vacuously. A check that matches nothing reports clean, which is the worst
  // outcome available.
  const plain = `## Plan

- [x] **T1** build it in \`src/a.ts\`
  covers: "User can do the thing"
- [ ] **T2** finish it
  covers: "User can do the thing"
`;
  assert.deepEqual(filesNamedByCheckedTasks(plain), [{ id: 'T1', path: 'src/a.ts' }]);

  const prd = '- [x] **P0**: User can do the thing\n';
  const v = checkboxConsistency('a/prd.md', prd, plain);
  assert.equal(v.length, 1, 'the open covering task must still be caught');
  assert.match(v[0], /T2 still is not/);
});

test('a backticked API reference is not a file path', () => {
  // The first real run of this gate produced six findings, three of which were
  // JavaScript methods: a `word.word` pattern matches `AbortSignal.timeout`,
  // `jwt.encode`, `res.json`. This gate BLOCKS, so it sent the implementer off
  // to create files for methods. Only a real source extension counts.
  const tasks = '- [x] **T1** wire `jwt.encode` and `AbortSignal.timeout` in `packages/core/src/jwt.ts`\n';
  assert.deepEqual(filesNamedByCheckedTasks(tasks), [{ id: 'T1', path: 'packages/core/src/jwt.ts' }]);
});

test('the extension list covers the frameworks we actually target', () => {
  // An early cut of that list omitted .astro and called an existing route
  // missing — the failure mode of narrowing is worse than the one it fixes.
  for (const ext of ['astro', 'vue', 'svelte', 'py', 'go', 'prisma', 'sql', 'yml']) {
    const tasks = `- [x] **T1** add \`src/thing.${ext}\`\n`;
    assert.deepEqual(filesNamedByCheckedTasks(tasks), [{ id: 'T1', path: `src/thing.${ext}` }], ext);
  }
});

test('a path named relative to its module resolves against the real one', () => {
  // Tasks name paths the way people do — `(library)/layout.tsx` for what lives
  // at `apps/web/src/app/(library)/layout.tsx`. Exact-match called two such
  // files missing on a real build and would have sent the implementer to
  // re-create them. The match is on a SEGMENT boundary, so a suffix that only
  // happens to share trailing characters does not count.
  const tasks = '- [x] **T1** add `(library)/layout.tsx`\n';
  assert.deepEqual(missingWorkViolations('a/t.md', tasks, new Set(['apps/web/src/app/(library)/layout.tsx'])), []);

  const near = missingWorkViolations('a/t.md', tasks, new Set(['apps/web/src/app/my(library)/layout.tsx']));
  assert.equal(near.length, 1, 'a mid-segment match is not a resolution');

  assert.match(missingWorkViolations('a/t.md', tasks, new Set())[0], /does not exist/);
});
