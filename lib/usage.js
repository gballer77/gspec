// Token accounting for `gspec build` — pure, so the shape can be tested without
// spawning an engine.
//
// The driver used to keep one bucket per agent plus an initial/revision split,
// and the split was the whole story it could tell. A measured build spent 83%
// of its input on the implementer, and the largest single waste in that number
// — runs that exited without checking a task, then re-ran with the identical
// prompt — was invisible: a retry was an "initial" run like any other. The
// number could only be inferred from log lines.
//
// So two things are recorded that were not:
//   • KIND, widened beyond initial/revision to name every way a run is spent:
//       initial          — the first attempt at a deliverable or scope
//       revision         — a repair against a validator verdict
//       lint-fix         — a repair against the deterministic floor (free of a
//                          validator, but it still costs a writer run)
//       continuation     — a fresh agent picking up a scope or draft that a
//                          prior run left unfinished
//       transient-retry  — the same brief re-sent after an engine error
//   • PROGRESS, per run: did it move the build? For an implementer, a task
//     was checked; for a writer, the deliverable exists. A run with no
//     progress is the waste bucket, whatever its kind.

export const USAGE_KINDS = ['initial', 'revision', 'lint-fix', 'continuation', 'transient-retry'];

const empty = () => ({ runs: 0, in: 0, cacheRead: 0, cacheWrite: 0, out: 0, turns: 0, costUsd: 0 });

/**
 * Fold one agent run into the accumulator (mutates and returns it).
 *
 * `out` is the engine's result: `{ usage, turns, costUsd }` where `usage` is the
 * Claude-shaped token record. An engine that reports no usage contributes
 * nothing — the accumulator is left exactly as it was, so the totals never
 * guess.
 *
 * `flags.progress` (boolean) says whether this run advanced the build; when
 * given, the per-agent `noProgress` bucket counts the runs that did not.
 */
export function accumulate(acc, agentName, out, kind = 'initial', flags = {}) {
  const u = out?.usage;
  if (!u) return acc;
  const a = (acc[agentName] ??= empty());
  const add = (t) => {
    t.runs += 1;
    t.in += u.input_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0;
    t.out += u.output_tokens || 0;
    t.turns += out.turns || 0;
    t.costUsd += out.costUsd || 0;
  };
  add(a);
  const k = USAGE_KINDS.includes(kind) ? kind : 'initial';
  add((a.byKind ??= {})[k] ??= empty());
  if (flags.progress === false) add(a.noProgress ??= empty());
  return acc;
}

const totalIn = (b) => (b ? b.in + b.cacheRead + b.cacheWrite : 0);

/**
 * The waste view of an accumulator: per agent, the runs that made no progress
 * and what they read, biggest first. Agents with no such run are omitted, so
 * an empty result means "nothing was wasted", not "nothing was measured".
 */
export function waste(acc = {}) {
  return Object.entries(acc)
    .filter(([, a]) => a.noProgress?.runs)
    .map(([agent, a]) => ({
      agent,
      runs: a.noProgress.runs,
      totalRuns: a.runs,
      inputTokens: totalIn(a.noProgress),
      byKind: Object.fromEntries(
        Object.entries(a.byKind || {}).filter(([k]) => k === 'transient-retry' || k === 'continuation').map(([k, b]) => [k, b.runs]),
      ),
    }))
    .sort((x, y) => y.inputTokens - x.inputTokens);
}

/**
 * Lint rounds versus QA revisions, summed across agents. A lint fix is free of
 * a validator run but still spends a writer; a revision spends both. Reporting
 * them apart is what lets a build say "six of ten self-heals were mechanical".
 */
export function lintVsQa(acc = {}) {
  let lintRuns = 0, lintIn = 0, qaRuns = 0, qaIn = 0;
  for (const a of Object.values(acc)) {
    lintRuns += a.byKind?.['lint-fix']?.runs || 0;
    lintIn += totalIn(a.byKind?.['lint-fix']);
    qaRuns += a.byKind?.revision?.runs || 0;
    qaIn += totalIn(a.byKind?.revision);
  }
  return { lint: { runs: lintRuns, inputTokens: lintIn }, qa: { runs: qaRuns, inputTokens: qaIn } };
}
