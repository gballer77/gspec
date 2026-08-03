// The per-feature mechanical lint (feature arch / design / plan) blocks a stage
// and spends a writer run, so what it found has to be visible and has to be
// kept.
//
// It used to print a bare count — "2 lint issues; fixing…" — and record
// nothing. The implement lint was fixed for exactly this defect; this loop kept
// it. A real dogfood run then died here, and the cost was immediate: the
// terminal violation survived in the manifest's `detail`, but the OTHER issue
// in the same round was gone, so the failure could not be fully reconstructed
// from the log or from qa-failures.md — which claims to hold every failing
// verdict a run observes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

// A feature-architect that emits the SAME anchor twice on its first attempt —
// the in-file duplicate the lint exists to catch — and a clean file once it is
// handed the violations. One planned feature keeps the output unambiguous.
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
write_dup_arch() {
  [ -n "$1" ] || return 0
  mkdir -p "$(dirname "$1")"
  printf '%s\\n' '---' 'feature: fake' '---' '' '# Arch' '' '## Data' '' '### Entity: Thing' '' '### Entity: Thing' '' '## API' '' '**Not Applicable** — no HTTP surface.' '' '## UI' '' '### Screen: Main' '' '## Logic' '' '**Not Applicable** — no rules.' > "$1"
}
case "$*" in
  *feature-plan*) printf '\`\`\`json\\n{"features":[{"slug":"only-thing","title":"Only thing","brief":"just this","priority":"P0","dependencies":[]}]}\\n\`\`\`\\n' ;;
  *"Fix these mechanical problems"*) printf '%s\\n' "$*" >> fix-prompt.txt; write_feature_file "$(feature_path "$*" arch.md)"; printf 'fixed\\n' ;;
  *"Write the feature architecture"*) write_dup_arch "$(feature_path "$*" arch.md)"; printf 'ok\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *) fake_default "$*" ;;
esac
`;

async function seedBuildProject(dir) {
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test('a per-feature lint prints what it found, not just how many', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);

  assert.match(r.output, /lint issue/, 'sanity: the lint really fired');
  assert.match(
    r.output,
    /duplicate anchor "### Entity: Thing"/,
    'the finding itself must reach the log — a count alone leaves nothing to review',
  );
});

// The one move that can trade one violation for a different one, on a budget
// that only covers a single round. Observed end to end: a writer qualified an
// anchor ("### Entity: SimEvent (wave variants)"), the grammar floor rejected
// the name, the writer renamed it to the canonical "### Entity: SimEvent" —
// correct, and the only possible name — then wrote `defined-in:` because
// nothing in that finding said otherwise. That second origin failed the stage
// on the re-lint with the retry already spent.
test('the lint fix warns that a rename inherits the origin/delta rule', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  await runCli(['build', '--no-review', 'an idea'], dir, env);

  const prompt = await readFile(join(dir, 'fix-prompt.txt'), 'utf-8');
  assert.match(prompt, /duplicate anchor "### Entity: Thing"/, 'sanity: the real violation is in the prompt');
  assert.match(prompt, /If a fix RENAMES an anchor/, 'the rename hazard must reach the writer, not sit in the source');
  assert.match(prompt, /amends:/, 'and it must name the correct alternative to a second defined-in');
});

test('a per-feature lint finding is kept in the durable QA log', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedBuildProject(dir);

  await runCli(['build', '--no-review', 'an idea'], dir, env);

  const log = await readFile(join(dir, '.gspec', 'build', 'qa-failures.md'), 'utf-8');
  assert.match(
    log,
    /duplicate anchor "### Entity: Thing"/,
    'qa-failures.md claims to hold every failing verdict a run observes — mechanical ones included',
  );
});

// A targeted lint fix can resolve exactly what it was told and introduce
// something else. Seen twice on one dogfood run: renaming an anchor collided
// with an existing origin, and restructuring a deferred task named an anchor
// that did not exist. Both times the writer was making real progress and a
// one-round budget ended the build anyway. Mechanical fixes are free — no
// validator run — so this loop gets its own allowance.
test('a lint fix that uncovers a different finding gets another round', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  // Round 1: duplicate anchor. The "fix" resolves it but leaves a BAD anchor
  // name. Round 2 fixes that properly. A one-round budget would fail at round 2.
  await writeFile(join(bin, 'pi'), `#!/bin/sh
