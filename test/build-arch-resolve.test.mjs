// The declare → resolve → elaborate barrier.
//
// v3 shared anchors between features at WRITE time: every architect grepped its
// siblings and amended on a hit. It could not work — sibling folders are being
// written while you read them, so what a writer sees depends on when it ran. A
// measured build had five features mint five differently-named definitions of
// one rule, the fifth with sight of all four predecessors.
//
// So the judgment moved to a barrier that sees every declaration at once, and
// these are the properties that has to hold for that to be safe: the skeleton
// cannot be mistaken for a finished spec, the resolve step is fed the whole
// graph, duplicates stop blocking, and a feature that spans modules gets every
// module tier it touches.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, exists, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';
import { STAGES } from '../lib/build.js';

const RESOLUTION = join('.gspec', 'build', 'resolution.json');

// A two-module architecture, so resolve has more than one spine to write and the
// single-module shortcut cannot hide a bug.
const ARCHITECTURE = `---
spec-version: v2
---

# Architecture

## Modules & Verification

| name | dir | build | test |
| --- | --- | --- | --- |
| api | services/api | npm run build | npm test |
| web | apps/web | npm run build | npm test |
`;

// Both features declare `### Entity: Session` locally, tagged to `api`. Under
// the old rule that was a build-failing duplicate origin; it is now the work
// list the barrier consumes.
const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
declare_spanning() {
  path=$(feature_path "$1" arch.md)
  [ -n "$path" ] || return 0
  mkdir -p "$(dirname "$path")"
  slug=$(printf '%s' "$path" | sed -n 's|gspec/features/\\([a-z0-9-]*\\)/arch.md|\\1|p')
  printf '%s\\n' '---' "feature: $slug" 'module: api, web' 'stage: declared' '---' '' '## Data' '' '### Entity: Session' '- **module:** api' "- **defined-in:** $path" '- **intent:** who is signed in' '' '## API' '' "### Endpoint: POST /$slug" '- **module:** api' "- **defined-in:** $path" '- **intent:** the write path' '' '## UI' '' '### Screen: Main' '- **module:** web' "- **defined-in:** $path" '- **intent:** the surface' '' '## Logic' '' '**Not Applicable** — no rules.' > "$path"
  echo "$slug" >> declare-calls.log
}
elaborate_spanning() {
  path=$(feature_path "$1" arch.md)
  [ -n "$path" ] || return 0
  slug=$(printf '%s' "$path" | sed -n 's|gspec/features/\\([a-z0-9-]*\\)/arch.md|\\1|p')
  printf '%s\\n' '---' "feature: $slug" 'module: api, web' '---' '' '## Data' '' '### Entity: Session' '- **module:** api' '- **uses:** gspec/architecture/api.md' '' '## API' '' "### Endpoint: POST /$slug" '- **module:** api' "- **defined-in:** $path" '' 'The write path, in full.' '' '## UI' '' '### Screen: Main' '- **module:** web' "- **defined-in:** $path" '' 'The surface, in full.' '' '## Logic' '' '**Not Applicable** — no rules.' > "$path"
}
resolve_module() {
  path=$(printf '%s' "$1" | sed -n 's|.*\\(gspec/architecture/[a-z0-9-]*\\.md\\).*|\\1|p' | head -1)
  [ -n "$path" ] || return 0
  mkdir -p "$(dirname "$path")"
  name=$(printf '%s' "$path" | sed -n 's|gspec/architecture/\\([a-z0-9-]*\\)\\.md|\\1|p')
  printf '%s\\n' '---' 'spec-version: v2' "module: $name" '---' '' '# Module' '' '## Data' > "$path"
  # Only the api spine promotes the shared entity; web gets none.
  if [ "$name" = api ]; then
    printf '%s\\n' '' '### Entity: Session' "- **module:** $name" "- **defined-in:** $path" '' 'The one definition.' >> "$path"
  fi
  printf '%s\\n' "$1" >> resolve-briefs.log
  echo "$name" >> resolve-calls.log
}
# The Architecture stage really runs, and the shared fake's write_spec would
# clobber the seeded Modules table with a stub — leaving resolve nothing to
# partition by. Write the real two-module table instead.
write_architecture() {
  mkdir -p gspec
  printf '%s\\n' '---' 'spec-version: v2' '---' '' '# Architecture' '' '## Modules & Verification' '' '| name | dir | build | test |' '| --- | --- | --- | --- |' '| api | services/api | npm run build | npm test |' '| web | apps/web | npm run build | npm test |' > gspec/architecture.md
  # One module-tier file per row — including for a single-module project. The
  # stage's deliverable is a SET, and the tier is where the spine goes.
  mkdir -p gspec/architecture
  for m in api web; do
    printf '%s\\n' '---' 'spec-version: v2' "module: $m" '---' '' "# $m" '' 'Seeded by the fake engine.' > "gspec/architecture/$m.md"
  done
}
case "$*" in
  *'"Architecture" stage'*) write_architecture; printf 'wrote the architecture\\n' ;;
  *feature-plan*) printf '\`\`\`json\\n{"features":[{"slug":"sessions","title":"Sessions","brief":"sign in","priority":"P0","dependencies":[]},{"slug":"profiles","title":"Profiles","brief":"me","priority":"P1","dependencies":[]}]}\\n\`\`\`\\n' ;;
  *"DECLARE the architecture anchors"*) declare_spanning "$*"; printf 'declared\\n' ;;
  *"Resolve the shared architecture"*) resolve_module "$*"; printf 'resolved\\n' ;;
  *"Write the feature architecture"*) elaborate_spanning "$*"; printf 'elaborated\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *) fake_default "$*" ;;
