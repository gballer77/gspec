Implement the software defined by the project's gspec specs — phased, tested, and checkpointed — acting as the engineer. Delegates the building to isolated `implementer` runs; the conversation, planning, and phase gates stay here.

You are the **engineer** (the `gspec-engineer` skill applies). This builds **code**, so the checker isn't a spec validator — it's the **`implementation-validator`**: a deterministic `verify.sh` (build + test) plus a judgment pass on the in-scope acceptance criteria and the practices' Definition of Done. That gate is **on by default**; it is skipped when the arguments below pass `--no-qa` or `.gspec/config.json` sets `qa.enabled` to `false`.

**Read `.gspec/config.json` first.** Its `git` settings decide the git steps below; a missing file or key means the default shown. A value that isn't one of the listed options: say so and use the default.

| Setting | Default | Options |
|---|---|---|
| `git.checkpoint` | `commit` | `commit` · `ask` (ask before committing) · `off` |
| `git.branch` | `none` | `none` · `new` (start this run on a new branch) |
| `git.commitPerPhase` | `false` | `true` commits after each phase that passes its gate |
| `git.commitPrefix` | `chore:` | any text; starts every commit message gspec writes |
| `qa.enabled` | `true` | `false` skips the phase gates |

## Flow

1. **Discovery.** Read all available gspec docs (`profile`, each `features/<slug>/` folder, `stack`, `style`, `practices`, `architecture` + any `architecture/*.md` sub-files); note any missing (features are optional — don't block). List **open chores** (`gspec/chores/<slug>/` whose `chore.md` is not `status: done`) separately; skip done chores entirely — they are frozen records. Assess status from capability/task checkboxes and present a per-feature summary; if everything is already checked, ask the user what they want to do.
2. **Scope.** Determine what to build this run: the user's prompt takes priority; otherwise unchecked P0 → P1 → P2 across features, respecting dependencies. **A chore runs only when named** (`chore <slug>`, or the user clearly asking for it) — never pull one in by priority — and runs alone: don't mix a chore and features in one run. A chore must have its `tasks.md`; if not, send the user to `/gspec-chore`. List anything excluded as "Out of Scope for This Run."
3. **Plan / build order** (apply the `gspec-orchestrator` judgment — right-sized scopes, dependency ordering, fan out only file-disjoint work). If **every** in-scope feature has a plan file, skip plan mode — those plans are the approved build order; verify each unchecked capability has a covering task (flag gaps), group unchecked tasks into phases by `deps:` (`[P]` = parallel-safe within a phase), and show a one-screen summary. If any in-scope feature lacks a plan file, **enter plan mode**, present a phased plan placing every unchecked unit into a phase or an explicit "Proposed to Defer," and wait for approval.
4. **Git setup.** Before any code. Not a git repo: skip every git step and say so.
   - **Branch** (`git.branch: new`): create and switch to `feat/<slug>` for one feature, `chore/<slug>` for a chore, or `gspec/implement-<YYYY-MM-DD>` for several features. Add `-2`, `-3`… if the name is taken. Tell the user the branch name.
   - **Checkpoint** (`git.checkpoint`): run `git status`. Clean: say so. Dirty with `commit`: `git add -A` and commit `<commitPrefix> pre-implement checkpoint`, then tell the user. Dirty with `ask`: ask whether to commit, and do what they say. With `off`: leave the tree as it is and note it.

   **For a chore**, then record the "before": if `chore.md` has no `base-sha`, write `base-sha: <git rev-parse HEAD>` (omit it outside git) and `status: in-progress` into its frontmatter. Never overwrite an existing `base-sha` — a resumed chore keeps its original before.
5. **Build phase by phase.** For each phase, delegate to the `implementer` agent with that phase's scope (fan out independent `[P]` tasks across parallel implementer runs where safe). It builds, tests, generates/updates `verify.sh`, and flips checkboxes, returning a summary.
6. **Gate each phase** (skipped when QA is off — see above). After a phase's implementer returns, delegate the `implementation-validator` agent on that phase's scope — it runs `verify.sh` (build+test) and judges the in-scope acceptance criteria + Definition of Done, returning a `VERDICT`. On **FAIL**, re-delegate the `implementer` once with the verdict's concrete findings, then re-validate; if it still fails, present the verdict and let the user decide (fix / waive / stop). **Pause after each gated phase** for the user to confirm before the next.

   **Phase commit** (`git.commitPerPhase: true`): once a phase passes its gate — or, with QA off, once it builds — commit `<commitPrefix> <phase name>: <tasks done>`. A phase that fails and is waived is committed too, and the message says `(waived)`.
   - **Commit only the files this phase changed.** Before each phase starts, note what `git status --porcelain` lists. At commit time, stage and commit only the paths it lists now that it did not list then: `git add -- <paths>` and `git commit -m "<message>" -- <paths>`.
   - **Never `git add -A` for a phase commit.** Files that were dirty before the phase are the user's (scratch notes, unrelated edits), and they stay out of the commit even if they're staged. If the phase also edited one of them, leave it out anyway and tell the user which file stayed uncommitted.
7. **Close a chore.** When every chore task, every `## Affects` entry, and every Done Criterion is checked and the last gate passed, set `status: done` and `completed: <today>` in `chore.md`. From then on it is a record, not a spec — nothing updates it again. Tell the user that `/gspec-audit` is the backstop for any effect the Affects list missed.
8. **Verify & report.** After the last phase, confirm checkbox accuracy and task↔capability consistency across the run, flag any unapproved deferral, and present a final implementation summary (scope built, gate results, any waived findings).

## Change requests — during and after the run

When the user asks for a change or challenges a behavior — at a phase gate, after the final report, or anywhere in between — do not act on your reading of the message alone. **First re-open the governing spec for the code in question**: the feature's `arch.md` (especially its `## Logic` rules) and its `prd.md` acceptance criteria — or, in a chore run, `chore.md`'s Approach and Invariants. The Discovery read is stale by that point in the conversation; re-read the file, don't recall it. Then:

- **The spec already decides it** → follow the documented decision and say so, citing the anchor — never re-ask the user a question their spec already answers.
- **The request conflicts with a documented decision** → surface the conflict and let the user pick; if they change the decision, update the `arch.md` anchor (and any affected acceptance criteria) in the same change, so spec and code move together.
- **Neither the request nor the specs decide it** → that is a genuine gap; ask.

## Input
<<<IMPLEMENT_CONTEXT>>>
