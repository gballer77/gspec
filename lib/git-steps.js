// The git steps `gspec build` takes on the project's behalf, driven by the
// `git.*` settings in .gspec/config.json (see DEFAULT_SETTINGS in config.js).
//
// Both are off by default: the build never touched git before these settings
// existed, and a default that starts committing would surprise every existing
// user. Every step is best-effort — outside a repo, or when git refuses, the
// build carries on and says so; a git hiccup is never a build failure.

import { spawn } from 'node:child_process';

function git(cwd, args) {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, out: '', err: e.message }));
    p.on('close', (code) => resolve({ code, out: out.trim(), raw: out, err: err.trim() }));
  });
}

export async function isGitRepo(cwd) {
  return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).out === 'true';
}

// The paths that are modified, staged, deleted or untracked right now. Taken
// when a run starts, these are the user's own work in progress, not the
// build's. The build's run state (.gspec/build/) is never listed: it churns on
// every stage and is meaningless in history.
export async function dirtyPaths(cwd) {
  const r = await git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all']);
  if (r.code !== 0) return [];
  const paths = [];
  // Untrimmed: the first entry's status can start with a space (" M a.js").
  const parts = r.raw.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2);
    paths.push(parts[i].slice(3));
    // A staged rename or copy carries its source path as the next entry.
    if ((status.includes('R') || status.includes('C')) && parts[i + 1]) paths.push(parts[++i]);
  }
  // A path can appear twice (staged deletion + untracked copy), so dedupe.
  return [...new Set(paths)].filter((p) => !p.startsWith('.gspec/build/'));
}

// Commit what changed, minus run state and minus `exclude`. A phase commit
// passes the paths that were already dirty when the run started, so a user's
// scratch files and unrelated edits never get swept into gspec's history.
// It commits an explicit path list (`git commit -- <paths>`), so a file the
// user had already staged stays out too — `git add` with excludes alone would
// still carry it in through the index. Returns the short sha, or null with a
// reason when there was nothing to commit or git declined.
export async function commitAll(cwd, message, { exclude = [] } = {}) {
  if (!(await isGitRepo(cwd))) return { sha: null, reason: 'not a git repository' };
  const skip = new Set(exclude);
  const paths = (await dirtyPaths(cwd)).filter((p) => !skip.has(p)).map((p) => `:(literal)${p}`);
  if (!paths.length) return { sha: null, reason: 'nothing to commit' };
  const add = await git(cwd, ['add', '-A', '--', ...paths]);
  if (add.code !== 0) return { sha: null, reason: add.err || 'git add failed' };
  const commit = await git(cwd, ['commit', '-m', message, '--', ...paths]);
  if (commit.code !== 0) return { sha: null, reason: commit.err || 'git commit failed' };
  return { sha: (await git(cwd, ['rev-parse', '--short', 'HEAD'])).out, reason: null };
}

// `<prefix> <text>`, tolerating an empty prefix.
export function commitMessage(prefix, text) {
  const p = String(prefix ?? '').trim();
  return p ? `${p} ${text}` : text;
}

// A branch name for this run, free in this repo: gspec/build-<idea-slug>, with
// a numeric suffix when one already exists.
export async function freeBranchName(cwd, idea) {
  const slug = String(idea || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'run';
  const base = `gspec/build-${slug}`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if ((await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).code !== 0) return name;
  }
}

// Start the run on a new branch. Uncommitted changes come along, as with any
// `git checkout -b`. A repo with no commits yet has no branch point to leave,
// so it stays where it is.
export async function startBranch(cwd, idea) {
  if (!(await isGitRepo(cwd))) return { branch: null, reason: 'not a git repository' };
  if ((await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code !== 0) return { branch: null, reason: 'the repository has no commits yet' };
  const name = await freeBranchName(cwd, idea);
  const r = await git(cwd, ['checkout', '-b', name]);
  return r.code === 0 ? { branch: name, reason: null } : { branch: null, reason: r.err || 'git checkout failed' };
}
