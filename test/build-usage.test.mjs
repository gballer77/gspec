// Token accounting. gspec reported wall-clock per stage but not a single token,
// so "did that change help?" could only be answered by spelunking the engine's
// own session logs — and only on Claude. The driver now records what each agent
// spent, because reading is the expense (a measured run: 79M in, 2M out) and
// the per-agent view is what shows whose read scope is too wide.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, chmod, mkdir, readFile } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

// A fake `claude` that answers in the real --output-format json envelope.
const FAKE_CLAUDE = `#!/bin/sh
# The prompt is the argument after -p; the shared helpers key off it.
PROMPT="$*"
${FAKE_ENGINE_SH}
case "$PROMPT" in
  *Validate*) BODY='VERDICT: PASS' ;;
  *) deliver "$PROMPT"; BODY='ok' ;;
esac
printf '{"type":"result","result":"%s","num_turns":3,"total_cost_usd":0.25,"usage":{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":50}}\\n' "$BODY"
`;

test('a run records per-agent token usage and reports it', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'claude', { agentFiles: STAGE_AGENTS.map((a) => join('.claude', 'agents', `${a}.md`)) });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'claude'), FAKE_CLAUDE); await chmod(join(bin, 'claude'), 0o755);
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Product: a thing\nscope: small\n');

  const r = await runCli(['build', '--no-review', '--engine', 'claude', 'an idea'], dir,
    { PATH: `${bin}:${process.env.PATH}` });

  const manifest = JSON.parse(await readFile(join(dir, '.gspec', 'build', 'run.json'), 'utf-8'));
  assert.ok(manifest.usage, 'the manifest must carry a usage record');

  const profile = manifest.usage['profile-writer'];
  assert.ok(profile, `expected profile-writer usage, got: ${Object.keys(manifest.usage)}`);
  assert.equal(profile.cacheRead, 1000 * profile.runs, 'cache reads accumulate per run');
  assert.equal(profile.out, 50 * profile.runs);
  assert.ok(profile.turns > 0 && profile.costUsd > 0, 'turns and cost are carried through');

  assert.match(r.output, /Token usage/, 'the run must report what it spent');
  assert.match(r.output, /Input dominates/);
});

// A per-agent total answers "who reads the most" but not "does a repair read
// less than the run that wrote the thing" — and that second question is what
// decides whether resuming an engine session is worth building, since a resumed
// session re-pays for authoring context a targeted revision may not need. The
// totals alone cannot express it: one `runs` count covers both.
test('usage splits authoring from revision, per agent', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'claude', { agentFiles: STAGE_AGENTS.map((a) => join('.claude', 'agents', `${a}.md`)) });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  // Fails the very FIRST validation and passes every one after it, so exactly
  // one stage takes exactly one revision — a countable, unambiguous split.
  await writeFile(join(bin, 'claude'), `#!/bin/sh
PROMPT="$*"
${FAKE_ENGINE_SH}
STAMP="$PWD/.failed-once"
case "$PROMPT" in
  *Validate*)
    if [ -f "$STAMP" ]; then BODY='VERDICT: PASS'; else : > "$STAMP"; BODY='VERDICT: FAIL one finding to fix'; fi
    ;;
  *) deliver "$PROMPT"; BODY='ok' ;;
esac
printf '{"type":"result","result":"%s","num_turns":3,"total_cost_usd":0.25,"usage":{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":50}}\\n' "$BODY"
`);
  await chmod(join(bin, 'claude'), 0o755);
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Product: a thing\nscope: small\n');

  const r = await runCli(['build', '--no-review', '--engine', 'claude', 'an idea'], dir,
    { PATH: `${bin}:${process.env.PATH}` });

  const manifest = JSON.parse(await readFile(join(dir, '.gspec', 'build', 'run.json'), 'utf-8'));
  const revised = Object.entries(manifest.usage || {})
    .filter(([, u]) => u.byKind?.revision?.runs);
  assert.ok(revised.length, `a forced QA failure must produce a revision-kind run; got ${JSON.stringify(manifest.usage)}`);

  for (const [agent, u] of Object.entries(manifest.usage)) {
    const byKind = u.byKind || {};
    const summed = Object.values(byKind).reduce((n, b) => n + b.runs, 0);
    assert.equal(summed, u.runs, `${agent}: every run must land in exactly one kind bucket`);
    assert.equal(
      Object.values(byKind).reduce((n, b) => n + b.in + b.cacheRead + b.cacheWrite, 0),
      u.in + u.cacheRead + u.cacheWrite,
      `${agent}: the split must account for the same input as the total`,
    );
  }

  const [, writer] = revised[0];
  assert.ok(writer.byKind.initial?.runs >= 1, 'the authoring run is recorded as initial');
  assert.equal(writer.byKind.revision.runs, 1, 'the repair is recorded as a revision, not another initial');

  assert.match(r.output, /Authoring vs revision/, 'the split must be reported, not just stored');
  assert.match(r.output, /revision reads \d+% of an initial run/);
});

test('an engine that reports no usage degrades quietly', async (t) => {
  // codex/pi return plain text; accounting must be absent, never wrong.
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), `#!/bin/sh\n${FAKE_ENGINE_SH}\ncase "$*" in\n  *Validate*) printf 'VERDICT: PASS\\n' ;;\n  *) fake_default "$*" ;;\nesac\n`);
  await chmod(join(bin, 'pi'), 0o755);
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Product: a thing\nscope: small\n');

  const r = await runCli(['build', '--no-review', 'an idea'], dir, { PATH: `${bin}:${process.env.PATH}` });
  const manifest = JSON.parse(await readFile(join(dir, '.gspec', 'build', 'run.json'), 'utf-8'));
  assert.equal(manifest.usage, undefined, 'no usage recorded when the engine reports none');
  assert.doesNotMatch(r.output, /Token usage/, 'and nothing is claimed about it');
});
