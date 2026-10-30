// Project settings: install writes every setting into .gspec/config.json with
// its default, re-install keeps what the user changed, and `gspec build` reads
// the file for every option the command line left unset.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, chmod, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';
import { DEFAULT_SETTINGS, fillDefaults, resolveSettings, seedProjectSettings } from '../lib/config.js';
import { commitAll, commitMessage, startBranch, dirtyPaths } from '../lib/git-steps.js';

const config = async (dir) => JSON.parse(await readFile(join(dir, '.gspec', 'config.json'), 'utf-8'));
const writeConfig = async (dir, obj) => {
  await mkdir(join(dir, '.gspec'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'config.json'), JSON.stringify(obj) + '\n');
};
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
async function gitRepo(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

// --- defaults ---------------------------------------------------------------

test('the defaults keep today\'s behavior: checkpoint on, no branch, no per-phase commits, QA on', () => {
  assert.equal(DEFAULT_SETTINGS.git.checkpoint, 'commit');
  assert.equal(DEFAULT_SETTINGS.git.branch, 'none');
  assert.equal(DEFAULT_SETTINGS.git.commitPerPhase, false);
  assert.equal(DEFAULT_SETTINGS.qa.enabled, true);
  assert.equal(DEFAULT_SETTINGS.qa.retries, 1);
  assert.equal(DEFAULT_SETTINGS.build.parallel, 'auto');
  assert.equal(DEFAULT_SETTINGS.build.review, true);
});

test('fillDefaults adds missing keys at every depth and never changes a set value', () => {
  const out = fillDefaults({ target: 'claude', git: { checkpoint: 'off', branch: 'bogus' } });
  assert.equal(out.target, 'claude');
  assert.equal(out.git.checkpoint, 'off');
  assert.equal(out.git.branch, 'bogus', 'an invalid user value is reported at use time, not rewritten');
  assert.equal(out.git.commitPerPhase, false);
  assert.deepEqual(out.qa, DEFAULT_SETTINGS.qa);
});

// --- resolution -------------------------------------------------------------

test('resolveSettings: project beats global beats default', () => {
  const { settings, warnings } = resolveSettings({
    project: { qa: { retries: 3 } },
    global: { qa: { retries: 2, enabled: false }, build: { parallel: 'off' } },
  });
  assert.equal(settings.qa.retries, 3);
  assert.equal(settings.qa.enabled, false);
  assert.equal(settings.build.parallel, 'off');
  assert.equal(settings.git.checkpoint, 'commit');
  assert.deepEqual(warnings, []);
});

test('resolveSettings: a bad value warns, names the file, and falls back', () => {
  const { settings, warnings } = resolveSettings({
    project: { git: { branch: 'yes' }, qa: { retries: -1, enabled: 'no' }, build: { scope: 'huge' } },
  });
  assert.equal(settings.git.branch, 'none');
  assert.equal(settings.qa.retries, 1);
  assert.equal(settings.qa.enabled, true);
  assert.equal(settings.build.scope, null);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /\.gspec\/config\.json: "git\.branch" is "yes"; expected one of "none", "new"/);
});

// --- install ----------------------------------------------------------------

test('seedProjectSettings writes every missing setting once, then nothing', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await writeConfig(dir, { target: 'claude', git: { checkpoint: 'off' } });
  const added = await seedProjectSettings(dir);
  assert.ok(added.includes('git.branch') && added.includes('qa') && added.includes('build'), added.join(','));
  assert.ok(!added.includes('git.checkpoint'));
  const c = await config(dir);
  assert.equal(c.git.checkpoint, 'off', 'the user\'s value survives');
  assert.equal(c.target, 'claude');
  assert.deepEqual(await seedProjectSettings(dir), []);
});

