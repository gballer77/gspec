// Shared plumbing for CLI integration tests: run bin/gspec.js in an isolated
// temp project with an isolated HOME (so a developer's real ~/.gspec and
// ~/.claude never leak into a test or trigger interactive prompts).

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { STAGES } from '../lib/build.js';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO_ROOT, 'bin', 'gspec.js');

// One isolated fake HOME per test file run.
let fakeHome;
export async function isolatedHome() {
  if (!fakeHome) fakeHome = await mkdtemp(join(tmpdir(), 'gspec-test-home-'));
  return fakeHome;
}

export async function makeProject() {
  return mkdtemp(join(tmpdir(), 'gspec-test-proj-'));
}

export async function cleanup(...dirs) {
  for (const d of dirs.filter(Boolean)) await rm(d, { recursive: true, force: true });
  if (fakeHome) { await rm(fakeHome, { recursive: true, force: true }); fakeHome = undefined; }
}

// Run the CLI; stdin is closed so any unexpected prompt fails fast instead of
// hanging the suite. `extraEnv` lets a test prepend a fake engine binary to
// PATH or feed flags to it (HOME/color isolation always wins).
export async function runCli(args, cwd, extraEnv = {}, stdin = null) {
  const HOME = await isolatedHome();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv, HOME, FORCE_COLOR: '0', NO_COLOR: '1' },
      // `stdin` lets a test pipe a FEW answers and then hit EOF — the shape a
      // scripted install really has. Default stays 'ignore' so an unexpected
      // prompt fails fast instead of hanging the suite.
      stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    if (stdin !== null) { child.stdin.write(stdin); child.stdin.end(); }
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, output: stdout + stderr }));
  });
}

export async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

// Shared behavior for the fake engine binaries the build tests put on PATH.
// Inserted right after the shebang, ahead of each fake's own `case "$*" in`.
//
// It exists because the build now verifies that a writer actually PRODUCED its
// deliverable: an engine that exits 0 having written nothing is a stage failure
// with an accurate reason, not a silent pass that the next validator gets
// blamed for. A fake standing in for a writer therefore has to leave the
// artifact behind, not just print — same as the real thing.
export const FAKE_ENGINE_SH = `
write_spec() {
  mkdir -p gspec
  printf '# %s\\n\\nWritten by the fake engine.\\n' "$1" > "$1"
}
write_prd() {
  mkdir -p "gspec/features/$1"
  printf '%s\\n' '---' "feature: $1" '---' '' "# $1" '' 'A fake PRD, complete enough for QA to judge.' > "gspec/features/$1/prd.md"
}
# The per-feature writers each own ONE file in the feature folder. The driver
# names the exact path in the prompt, so the fake reads it back out rather than
# reconstructing it — the same discipline the real writers are held to.
feature_path() {
  printf '%s' "$1" | sed -n "s|.*\\(gspec/features/[a-z0-9][a-z0-9-]*/$2\\).*|\\1|p" | head -1
}
write_feature_file() {
  [ -n "$1" ] || return 0
  mkdir -p "$(dirname "$1")"
  case "$1" in
    */arch.md) printf '%s\\n' '---' 'feature: fake' '---' '' '# Arch' '' '## Data' '' '### Entity: Thing' '' '## API' '' '**Not Applicable** — no HTTP surface.' '' '## UI' '' '### Screen: Main' '' '## Logic' '' '**Not Applicable** — no rules.' > "$1" ;;
    */design.html) printf '%s\\n' '<!-- spec-version: v2 -->' '<!DOCTYPE html>' '<section id="screen-main"><h2>Main</h2></section>' > "$1" ;;
    */tasks.md) printf '%s\\n' '---' 'feature: fake' '---' '' '## Plan' '' '- [x] **T1** Do the thing' > "$1" ;;
  esac
}
# Produce whatever deliverable this prompt implies. Checkers write nothing.
deliver() {
  case "$1" in
    *Validate*) return 0 ;;
  esac
  # Match each writer by the distinctive VERB of its prompt, never by a path.
  # Every per-feature prompt also NAMES its sibling files as context, so keying
  # on "a prd.md path appears" made the arch/design/plan writers clobber the PRD.
  case "$1" in
    *"Write ONE feature"*)
      prd=$(feature_path "$1" prd.md)
      slug=$(printf '%s' "$prd" | sed -n 's|gspec/features/\\([a-z0-9][a-z0-9-]*\\)/prd.md|\\1|p')
      [ -n "$slug" ] && write_prd "$slug" ;;
    *"feature PRD for this idea"*) write_prd only-feature ;;
    *"Write the feature architecture"*) write_feature_file "$(feature_path "$1" arch.md)" ;;
    *"Write the feature design"*) write_feature_file "$(feature_path "$1" design.html)" ;;
    *"Decompose the feature"*) write_feature_file "$(feature_path "$1" tasks.md)" ;;
  esac
  case "$1" in
    *'"Product profile" stage'*) write_spec gspec/profile.md ;;
    *'"Technology stack" stage'*) write_spec gspec/stack.md ;;
    *'"Practices" stage'*) write_spec gspec/practices.md ;;
    # ONE format, like the real style-writer: a stage's outputs are alternatives
    # (style.html OR style.md), not a checklist. A fake that wrote both hid a
    # bug where the driver demanded every listed output before calling a stage
    # delivered — see build-style-outputs.test.mjs.
    *'"Style guide" stage'*) write_spec gspec/style.html ;;
    *'"Architecture" stage'*) write_spec gspec/architecture.md ;;
    *'"Competitive research" stage'*) write_spec gspec/research.md ;;
  esac
}
# The catch-all arm: deliver, then print. Every writer now writes its own file,
# so nothing is parsed out of stdout any more.
fake_default() {
  deliver "$1"
  printf 'ok\\n'
}
`;

