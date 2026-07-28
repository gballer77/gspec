// Shared plumbing for CLI integration tests: run bin/gspec.js in an isolated
// temp project with an isolated HOME (so a developer's real ~/.gspec and
// ~/.claude never leak into a test or trigger interactive prompts).

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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
export async function runCli(args, cwd, extraEnv = {}) {
  const HOME = await isolatedHome();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv, HOME, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
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
  mkdir -p gspec/features
  printf '%s\\n' '---' "feature: $1" '---' '' "# $1" '' 'A fake PRD, complete enough for QA to judge.' > "gspec/features/$1.md"
}
# Produce whatever deliverable this prompt implies. Checkers write nothing.
deliver() {
  case "$1" in
    *Validate*) return 0 ;;
  esac
  case "$1" in
    *"use this exact slug"*)
      slug=$(printf '%s' "$1" | sed -n 's|.*gspec/features/\\([a-z0-9][a-z0-9-]*\\)\\.md.*|\\1|p' | head -1)
      [ -n "$slug" ] && write_prd "$slug" ;;
    *"feature PRD for this idea"*) write_prd only-feature ;;
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
# The catch-all arm: deliver, then print what that stage parses out of stdout.
# The plan stage is the one whose FILE is written by the driver from stdout, so
# its body (task checkboxes and all) has to come back on stdout.
fake_default() {
  deliver "$1"
  case "$1" in
    *"ordered plan"*) printf '%s\\n' '---' 'feature: fake' '---' '' '## Plan' '' '- [x] T1 Do the thing' ;;
    *) printf 'ok\\n' ;;
  esac
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