test('install writes the settings, and a re-install keeps an edited value', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const first = await runCli(['install', '-t', 'claude'], dir);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /Added settings to \.gspec\/config\.json/);
  const c = await config(dir);
  assert.deepEqual(c.git, DEFAULT_SETTINGS.git);
  assert.deepEqual(c.build, DEFAULT_SETTINGS.build);

  c.git.commitPerPhase = true;
  await writeConfig(dir, c);
  const again = await runCli(['install', '-t', 'claude'], dir);
  assert.equal(again.code, 0, again.output);
  assert.doesNotMatch(again.output, /Added settings/);
  assert.equal((await config(dir)).git.commitPerPhase, true);
});

// --- gspec build reads the settings ----------------------------------------

test('build: qa.enabled false and build.review false turn the gates off without flags', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });
  await writeConfig(dir, { target: 'pi', qa: { enabled: false }, build: { review: false } });
  const r = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /QA gates: off/);
  assert.match(r.output, /spec review: off/);
});

test('build: a typed flag beats the setting', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });
  await writeConfig(dir, { target: 'pi', qa: { retries: 4 } });
  const fromConfig = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.match(fromConfig.output, /qa-retries: 4/);
  const fromFlag = await runCli(['build', '--dry-run', '--qa-retries', '2', 'an idea'], dir);
  assert.match(fromFlag.output, /qa-retries: 2/);
});

test('build: an invalid setting warns and the run still starts', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: ['.pi/agents/profile-writer.md'] });
  await writeConfig(dir, { target: 'pi', build: { parallel: 'sometimes' } });
  const r = await runCli(['build', '--dry-run', 'an idea'], dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /"build\.parallel" is "sometimes"/);
});

// --- git steps --------------------------------------------------------------

test('commitAll commits the work but never the build\'s run state', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await gitRepo(dir);
  await writeFile(join(dir, 'a.txt'), 'a\n');
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'run.json'), '{}\n');
  const r = await commitAll(dir, commitMessage('chore:', 'gspec build: Profile'));
  assert.ok(r.sha, r.reason);
  assert.equal(git(dir, 'log', '-1', '--format=%s').stdout.trim(), 'chore: gspec build: Profile');
  const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n');
  assert.deepEqual(files, ['a.txt']);
  assert.equal((await commitAll(dir, 'again')).reason, 'nothing to commit');
});

test('commitAll and startBranch are no-ops outside a repo', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  assert.equal((await commitAll(dir, 'x')).reason, 'not a git repository');
  assert.equal((await startBranch(dir, 'x')).reason, 'not a git repository');
});

test('startBranch picks a free gspec/build-<slug> name', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await gitRepo(dir);
  assert.match((await startBranch(dir, 'idea')).reason, /no commits/);
  await writeFile(join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
  assert.equal((await startBranch(dir, 'A Recipe App!')).branch, 'gspec/build-a-recipe-app');
  git(dir, 'checkout', '-q', 'main');
  assert.equal((await startBranch(dir, 'A Recipe App!')).branch, 'gspec/build-a-recipe-app-2');
});

test('commitMessage tolerates an empty prefix', () => {
  assert.equal(commitMessage('', 'x'), 'x');
  assert.equal(commitMessage('feat:', 'x'), 'feat: x');
});

// --- a whole build with the git settings on -------------------------------

const FAKE_PI = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nLooks complete.\\n' ;;
  *) fake_default "$*" ;;
