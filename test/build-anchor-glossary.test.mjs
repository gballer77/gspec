// The driver hands writers the exact identifiers the floors will check,
// instead of a rule to derive them from. 27 of 31 plan violations on a
// measured run were a writer slugifying differently from the floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { anchorGlossary, screenIds, formatAnchorGlossary, formatScreenIds } from '../lib/anchor-glossary.js';
import { lintFixPrompt } from '../lib/lint-fix.js';

const ARCH = `## Data

### Entity: IngredientLine
- **module:** api

## API

### Endpoint: GET /recipes/:id
- **module:** api

## UI

### Screen: Recipe Detail
- **module:** web

### Component: AppShell
- **module:** web

## Logic

**Not Applicable** — none.
`;

test('the glossary carries the floor\'s own slug for every anchor', () => {
  assert.deepEqual(anchorGlossary(ARCH).map((a) => a.slug), ['entity-ingredient-line', 'endpoint-get-recipes-id', 'screen-recipe-detail', 'component-app-shell']);
  const text = formatAnchorGlossary(ARCH, 'gspec/features/x/arch.md');
  assert.match(text, /#entity-ingredient-line\s+←\s+### Entity: IngredientLine/);
  assert.match(text, /cite these verbatim/);
  assert.equal(formatAnchorGlossary('# nothing\n'), '');
});

test('screen ids come from ## UI screens only', () => {
  assert.deepEqual(screenIds(ARCH), [{ id: 'screen-recipe-detail', name: 'Recipe Detail' }]);
  assert.match(formatScreenIds(ARCH), /id="screen-recipe-detail"\s+←\s+### Screen: Recipe Detail/);
  assert.doesNotMatch(formatScreenIds(ARCH), /AppShell/);
});

test('the prompts hand the lists over, and the lint fix names the valid targets', async () => {
  const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
  assert.match(src, /async function featurePlanPrompt[\s\S]*?formatAnchorGlossary\(await readOr\(ctx\.cwd, archRel\), archRel\)/);
  assert.match(src, /async function featureDesignPrompt[\s\S]*?formatScreenIds\(await readOr\(ctx\.cwd, archRel\), archRel\)/);
  assert.match(src, /does not resolve\|has no matching\|no <section id=/, 'the glossary joins a lint fix only when a reference failed to resolve');
  const p = lintFixPrompt('t.md', ['t.md: task anchor "#entity-ingredientline" does not resolve to a heading in arch.md'], '', { extraGuidance: [formatAnchorGlossary(ARCH)] });
  assert.match(p, /#entity-ingredient-line/);
});

test('no writer brief sends the agent looking for its own skills', async () => {
  for (const a of ['plan-decomposer', 'feature-architect', 'style-writer', 'feature-designer']) {
    const t = await readFile(join(REPO_ROOT, 'plugin', 'agents', `${a}.md`), 'utf-8');
    assert.doesNotMatch(t, /Re-read your output against the \*\*Mechanical floors\*\* list in/, `${a} still points at the skill`);
    assert.match(t, /do not search for or re-read any skill file/, `${a} says the list is already present`);
  }
});
