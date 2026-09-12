// The usage record names how each run was spent and whether it moved the
// build. Before this, a retry after an engine error was an "initial" run like
// any other, and the largest waste bucket in a measured build — implementer
// runs that checked zero tasks — could only be inferred from log lines.
//
// Pure: drives lib/usage.js directly, no engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { accumulate, waste, lintVsQa, USAGE_KINDS } from '../lib/usage.js';

const out = (n = 1) => ({
  usage: { input_tokens: 10 * n, cache_creation_input_tokens: 100 * n, cache_read_input_tokens: 1000 * n, output_tokens: 5 * n },
  turns: 3,
  costUsd: 0.1,
});

test('every kind lands in its own bucket, and the totals still add up', () => {
  const acc = {};
  for (const kind of USAGE_KINDS) accumulate(acc, 'implementer', out(), kind);
  const a = acc.implementer;
  assert.equal(a.runs, USAGE_KINDS.length);
  for (const kind of USAGE_KINDS) assert.equal(a.byKind[kind].runs, 1, `${kind} must be its own bucket`);
  const summed = Object.values(a.byKind).reduce((n, b) => n + b.in + b.cacheRead + b.cacheWrite, 0);
  assert.equal(summed, a.in + a.cacheRead + a.cacheWrite);
});

test('a lint-fix run never inflates the revision bucket', () => {
  const acc = {};
  accumulate(acc, 'plan-decomposer', out(), 'initial');
  accumulate(acc, 'plan-decomposer', out(), 'lint-fix');
  assert.equal(acc['plan-decomposer'].byKind.revision, undefined);
  assert.equal(acc['plan-decomposer'].byKind['lint-fix'].runs, 1);
  const lq = lintVsQa(acc);
  assert.equal(lq.lint.runs, 1);
  assert.equal(lq.qa.runs, 0);
});

test('a run flagged as no-progress is counted as waste with its input', () => {
  const acc = {};
  accumulate(acc, 'implementer', out(1), 'initial', { progress: true });
  accumulate(acc, 'implementer', out(2), 'transient-retry', { progress: false });
  accumulate(acc, 'implementer', out(3), 'continuation', { progress: false });
  const w = waste(acc);
  assert.equal(w.length, 1);
  assert.equal(w[0].agent, 'implementer');
  assert.equal(w[0].runs, 2);
  assert.equal(w[0].totalRuns, 3);
  assert.equal(w[0].inputTokens, (10 + 100 + 1000) * (2 + 3));
  assert.deepEqual(w[0].byKind, { 'transient-retry': 1, continuation: 1 });
});

test('an unflagged run is not called waste — the question was not asked', () => {
  const acc = {};
  accumulate(acc, 'style-writer', out(), 'initial');
  assert.deepEqual(waste(acc), []);
});

test('an engine that reports no usage leaves the accumulator untouched', () => {
  const acc = {};
  accumulate(acc, 'implementer', { code: 0, text: 'ok' }, 'initial', { progress: false });
  assert.deepEqual(acc, {});
});

test('an unknown kind falls into initial rather than minting a bucket', () => {
  const acc = {};
  accumulate(acc, 'x', out(), 'whatever');
  assert.equal(acc.x.byKind.initial.runs, 1);
});

// --- which rules fire ---------------------------------------------------------

import { lintRuleKey, tallyRules, formatRuleTally } from '../lib/usage.js';

test('violations and repairs are classified into the rule they belong to', () => {
  const cases = [
    ['gspec/features/x/tasks.md: task anchor "#entity-ingredientline" does not resolve to a heading in arch.md', 'anchor does not resolve'],
    ['T1: arch reference "#entity-ingredientline" → #entity-ingredient-line (the one heading it matches)', 'anchor does not resolve'],
    ['t: T4 is marked [P] but depends on T1, T2, which are also [P] — …', '[P] honesty'],
    ['T3: dropped [P] — it depends on T2', '[P] honesty'],
    ['a: heading "### Rule: Pagination" does not match the anchor grammar for ## API (…)', 'anchor grammar'],
    ['moved "### Rule: Pagination" from ## API to ## Logic — a Rule has exactly one legal section', 'anchor grammar'],
    ['d: no <section id="screen-cart"> for screen "Cart" — every screen in the architecture must be rendered', 'screen coverage'],
    ['t: T2 covers: "x" but that text does not appear verbatim in the PRD — …', 'covers verbatim'],
    ['gspec/style.html is missing its first-line "<!-- spec-version: v2 -->" comment.', 'spec-version'],
    ['t: T1 is checked but src/a.ts does not exist — a checked task is the record of work', 'missing work'],
    ['gspec/features/x/arch.md: render /: HTTP 404, expected 200', 'render'],
    ['something the classifier has never seen', 'other'],
  ];
  for (const [msg, key] of cases) assert.equal(lintRuleKey(msg), key, msg);
});

test('the tally counts occurrences and formats most-frequent first', () => {
  const acc = tallyRules({}, ['t: task anchor "a" does not resolve to a heading in arch.md', 't: task anchor "b" does not resolve to a heading in arch.md', 't: T4 is marked [P] but depends on T1']);
  assert.deepEqual(acc, { 'anchor does not resolve': 2, '[P] honesty': 1 });
  assert.equal(formatRuleTally(acc), 'anchor does not resolve ×2 · [P] honesty ×1');
});
