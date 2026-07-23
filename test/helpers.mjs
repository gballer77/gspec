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
