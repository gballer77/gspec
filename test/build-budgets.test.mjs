// Spec size budgets (feedback §1). The bound that actually shapes a spec lives
// in the WRITER's context — the "Size budgets" table in the gspec-conventions
// skill, preloaded by every spec writer and validator. The driver keeps its own
// copy purely to MEASURE what was produced (a model asked to self-limit reports
// compliance while writing lines twice as long).
//
// Two copies of a number is exactly the drift the skill itself warns about, so
// this test is the guard: it parses the canonical table out of the skill and
// fails if the driver's constants disagree. The skill is the source of truth —
// when they differ, change lib/build.js, not the table.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { SPEC_BUDGETS, SCOPE_FACTOR, budgetFor, budgetLabel, countSpecWords, scopeFromBrief } from '../lib/build.js';

const SKILL = join(REPO_ROOT, 'plugin', 'skills', 'conventions', 'gspec-conventions.md');

// The table maps a `deliverable` cell to a budget cell whose first number is the
// word count: | `profile.md` | 2,000 words |
function parseBudgetTable(md) {
  const out = {};
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+)\|/);
    if (!m) continue;
    const words = m[2].replace(/,/g, '').match(/(\d+)\s*words/);
    if (words) out[m[1]] = Number(words[1]);
  }
  return out;
}

test('the skill declares a size budget for every deliverable the driver measures', async () => {
  const table = parseBudgetTable(await readFile(SKILL, 'utf-8'));
  assert.ok(Object.keys(table).length >= 8, `parsed too few budget rows: ${JSON.stringify(table)}`);

  // SPEC_BUDGETS is keyed by the table's own labels, so this is a straight
  // key-for-key comparison — no translation to get wrong.
  for (const [label, budget] of Object.entries(SPEC_BUDGETS)) {
    assert.equal(table[label], budget,
      `budget drift for ${label}: skill says ${table[label]}, lib/build.js says ${budget}`);
  }
});

test('budgetLabel maps paths onto table rows, and non-deliverables onto nothing', () => {
  assert.equal(budgetLabel('gspec/profile.md'), 'profile.md');
  assert.equal(budgetLabel('gspec/style.html'), 'style.html');
  assert.equal(budgetLabel('gspec/features/user-auth.md'), 'features/<slug>.md');
  // The module tier is budgeted separately from the system tier it sits under.
  assert.equal(budgetLabel('gspec/architecture.md'), 'architecture.md');
  assert.equal(budgetLabel('gspec/architecture/web.md'), 'architecture/<name>.md');
  // Not budgeted: plans (counted in tasks), anything outside gspec/.
  assert.equal(budgetLabel('gspec/tasks/user-auth.md'), null);
  assert.equal(budgetLabel('src/index.js'), null);
});

test('the module tier is measured — sub-files used to have no budget at all', () => {
  // Regression: budgetFor() keyed on exact paths, so every architecture/<name>.md
  // returned null and shipped unmeasured however long it got.
  assert.equal(budgetFor('gspec/architecture/web.md'), 600);
  assert.equal(budgetFor('gspec/architecture/web.md', 'small'), Math.round(600 * SCOPE_FACTOR.small));
});

test('scope tiers scale the budget, and an unknown tier falls back rather than scaling by NaN', () => {
  assert.equal(budgetFor('gspec/profile.md', 'standard'), 2000);
  assert.equal(budgetFor('gspec/profile.md', 'small'), Math.round(2000 * SCOPE_FACTOR.small));
  assert.equal(budgetFor('gspec/profile.md', 'large'), Math.round(2000 * SCOPE_FACTOR.large));
  assert.equal(budgetFor('gspec/profile.md', 'enormous'), 2000);
  // Every PRD shares one budget, whatever its slug.
  assert.equal(budgetFor('gspec/features/user-auth.md'), budgetFor('gspec/features/anything-else.md'));
  // Plans are budgeted in tasks, not words — nothing to measure.
  assert.equal(budgetFor('gspec/tasks/user-auth.md'), null);
});

test('word counting matches what the budget claims to count', () => {
  // Frontmatter is exempt; table CONTENT is not (tables are where an over-long
  // spec hides) — but the pipes and separator rows that draw them are.
  const md = '---\nspec-version: v1\n---\n\n# Title\n\n| a | b |\n| --- | --- |\n| one | two |\n';
  assert.equal(countSpecWords(md, 'gspec/profile.md'), 5);

  // practices.md exempts the Enforcement block — a hook parses it, so its size
  // is contract, not prose.
  const practices = '# P\n\nreal prose here\n\n## Enforcement\n\n' + 'rule '.repeat(500);
  assert.equal(countSpecWords(practices, 'gspec/practices.md'), 4);
  assert.ok(countSpecWords(practices, 'gspec/stack.md') > 500, 'the exemption must apply only to practices.md');

  // style.html is budgeted on prose: tokens, markup and specimens are the artifact.
  const html = '<style>:root{--x:1}</style><script>var a=1</script><p>only these five words count</p>';
  assert.equal(countSpecWords(html, 'gspec/style.html'), 5);
});

test('the scope tier is read from whatever shape the intake wrote it in', () => {
  assert.equal(scopeFromBrief('Product: a game\nscope: small\n'), 'small');
  assert.equal(scopeFromBrief('- **Scope tier**: LARGE'), 'large');
  assert.equal(scopeFromBrief('scope = standard'), 'standard');
  // Absent or unrecognized → null, so the caller applies its own default.
  assert.equal(scopeFromBrief('no tier here'), null);
  assert.equal(scopeFromBrief('scope: gigantic'), null);
  // "scope" is a common English word in a brief — only a key:value line counts.
  assert.equal(scopeFromBrief('The scope of this is small and tidy.'), null);
});
