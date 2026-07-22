// Full-tree floor scan (pure, I/O-free).
//
// The per-write Claude hooks check one file at the moment it is written. Methods
// that cannot see a write (the Codex Stop gate, a git pre-commit hook, the build
// runtime between stages) instead scan the whole gspec/ tree at a checkpoint and
// run every applicable floor. This module is that aggregator; callers gather the
// inputs from the filesystem and decide how to signal the result.

import { appliesToSpecIntegrity, specIntegrityViolations } from './spec-integrity.mjs';
import { isGuardedSpec, identityCandidates, agnosticismHits } from './agnosticism.mjs';
import { violations as taskViolations } from './task-immutability.mjs';

// Inputs:
//   specs         [{ rel, content }]  every .md/.html under gspec/
//   profile       string | null       gspec/profile.md content (for agnosticism)
//   taskBaselines { rel: content }     turn-start snapshot of each gspec/tasks/*.md
// Returns: [{ rel, floor, message }] — empty when the tree is clean.
export function scanGspecTree({ specs = [], profile = null, taskBaselines = {} } = {}) {
  const candidates = profile ? identityCandidates(profile) : [];
  const out = [];

  for (const { rel, content } of specs) {
    const r = String(rel).replace(/\\/g, '/');

    if (appliesToSpecIntegrity(r)) {
      for (const message of specIntegrityViolations(r, content)) {
        out.push({ rel: r, floor: 'spec-integrity', message });
      }
    }

    if (candidates.length && isGuardedSpec(r)) {
      const hits = agnosticismHits(content, candidates);
      if (hits.length) {
        out.push({ rel: r, floor: 'agnosticism', message: `references product/company identity (${hits.join(', ')}); use generic terms — identity lives only in profile.md` });
      }
    }

    if (r.startsWith('gspec/tasks/') && r.endsWith('.md') && taskBaselines[r] != null) {
      const dead = taskViolations(taskBaselines[r], content);
      if (dead.length) {
        out.push({ rel: r, floor: 'task-immutability', message: `checked-off task(s) ${dead.map((d) => `T${d}`).join(', ')} were altered or removed; checked tasks are immutable — append a new task with "supersedes:" instead` });
      }
    }
  }

  return out;
}
