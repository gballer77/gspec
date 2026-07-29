// The recommended per-agent model tiering (v3.3).
//
// The `models` map is the largest unused cost lever gspec ships, but which
// models a run bills to is the user's call — so the install OFFERS the tiering
// and never assumes it. These are the guards that keep that true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runCli, makeProject, cleanup } from './helpers.mjs';
import { recommendedModels, hasModelsConfigured, resolveModel } from '../lib/config.js';

const config = async (dir) => JSON.parse(await readFile(join(dir, '.gspec', 'config.json'), 'utf-8'));

test('a headless install writes no models map — that is never a silent default', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await runCli(['install', '-t', 'claude'], dir);
  assert.equal((await config(dir)).models, undefined);
});

test('--models recommended opts in explicitly', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await runCli(['install', '-t', 'claude', '--models', 'recommended'], dir);
  assert.deepEqual((await config(dir)).models, recommendedModels('claude'));
});

test('an existing models map is never overwritten', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await mkdir(join(dir, '.gspec'), { recursive: true });
  const mine = { default: 'my-own-model' };
  await writeFile(join(dir, '.gspec', 'config.json'), JSON.stringify({ models: mine }), 'utf-8');

  await runCli(['install', '-t', 'claude', '--models', 'recommended'], dir);
  assert.deepEqual((await config(dir)).models, mine, 'user configuration must survive an install');
});

test('only the engines that run the build agents have a recommendation', () => {
  assert.ok(recommendedModels('claude'));
  assert.ok(recommendedModels('codex'));
  // cursor/opencode never run these agents; pi's roster moves too fast to ship
  // in a table, so recommending for them would be guessing.
  for (const t of ['cursor', 'opencode', 'pi', 'antigravity']) {
    assert.equal(recommendedModels(t), null, `${t} should carry no recommendation`);
  }
});

test('hasModelsConfigured sees either config file', () => {
  assert.equal(hasModelsConfigured({}, {}), false);
  assert.equal(hasModelsConfigured({ models: {} }, {}), false, 'an empty map is not configuration');
  assert.equal(hasModelsConfigured({ models: { default: 'x' } }, {}), true);
  assert.equal(hasModelsConfigured({}, { models: { qa: 'x' } }), true, 'a global map counts');
});

test('the tiering reaches every agent it is meant to, including the suffix-less ones', () => {
  const project = { models: recommendedModels('claude') };
  const at = (agent) => resolveModel(agent, { project });

  // Validators are ~half of all agent runs, and the cheapest thing to move.
  assert.equal(at('plan-validator'), 'claude-haiku-4-5');
  assert.equal(at('feature-design-validator'), 'claude-haiku-4-5');
  // Everyday authoring.
  assert.equal(at('stack-writer'), 'claude-sonnet-5');
  assert.equal(at('feature-designer'), 'claude-sonnet-5', 'no -writer suffix; reaches the tier via ROLE_BY_NAME');
  // The load-bearing jobs, pinned by name so they beat the writer tier.
  assert.equal(at('implementer'), 'claude-opus-5');
  assert.equal(at('architecture-writer'), 'claude-opus-5');
  assert.equal(at('feature-architect'), 'claude-opus-5');
  // Anything unlisted still resolves.
  assert.equal(at('build-orchestrator'), 'claude-sonnet-5');
});

test('a scripted install runs to completion when it runs out of piped answers', async (t) => {
  // Every prompt shares one stdin, so a script that pipes fewer answers than
  // there are prompts hits EOF partway through. readline's question callback
  // never fires at EOF, so the promise hung, node drained its event loop, and
  // the process exited 0 having SKIPPED every remaining step — an install that
  // reported success with no hooks installed. Running out of input now means
  // "take the default".
  const dir = await makeProject();
  t.after(() => cleanup(dir));

  // First install: no answers at all.
  const first = await runCli(['install', '-t', 'claude'], dir);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /Installed \d+ gspec hooks/, 'the install must reach its LAST step, not stop at a prompt');

  // Re-install: one answer (accept the overwrite), then EOF — the case where a
  // second prompt meets an already-ended stdin.
  const again = await runCli(['install', '-t', 'claude', '--models', 'recommended'], dir, {}, 'y\n');
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /Installed \d+ gspec hooks/);
  assert.deepEqual((await config(dir)).models, recommendedModels('claude'),
    '--models recommended must survive a re-install that exhausts stdin');
});
