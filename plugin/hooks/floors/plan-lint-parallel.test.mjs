// Two properties a language model was being paid to check by hand.
//
// Across one dogfood run the plan validator raised unsafe `[P]` markers FIVE
// times over four revision rounds, and a non-verbatim `covers:` quote again —
// each round costing a validator run plus a writer run. Both are arithmetic.
// The findings below are the ones it actually reported, verbatim in shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelismViolations, coversViolations, coversQuotes, parseTasks } from './plan-lint.mjs';

test('two [P] siblings cannot depend on each other', () => {
  // The real hazard: [P] says these run alongside one another, and T6 needs T5.
  const tasks = [
    '- [ ] **T5** [P] **P0** a',
    '  deps: none',
    '- [ ] **T6** [P] **P0** b',
    '  deps: T5',
  ].join('\n');
  const v = parallelismViolations('a/tasks.md', tasks);
  assert.equal(v.length, 1, v.join('\n'));
  assert.match(v[0], /T6 is marked \[P\] but depends on T5/);
  assert.match(v[0], /also \[P\]/);
});

test('a [P] task may depend on a sequential one — that is a barrier, not a conflict', () => {
  // The canonical shape: one foundation task, then a fan-out that runs after
  // it. The old rule flagged exactly this, which made [P] unusable on a fresh
  // plan — nothing is checked yet, so every fan-out looked dishonest.
  const tasks = [
    '- [ ] **T7** **P0** build the thing',
    '  deps: none',
    '- [ ] **T8** [P] **P0** build the other thing',
    '  deps: T7',
  ].join('\n');
  assert.deepEqual(parallelismViolations('a/tasks.md', tasks), []);
});

test('a fan-out after one foundation task is clean, however wide', () => {
  // Measured shape from a real plan: T1 sequential, T2..T6 all [P] on T1. The
  // old rule produced five findings here, every one of them wrong.
  const tasks = ['- [ ] **T1** **P0** foundation', '  deps: none'];
  for (const n of [2, 3, 4, 5, 6]) tasks.push(`- [ ] **T${n}** [P] **P0** fan out`, '  deps: T1');
  assert.deepEqual(parallelismViolations('a/tasks.md', tasks.join('\n')), []);
});

test('a dependency already CHECKED is never a conflict', () => {
  // Done is done — the work exists, so nothing can be waiting on it.
  const tasks = [
    '- [x] **T1** [P] **P0** already built',
    '  deps: none',
    '- [ ] **T2** [P] **P0** next',
    '  deps: T1',
  ].join('\n');
  assert.deepEqual(parallelismViolations('a/tasks.md', tasks), []);
});

test('a checked task is immutable history and is never flagged', () => {
  // Flagging one would demand an edit the writer is explicitly forbidden to make.
  const tasks = [
    '- [ ] **T1** **P0** a',
    '  deps: none',
    '- [x] **T2** [P] **P0** b',
    '  deps: T1',
  ].join('\n');
  assert.deepEqual(parallelismViolations('a/tasks.md', tasks), []);
});

test('multiple conflicting siblings are named together, not one per line', () => {
  const tasks = [
    '- [ ] **T4** [P] **P0** a', '  deps: none',
    '- [ ] **T8** [P] **P0** b', '  deps: none',
    '- [ ] **T11** [P] **P0** c', '  deps: T4, T8',
  ].join('\n');
  const v = parallelismViolations('a/tasks.md', tasks);
  assert.equal(v.length, 1);
  assert.match(v[0], /depends on T4, T8/);
});

test('a covers quote that is not in the PRD is caught', () => {
  // Reported: T5 declared a quote that "does not appear verbatim anywhere".
  const tasks = '- [ ] **T5** **P0** fetch it\n  covers: "the source page is retrieved"\n';
  const prd = '- [ ] **P0**: Given a pending item, the page is fetched and parsed.\n';
  const v = coversViolations('a/tasks.md', tasks, prd);
  assert.equal(v.length, 1);
  assert.match(v[0], /does not appear verbatim/);
});

test('rewrapped whitespace is the same quote', () => {
  // A writer that wraps a long capability has not changed it, and failing that
  // would teach writers the check is noise.
  const tasks = '- [ ] **T1** x\n  covers: "the source page is retrieved and parsed"\n';
  const prd = '- [ ] **P0**: the source page is\n  retrieved and parsed\n';
  assert.deepEqual(coversViolations('a/tasks.md', tasks, prd), []);
});

test('SEVERAL quoted capabilities on one line is the real format', () => {
  // Every plan in the dogfood run used this, and the first cut of the parser
  // split on `;` — turning the whole line into one bogus capability that matched
  // nothing, so the check passed vacuously on exactly the input it exists for.
  const line = '"first capability here" "second capability here"';
  assert.deepEqual(coversQuotes(line), ['first capability here', 'second capability here']);

  const tasks = '- [ ] **T9** x\n  covers: "first capability here" "second capability here"\n';
  assert.deepEqual(parseTasks(tasks)[0].covers, ['first capability here', 'second capability here']);

  const prd = '- [ ] **P0**: first capability here\n- [ ] **P1**: second capability here\n';
  assert.deepEqual(coversViolations('a/tasks.md', tasks, prd), []);
});

test('an unquoted covers line still parses', () => {
  assert.deepEqual(coversQuotes('one thing; another thing'), ['one thing', 'another thing']);
});

test('no PRD to compare against is not a finding', () => {
  assert.deepEqual(coversViolations('a/tasks.md', '- [ ] **T1** x\n  covers: "anything"\n', ''), []);
});