// Seed a project as if `gspec install -t <target>` recorded it, without the
// full install — for build tests that only need the config + agent files.
export async function seedInstall(dir, target, { agentFiles = [] } = {}) {
  await mkdir(join(dir, '.gspec'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'config.json'), JSON.stringify({ target }) + '\n');
  for (const rel of agentFiles) {
    await mkdir(join(dir, dirname(rel)), { recursive: true });
    await writeFile(join(dir, rel), '---\nname: x\n---\nagent body\n');
  }
}

// Write a run manifest directly, for tests that need an EXISTING run to act on
// (resume behavior, clobber refusal) but are not testing how it got there.
//
// These tests used to seed themselves with `build --dry-run`, which worked only
// because a dry run wrongly persisted its run record. That made the bug
// invisible in the one place designed to catch it: a preview left a run.json
// with every stage marked done, so previewing and then building for real was
// refused, and resuming skipped the whole build. A dry run now writes nothing,
// so a test that wants a manifest has to say so.
export async function seedRun(dir, overrides = {}) {
  const stages = {};
  for (const s of STAGES) stages[s.id] = { status: 'pending', attempts: 0, verdict: null };
  const now = new Date().toISOString();
  const manifest = {
    idea: 'an idea',
    engine: 'pi',
    noQa: false,
    noReview: false,
    research: false,
    scope: 'standard',
    qaRetries: 1,
    permissionMode: 'acceptEdits',
    createdAt: now,
    updatedAt: now,
    stages,
    learnings: [],
    learningsBaseline: {},
    ...overrides,
  };
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// Every agent the stage graph names, derived from STAGES itself.
//
// Each build test used to keep its own hand-written list, so adding an agent
// meant editing ten files and the failure mode was a confusing "agent file not
// found" mid-run. Deriving it means a new stage is seeded everywhere at once.
export const STAGE_AGENTS = [...new Set(
  STAGES.flatMap((s) => [s.writer, s.validator, s.agent, s.orchestrator, s.planner, s.researcher])
    .filter(Boolean),
)];
