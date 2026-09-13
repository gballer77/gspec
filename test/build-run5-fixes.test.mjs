// The four fixes chosen from the recipes-4 data: a turn cap on implementer
// runs, a validator format retry, a [P] file-overlap floor, and the
// implementation validator off the cheap tier.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { ENGINES } from '../lib/engines.js';
import { IMPLEMENTER_MAX_TURNS, formatRetryPrompt } from '../lib/build.js';
import { verdictContractGaps } from '../lib/revision-brief.js';
import { parallelFileOverlapViolations } from '../plugin/hooks/floors/plan-lint.mjs';
import { pathsNamedBy } from '../plugin/hooks/floors/named-paths.mjs';
import { repairPlan } from '../lib/auto-repair.js';
import { RECOMMENDED_MODELS, resolveModel } from '../lib/config.js';
import { USAGE_KINDS } from '../lib/usage.js';

const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const engines = await readFile(join(REPO_ROOT, 'lib', 'engines.js'), 'utf-8');

// --- 1. the turn cap -------------------------------------------------------------------

test('the Claude adapter passes --max-turns only when asked, and marks a capped result', async () => {
  const seen = [];
  const ctx = { cwd: '/tmp', permissionMode: 'acceptEdits', dryRun: true, log: (l) => seen.push(l) };
  await ENGINES.claude.runAgent('implementer', 'p', ctx, { needsBash: true, maxTurns: 120 });
  assert.ok(seen.some((l) => /--max-turns 120/.test(l)), seen.join('\n'));
  seen.length = 0;
  await ENGINES.claude.runAgent('profile-writer', 'p', ctx, {});
  assert.ok(!seen.some((l) => /--max-turns/.test(l)));
  assert.match(engines, /capped: o\.subtype === 'error_max_turns'/);
});

test('implementer runs are capped, a capped run continues on a fresh agent, and the scope budget rose', () => {
  assert.equal(IMPLEMENTER_MAX_TURNS, 120);
  const loop = src.match(/async function runImplementScope[\s\S]*?\n}\n/)[0];
  assert.match(loop, /maxTurns: IMPLEMENTER_MAX_TURNS/);
  assert.match(loop, /if \(out\.capped\) \{[\s\S]*?out = \{ \.\.\.out, code: 0 \};/, 'a capped exit is normalized, not reported as an engine error');
  assert.match(loop, /This run is capped at \$\{IMPLEMENTER_MAX_TURNS\} engine turns/, 'the implementer is told');
  assert.match(loop, /Keep test output terse/);
  assert.match(src, /const MAX_SCOPE_RUNS = 10;/);
});

// --- 2. the format retry ------------------------------------------------------------------

test('contract gaps: no findings, no anchors, or fine', () => {
  assert.match(verdictContractGaps('VERDICT: FAIL\nit is all vague').reason, /no finding in the contract shape/);
  assert.match(verdictContractGaps('VERDICT: FAIL\nFINDINGS:\n- [major] a — b\n    evidence: "x"\n- [minor] c — d\n').reason, /2 findings without an `anchor:` line/);
  assert.equal(verdictContractGaps('VERDICT: FAIL\nFINDINGS:\n- [major] a — b\n    anchor: ## Data\n- [minor] c — d\n').reason, null, 'partially anchored is usable');
});

