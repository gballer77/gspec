// File writes the installer can make in a repository it did not author.
//
// `npx gspec` writes into paths that already exist in the project — skills,
// CLAUDE.md, .claude/settings.json — and into ~/.gspec. A cloned repo can
// commit any of those paths as a symlink (or a symlinked directory), and a
// plain writeFile follows it: `.claude/skills/gspec-qa/SKILL.md -> ~/.bashrc`
// made an install overwrite the user's shell profile. Names taken from a
// spec's frontmatter or a playbook line reach join() the same way, so
// `name: ../../.config/x` escaped ~/.gspec.
//
// The rule here: a path is written (or removed) only when its REAL location —
// every symlink on the way resolved — stays inside one of the allowed roots.
// A symlink that points somewhere else inside the project (CLAUDE.md ->
// AGENTS.md is common) still works.

import { realpathSync, readlinkSync } from 'node:fs';
import { writeFile, unlink, rm, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, basename, join, resolve, sep } from 'node:path';

/** The roots an install may touch: the project and the user's ~/.gspec library. */
export function defaultRoots(cwd = process.cwd()) {
  return [cwd, join(homedir(), '.gspec')];
}

// The real path of `p`, resolving every symlink that exists — including a
// symlink at `p` itself whose target does not exist yet (a dangling link is
// still a redirect, and writeFile would follow it).
export function realPathOf(p, depth = 0) {
  if (depth > 40) throw Object.assign(new Error(`too many symlinks resolving ${p}`), { code: 'ELOOP' });
  const abs = resolve(p);
  const rest = [];
  let cur = abs;
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      let target = null;
      try { target = readlinkSync(cur); } catch { /* not a link */ }
      if (target !== null) return realPathOf(join(resolve(dirname(cur), target), ...rest), depth + 1);
      const parent = dirname(cur);
      if (parent === cur) return join(cur, ...rest);
      rest.unshift(basename(cur));
      cur = parent;
    }
  }
}

const realRoot = (r) => { try { return realpathSync(r); } catch { return resolve(r); } };

export function isContained(p, roots = defaultRoots()) {
  const real = realPathOf(p);
  return roots.map(realRoot).some((root) => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep));
}

export class ContainmentError extends Error {
  constructor(p, verb) {
    super(`refusing to ${verb} ${p}: it resolves to ${realPathOf(p)}, outside the project and ~/.gspec (a symlink or a "../" in a name). Remove or fix that path and run again.`);
    this.code = 'GSPEC_OUTSIDE_ROOT';
  }
}

function guard(p, verb, roots) {
  if (!isContained(p, roots)) throw new ContainmentError(p, verb);
}

export async function writeFileContained(p, data, encoding = 'utf-8', { roots = defaultRoots() } = {}) {
  guard(p, 'write', roots);
  return writeFile(p, data, encoding);
}

// mkdir too: a write refused after its directory was created through a
// symlink would still have left that directory outside the project.
export async function mkdirContained(p, opts, { roots = defaultRoots() } = {}) {
  guard(p, 'create', roots);
  return mkdir(p, opts);
}

export async function unlinkContained(p, { roots = defaultRoots() } = {}) {
  guard(p, 'delete', roots);
  return unlink(p);
}

export async function rmContained(p, opts = {}, { roots = defaultRoots() } = {}) {
  guard(p, 'delete', roots);
  return rm(p, opts);
}

// A name that becomes one path segment under a library folder: a saved spec,
// a playbook, an extension. No separators, no leading dot, no "..".
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function isSafeName(name) {
  const s = String(name ?? '');
  return NAME_RE.test(s) && !s.includes('..');
}