esac
`;

async function seeded(dir) {
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Sessions and profiles, across an api and a web app.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  // Pre-seed the foundations so the run reaches the architecture stages fast,
  // and give architecture.md a real Modules table — resolve partitions by it.
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), `# ${f}\n\nSeeded.\n`, 'utf-8');
  }
  await writeFile(join(dir, 'gspec', 'architecture.md'), ARCHITECTURE, 'utf-8');
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test('the stage graph declares, resolves, then elaborates — in that order', () => {
  const ids = STAGES.map((s) => s.id);
  const declare = ids.indexOf('feature-arch-declare');
  const resolve = ids.indexOf('arch-resolve');
  const elaborate = ids.indexOf('feature-arch');
  assert.ok(declare >= 0 && resolve >= 0 && elaborate >= 0, ids.join(' '));
  assert.ok(declare < resolve && resolve < elaborate, `wrong order: ${ids.join(' → ')}`);

  // The barrier is what makes reading every sibling safe, so it must not be a
  // per-feature stage that could interleave with the writers it reads.
  assert.equal(STAGES[resolve].type, 'arch-resolve');
  // No new agent — the roster is unchanged, which is why manifest.js is not.
  assert.equal(STAGES[resolve].writer, 'architecture-writer');
  assert.equal(STAGES[declare].writer, 'feature-architect');
});

test('declare has no agent validator — the artifact is a heading list', () => {
  const declare = STAGES.find((s) => s.id === 'feature-arch-declare');
  assert.equal(declare.validator, undefined,
    'spending a validator run on a skeleton pays twice for the same file');
  assert.ok(declare.lint, 'the floor still decides everything a regex can');
});