test('the retry asks for the same verdict in the contract shape, and the driver keeps the original unless the retry is strictly better', () => {
  const p = formatRetryPrompt({ title: 'x' }, 'gspec/stack.md', 'VERDICT: FAIL\n- thing', 'carried no finding in the contract shape');
  assert.match(p, /did not follow the gspec-qa verdict contract: carried no finding/);
  assert.match(p, /do not re-review the document, and do not add, drop, or re-grade a finding/);
  assert.match(p, /anchor: <the exact heading/);
  assert.match(p, /VERDICT: FAIL\n- thing$/);
  const fn = src.match(/async function withContractShape[\s\S]*?\n}\n/)[0];
  assert.match(fn, /if \(g\.verdict !== 'FAIL' \|\| runOpts\.noFormatRetry\) return/);
  assert.match(fn, /kind: 'format-retry'/);
  assert.match(fn, /if \(g2\.verdict === 'FAIL' && !verdictContractGaps\(v2\.text\)\.reason\) return \{ v: v2, g: g2 \};/);
  assert.match(src, /let g = grade\(stage, v\.text, target\);\n  \(\{ v, g \} = await withContractShape/, 'applied in judgeOnce');
  // The features stage runs its own validator loop and bypassed judgeOnce —
  // observed live: a feature-validator FAIL with no readable finding went
  // straight to the whole-document revision. Both of its call sites apply it.
  assert.equal((src.match(/= await withContractShape\(stage, target, v, g, ctx/g) || []).length, 3, 'judgeOnce plus both features-stage call sites');
  assert.ok(USAGE_KINDS.includes('format-retry'));
});

// --- 3. the [P] file-overlap floor ---------------------------------------------------------

const PLAN = `## Plan

- [ ] **T1** **P0** Foundation in \`api/src/app.ts\`
  - deps: none
- [ ] **T2** [P] **P0** Add GET route in \`api/src/routes/recipes.ts\`
  - deps: T1
- [ ] **T3** [P] **P0** Add POST route in \`api/src/routes/recipes.ts\` and \`api/src/schema.ts\`
  - deps: T1
- [ ] **T4** [P] **P1** Search glob \`api/src/**/*.test.ts\` and \`web/src/search.tsx\`
  - deps: T1
- [x] **T5** [P] **P1** Old, checked, in \`api/src/routes/recipes.ts\`
  - deps: T1
`;

test('two [P] tasks naming the same file is one violation per file; globs and checked tasks are ignored', () => {
  assert.deepEqual(pathsNamedBy('`a/b.ts`, `chart.js`, `x/*.ts`, `res.json()`'), ['a/b.ts']);
  const v = parallelFileOverlapViolations('t', PLAN);
  assert.equal(v.length, 1);
  assert.match(v[0], /T2 and T3 are both \[P\] and both write `api\/src\/routes\/recipes\.ts`/);
  assert.match(src, /\.\.\.parallelFileOverlapViolations\(rel, tasks\)/, 'wired into the plan lint');
});

test('the repair drops [P] from the later task and leaves the first', () => {
  const { text, repairs } = repairPlan(PLAN, '## Data\n');
  assert.match(text, /\*\*T2\*\* \[P\] \*\*P0\*\*/);
  assert.match(text, /- \[ \] \*\*T3\*\* \*\*P0\*\* Add POST/);
  assert.ok(repairs.some((r) => /T3: dropped \[P\] — it writes `api\/src\/routes\/recipes\.ts`, which \[P\] task T2 also writes/.test(r)));
  assert.deepEqual(parallelFileOverlapViolations('t', text), []);
});

// --- 4. the implementation validator's tier ---------------------------------------------------

test('the recommended tiering keeps the implementation validator off the cheap tier', () => {
  assert.equal(RECOMMENDED_MODELS.claude['implementation-validator'], 'claude-sonnet-5');
  assert.equal(RECOMMENDED_MODELS.claude.qa, 'claude-haiku-4-5', 'the other validators stay cheap');
  assert.equal(resolveModel('implementation-validator', { project: { models: RECOMMENDED_MODELS.claude } }), 'claude-sonnet-5');
  assert.equal(resolveModel('plan-validator', { project: { models: RECOMMENDED_MODELS.claude } }), 'claude-haiku-4-5');
});

test('the validator brief calls browser-default layout a major finding', async () => {
  const t = await readFile(join(REPO_ROOT, 'plugin', 'agents', 'implementation-validator.md'), 'utf-8');
  assert.match(t, /\*\*Browser-default rendering is a major finding\*\*/);
  assert.match(t, /Tokens being "in effect" .* is not the bar/);
});

test('a capped run that checked nothing hands its partial work to the next run, and the group brief comes first', async () => {
  const loop = src.match(/async function runImplementScope[\s\S]*?\n}\n/)[0];
  assert.match(loop, /if \(out\.capped\) \{[\s\S]*?if \(after >= before\) \{[\s\S]*?partial = partialWorkBrief\(await partialWorkEvidence/);
  const { firstRunPrompt: frp } = await import('../lib/build.js');
  const plan = ['---', 'feature: big', '---', '', '## Plan', '', ...Array.from({ length: 12 }, (_, i) => `- [ ] **T${i + 1}** Do ${i + 1}\n  - deps: ${i ? `T${i}` : 'none'}`)].join('\n');
  const p = frp('BASE PROMPT', { instruction: 'Implement big end to end, tasks T1–T12.' }, [{ rel: 't', text: plan }]);
  assert.ok(p.indexOf('THIS RUN: group 1 of') < p.indexOf('BASE PROMPT'), 'the group brief precedes the whole-feature instruction');
  assert.match(p, /This run owns only the group above; do not start any other task/);
  assert.match(p, /a run that ends with no box checked loses its work/);
  const impl = await readFile(join(REPO_ROOT, 'plugin', 'agents', 'implementer.md'), 'utf-8');
  assert.match(impl, /Check tasks as you land them — never at the end/);
});