esac
`;

async function seedGitBuild(dir, gitSettings) {
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await writeConfig(dir, { target: 'pi', git: gitSettings });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, '..', `${dir.split('/').pop()}-bin`);
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE_PI);
  await chmod(join(bin, 'pi'), 0o755);
  await gitRepo(dir);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  return { env: { PATH: `${bin}:${process.env.PATH}` }, bin };
}

test('build: git.branch new + git.commitPerPhase commit each stage on a new branch, never the run state', async (t) => {
  const dir = await makeProject();
  const { env, bin } = await seedGitBuild(dir, { branch: 'new', commitPerPhase: true, commitPrefix: 'build:' });
  t.after(() => cleanup(dir, bin));
  const r = await runCli(['build', '--no-review', 'Demo API'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /Working on a new branch: gspec\/build-demo-api/);
  assert.equal(git(dir, 'branch', '--show-current').stdout.trim(), 'gspec/build-demo-api');
  const subjects = git(dir, 'log', '--format=%s', 'main..HEAD').stdout.trim().split('\n').filter(Boolean);
  assert.ok(subjects.length >= 1, r.output);
  for (const s of subjects) assert.match(s, /^build: gspec build: /);
  const touched = git(dir, 'log', '--name-only', '--format=', 'main..HEAD').stdout;
  assert.doesNotMatch(touched, /\.gspec\/build\//);
});

test('build: with the git settings at their defaults, the build makes no commit', async (t) => {
  const dir = await makeProject();
  const { env, bin } = await seedGitBuild(dir, {});
  t.after(() => cleanup(dir, bin));
  const r = await runCli(['build', '--no-review', 'Demo API'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.equal(git(dir, 'branch', '--show-current').stdout.trim(), 'main');
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').stdout.trim(), '1');
});

// --- phase commits leave the user's own changes alone ----------------------

test('dirtyPaths reads modified, staged, deleted and untracked paths, never run state', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await gitRepo(dir);
  for (const f of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(dir, f), `${f}\n`);
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
  await writeFile(join(dir, 'a.txt'), 'changed\n');           // " M" — leading space
  await writeFile(join(dir, 'b.txt'), 'staged\n'); git(dir, 'add', 'b.txt');
  git(dir, 'rm', '-q', '--cached', 'c.txt');
  await mkdir(join(dir, 'sub'), { recursive: true });
  await writeFile(join(dir, 'sub', 'new file.md'), 'x\n');
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'run.json'), '{}\n');
  assert.deepEqual((await dirtyPaths(dir)).sort(), ['a.txt', 'b.txt', 'c.txt', 'sub/new file.md'].sort());
});

test('commitAll leaves excluded paths out, even ones the user already staged', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await gitRepo(dir);
  for (const f of ['a.txt', 'gone.txt']) await writeFile(join(dir, f), `${f}\n`);
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
  // The user's work in progress, before the run.
  await writeFile(join(dir, 'NOTES.local.md'), 'scratch\n');
  await writeFile(join(dir, 'a.txt'), 'wip\n'); git(dir, 'add', 'a.txt');
  const before = await dirtyPaths(dir);
  // The run's work: a new file and a deletion.
  await writeFile(join(dir, 'built.js'), 'x\n');
  await rm(join(dir, 'gone.txt'));
  const r = await commitAll(dir, 'phase', { exclude: before });
  assert.ok(r.sha, r.reason);
  const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort();
  assert.deepEqual(files, ['built.js', 'gone.txt']);
  const left = (await dirtyPaths(dir)).sort();
  assert.deepEqual(left, ['NOTES.local.md', 'a.txt'], 'the user\'s files are still uncommitted');
  assert.match(git(dir, 'diff', '--cached', '--name-only').stdout, /a\.txt/, 'and a.txt is still staged');
});

test('build: files dirty before the run stay out of every phase commit', async (t) => {
  const dir = await makeProject();
  const { env, bin } = await seedGitBuild(dir, { commitPerPhase: true });
  t.after(() => cleanup(dir, bin));
  await writeFile(join(dir, 'NOTES.local.md'), 'scratch\n');
  const r = await runCli(['build', '--no-review', 'Demo API'], dir, env);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /one file already changed before this run — left out of every commit/);
  const touched = git(dir, 'log', '--name-only', '--format=', 'HEAD~1..HEAD').stdout + git(dir, 'log', '--name-only', '--format=').stdout;
  assert.doesNotMatch(touched, /NOTES\.local\.md/);
  assert.match(git(dir, 'status', '--porcelain').stdout, /\?\? NOTES\.local\.md/);
});
