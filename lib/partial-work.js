// Evidence that an interrupted implementer run left work behind — pure core,
// thin I/O wrapper.
//
// A retry after "exited N without checking a task" re-sent the identical brief
// to a fresh agent. If the dead run had written files but not flipped a box,
// that work was invisible to the retry and often redone — and these runs were
// the largest waste bucket in a measured build. The retry now arrives with a
// short "Partial work found" block: the files unchecked tasks name that
// already exist, and what `git status` shows as touched.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { filesNamedByUncheckedTasks } from '../plugin/hooks/floors/implementation-lint.mjs';

const MAX_LISTED = 30;

/**
 * The block for the retry brief, or '' when there is no evidence.
 * `present` — paths named by unchecked tasks that exist, as [{ id, path }].
 * `gitStatus` — `git status --porcelain` output, or null outside a repo.
 */
export function partialWorkBrief({ present = [], gitStatus = null } = {}) {
  const touched = String(gitStatus || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^[ MADRCU?!]{1,2}\s+/, ''));
  if (!present.length && !touched.length) return '';
  const lines = ['Partial work found. A prior run on this scope was interrupted by an engine error after it had started writing:'];
  if (present.length) {
    lines.push('These files, named by tasks still unchecked, already exist from the interrupted run:');
    for (const { id, path } of present.slice(0, MAX_LISTED)) lines.push(`  ${path} (${id})`);
    if (present.length > MAX_LISTED) lines.push(`  … and ${present.length - MAX_LISTED} more`);
  }
  if (touched.length) {
    lines.push('Working-tree changes not yet committed (git status):');
    for (const t of touched.slice(0, MAX_LISTED)) lines.push(`  ${t}`);
    if (touched.length > MAX_LISTED) lines.push(`  … and ${touched.length - MAX_LISTED} more`);
  }
  lines.push('Verify them and continue from there — do not recreate a file that exists; read it, keep what is correct, and finish it. Check a task only once its work is complete and verified.');
  return lines.join('\n');
}

/**
 * Gather the evidence for a scope's plan files: which unchecked-task paths
 * exist, and the working-tree status. `gitStatus(cwd)` is injected so the
 * core stays testable; it returns null outside a repository.
 */
export async function partialWorkEvidence(cwd, planFiles = [], { gitStatus = async () => null } = {}) {
  const present = [];
  const seen = new Set();
  for (const rel of planFiles) {
    let text;
    try { text = await readFile(join(cwd, rel), 'utf-8'); } catch { continue; }
    for (const { id, path } of filesNamedByUncheckedTasks(text)) {
      if (seen.has(path)) continue;
      seen.add(path);
      try { await stat(join(cwd, path)); present.push({ id, path }); } catch { /* not written yet */ }
    }
  }
  let status = null;
  try { status = await gitStatus(cwd); } catch { status = null; }
  return { present, gitStatus: status };
}