test('a full run declares, resolves per module, elaborates, and records the assignment', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seeded(dir);
  {
    const r = await runCli(['build', 'an idea', '--no-review'], dir, env);

    // Both passes ran for both features, and the barrier ran once per module.
    const declared = (await readFile(join(dir, 'declare-calls.log'), 'utf-8')).trim().split('\n').sort();
    assert.deepEqual(declared, ['profiles', 'sessions']);
    const resolved = (await readFile(join(dir, 'resolve-calls.log'), 'utf-8')).trim().split('\n').sort();
    assert.deepEqual(resolved, ['api', 'web'], 'one resolve run per Modules-table row');

    // The barrier is fed the whole graph: every feature's declarations for its
    // module, and the duplicate it has to adjudicate.
    const briefs = await readFile(join(dir, 'resolve-briefs.log'), 'utf-8');
    assert.match(briefs, /Declarations tagged module "api"/);
    assert.match(briefs, /gspec\/features\/sessions\/arch\.md/);
    assert.match(briefs, /gspec\/features\/profiles\/arch\.md/);
    assert.match(briefs, /entity-session/, 'the duplicate cluster is named, not left to be rediscovered');

    // The assignment is DERIVED by reading the spine back, not parsed out of an
    // agent's answer — a promoted anchor is one that is now in a module tier.
    const resolution = JSON.parse(await readFile(join(dir, RESOLUTION), 'utf-8'));
    assert.ok(resolution.promoted.includes('entity-session'));
    for (const slug of ['sessions', 'profiles']) {
      const mine = resolution.assignments[slug];
      const session = mine.find((a) => a.slug === 'entity-session');
      assert.equal(session.home, 'gspec/architecture/api.md');
      // Everything only one feature declared stays where it was declared.
      assert.ok(mine.some((a) => a.home === 'local'), `${slug} kept nothing local`);
    }

    // `promoted` is what THIS BARRIER moved up; `spineAnchors` is everything
    // standing in the module tier, most of which the architecture-writer minted
    // before any feature declared. Conflating them made this file contradict the
    // stage's own log line — a dogfood run wrote `promoted: [13 items]` beside
    // "0 anchors promoted", and this file is trusted precisely because it is the
    // cheapest read in the run.
    const derived = [...new Set(Object.values(resolution.assignments).flat()
      .filter((a) => a.home !== 'local').map((a) => a.slug))].sort();
    assert.deepEqual([...resolution.promoted].sort(), derived,
      'promoted must be exactly what the assignments say moved up');
    for (const s of resolution.promoted) {
      assert.ok(resolution.spineAnchors.includes(s), `${s} promoted but absent from the spine`);
    }

    // The elaborate pass overwrote the skeletons: the marker is gone, so nothing
    // downstream can mistake a declaration for a finished architecture.
    for (const slug of ['sessions', 'profiles']) {
      const arch = await readFile(join(dir, 'gspec', 'features', slug, 'arch.md'), 'utf-8');
      assert.doesNotMatch(arch, /stage:\s*declared/, `${slug} still looks like a declaration`);
      assert.match(arch, /- \*\*uses:\*\* gspec\/architecture\/api\.md/);
    }

    assert.ok(await exists(join(dir, 'gspec', 'architecture', 'api.md')));
    assert.ok(await exists(join(dir, 'gspec', 'architecture', 'web.md')));
    assert.equal(r.code, 0, r.output);
  }
});

// The point of the whole change. Two features declaring one anchor used to fail
// the stage — and the lint gate fails on the first REPEATED finding, so a writer
// that correctly declined the edit killed the build.
test('two features declaring the same anchor does not fail the build', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seeded(dir);
  const r = await runCli(['build', 'an idea', '--no-review'], dir, env);
  assert.doesNotMatch(r.output, /also defined as an origin/,
    'a duplicate declaration is the barrier\'s input, not a finding routed back to a writer');
  assert.equal(r.code, 0, r.output);
});

// A skeleton is >40 chars and opens with frontmatter, so every existing
// well-formedness test passed it. A crash between the passes would then have
// left a file the driver reports as delivered and the next pass skips.
test('a declaration left on disk is not mistaken for a finished architecture', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seeded(dir);
  {
    // Simulate the crash: a complete-looking skeleton, with no run record.
    await mkdir(join(dir, 'gspec', 'features', 'sessions'), { recursive: true });
    await writeFile(join(dir, 'gspec', 'features', 'sessions', 'prd.md'),
      '---\nfeature: sessions\n---\n\n# Sessions\n\nA seeded PRD, complete enough for QA.\n', 'utf-8');
    await writeFile(join(dir, 'gspec', 'features', 'sessions', 'arch.md'),
      ['---', 'feature: sessions', 'module: api', 'stage: declared', '---', '',
        '## Data', '', '### Entity: Session', '- **module:** api',
        '- **defined-in:** gspec/features/sessions/arch.md', '- **intent:** who is signed in', '',
        '## API', '', '**Not Applicable** — none.', '',
        '## UI', '', '**Not Applicable** — none.', '',
        '## Logic', '', '**Not Applicable** — none.', ''].join('\n'), 'utf-8');

    const r = await runCli(['build', 'an idea', '--no-review'], dir, env);
    const arch = await readFile(join(dir, 'gspec', 'features', 'sessions', 'arch.md'), 'utf-8');
    assert.doesNotMatch(arch, /stage:\s*declared/,
      'the elaborate pass skipped the skeleton, so a half-written file shipped as finished');
    assert.equal(r.code, 0, r.output);
  }
});