PROMPT="$*"
${FAKE_ENGINE_SH}
STAGE1="$PWD/.fixed-once"
dup() { mkdir -p "$(dirname "$1")"; printf '%s\\n' '---' 'feature: fake' '---' '' '# Arch' '' '## Data' '' '### Entity: Thing' '' '### Entity: Thing' '' '## API' '' '**Not Applicable** — none.' '' '## UI' '' '### Screen: Main' '' '## Logic' '' '**Not Applicable** — none.' > "$1"; }
half() { mkdir -p "$(dirname "$1")"; printf '%s\\n' '---' 'feature: fake' '---' '' '# Arch' '' '## Data' '' '### Entity: not a pascal name' '' '## API' '' '**Not Applicable** — none.' '' '## UI' '' '### Screen: Main' '' '## Logic' '' '**Not Applicable** — none.' > "$1"; }
case "$PROMPT" in
  *feature-plan*) printf '\`\`\`json\\n{"features":[{"slug":"only-thing","title":"O","brief":"b","priority":"P0","dependencies":[]}]}\\n\`\`\`\\n' ;;
  *"Fix these mechanical problems"*)
    p=$(feature_path "$PROMPT" arch.md)
    if [ -f "$STAGE1" ]; then write_feature_file "$p"; else : > "$STAGE1"; half "$p"; fi
    printf 'fixed\\n' ;;
  *"Write the feature architecture"*) dup "$(feature_path "$PROMPT" arch.md)"; printf 'ok\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$PROMPT" ;;
esac
`);
  await chmod(join(bin, 'pi'), 0o755);
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }

  const r = await runCli(['build', '--no-review', 'an idea'], dir, { PATH: `${bin}:${process.env.PATH}` });

  assert.match(r.output, /duplicate anchor "### Entity: Thing"/, 'round 1 finding');
  assert.match(r.output, /does not match the anchor grammar/, 'round 2 finding — the one the first fix introduced');
  assert.doesNotMatch(r.output, /still fails the mechanical lint/, 'progress must not be mistaken for failure');
});

test('a lint that reports the same findings twice stops instead of looping', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  // A writer that never actually fixes anything: the findings repeat verbatim.
  await writeFile(join(bin, 'pi'), `#!/bin/sh
PROMPT="$*"
${FAKE_ENGINE_SH}
dup() { mkdir -p "$(dirname "$1")"; printf '%s\\n' '---' 'feature: fake' '---' '' '# Arch' '' '## Data' '' '### Entity: Thing' '' '### Entity: Thing' '' '## API' '' '**Not Applicable** — none.' '' '## UI' '' '### Screen: Main' '' '## Logic' '' '**Not Applicable** — none.' > "$1"; }
case "$PROMPT" in
  *feature-plan*) printf '\`\`\`json\\n{"features":[{"slug":"only-thing","title":"O","brief":"b","priority":"P0","dependencies":[]}]}\\n\`\`\`\\n' ;;
  *"Fix these mechanical problems"*) dup "$(feature_path "$PROMPT" arch.md)"; printf 'unchanged\\n' ;;
  *"Write the feature architecture"*) dup "$(feature_path "$PROMPT" arch.md)"; printf 'ok\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$PROMPT" ;;
esac
`);
  await chmod(join(bin, 'pi'), 0o755);
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }

  const r = await runCli(['build', '--no-review', 'an idea'], dir, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /it is not converging/, 'a writer going in circles must be stopped, not funded');
});
