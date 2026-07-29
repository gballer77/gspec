// The one-line "why did QA fail?" in the run log.
//
// From a real dogfood run: a validator prefaced its verdict with reasoning
// ("Let me just skip that and return the verdict directly:"), and the run
// reported THAT as the entire reason the stage failed. The actual blocker — a
// missing machine-readable enforcement block — never appeared in the log. The
// summary has to skip to the part that carries meaning.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

// summarize() is internal; lift it out rather than widening the module's API
// for a log-formatting helper.
const src = await readFile(join(REPO_ROOT, 'lib', 'build.js'), 'utf-8');
const summarize = eval(`(${src.match(/function summarize[\s\S]*?\n}/)[0].replace('function summarize', 'function')})`);

test('model preamble before the verdict is skipped', () => {
  const verdict = [
    'The MEMORY.md file apparently needs special formatting. Let me just skip that and return the verdict directly:',
    '---',
    '## VERDICT: FAIL',
    '**SPEC:** `gspec/practices.md`',
    '**SUMMARY:** The Enforcement section lacks the machine-readable YAML block the hook parses.',
  ].join('\n');
  const s = summarize(verdict);
  assert.doesNotMatch(s, /MEMORY\.md/, 'the preamble must not be reported as the reason');
  assert.match(s, /Enforcement section lacks/, 'the actual summary must surface');
});

test('with no SUMMARY line, the first finding is used', () => {
  const verdict = [
    'VERDICT: FAIL',
    '**SPEC:** `gspec/stack.md`',
    '[blocker] The package manager is never named',
    'more detail here',
  ].join('\n');
  assert.match(summarize(verdict), /\[blocker\] The package manager is never named/);
});

test('a clean verdict with neither still yields something useful', () => {
  assert.match(summarize('VERDICT: FAIL\nit is bad'), /it is bad/);
  // No verdict line at all (a malformed response) falls back to the first lines.
  assert.match(summarize('total nonsense from the engine'), /total nonsense/);
});

test('output stays bounded', () => {
  const long = `VERDICT: FAIL\n**SUMMARY:** ${'x'.repeat(500)}`;
  const s = summarize(long);
  assert.ok(s.length <= 201, `expected a bounded one-liner, got ${s.length} chars`);
});
