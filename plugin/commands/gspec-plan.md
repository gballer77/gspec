Decompose a feature PRD into an ordered, dependency-aware plan (`gspec/features/<slug>/tasks.md`) with parallel markers, acting as the engineer, behind a plan-mode approval gate and a QA gate. Runs between `/gspec-feature` and `/gspec-implement`.

You are the **engineer** (the `gspec-engineer` skill applies). Hold the conversation; delegate the decomposition to an agent; write the file yourself after approval.

## Flow

1. **Resolve the feature** from the arguments below (its PRD at `gspec/features/<slug>/prd.md`; if ambiguous, ask). If a plan file (`gspec/features/<slug>/tasks.md`, or a pre-migration `gspec/tasks/<slug>.md` in a project that has not run `/gspec-migrate`) already exists and is non-empty, ask whether to (a) regenerate, (b) append tasks for newly added capabilities only, or (c) abort — do not overwrite without confirmation. Either way, **checked-off (`- [x]`) tasks are immutable**: they are preserved verbatim and never edited, renumbered, deleted, or unchecked. Regenerating only re-decomposes *unchecked* work; replanning that changes a checked task's work appends a new task with `supersedes: T<n>` (a hook enforces this).
2. **Decompose.** Delegate to the `plan-decomposer` agent (pass the existing plan file on regenerate so IDs are preserved, and the feature's `gspec/features/<slug>/arch.md` when it exists). It returns the draft plan body plus notes. This command **reads** a feature's architecture and never writes it: if `arch.md` is missing, say so and recommend `/gspec-architect` first — the decomposer takes its ordering signals from the architecture, so without one the order is guesswork. Proceed anyway if the user asks.
3. **Plan-mode approval** (the engineer's plan-mode gate). Present the draft — total tasks, `[P]` count, the full proposed body, anything it couldn't decompose, and cross-feature dependencies. **Wait for approval**; the user may edit tasks, reorder, adjust `[P]`, or split/merge. This approval is what lets `/gspec-implement` skip its own plan-mode later.
4. **Write** the approved `gspec/features/<slug>/tasks.md` (creating the feature folder if needed; preserve any prior `spec-version`; new files use the current version). If the plan was found at a pre-migration `gspec/tasks/<slug>.md`, write it back where it was and tell the user `/gspec-migrate` relocates it — never leave a project with a plan in both places. Never overwrite a non-empty file without the Step 1 confirmation, and reproduce every checked task block verbatim — the immutability hook will block a write that alters one.
5. **QA gate** *(on by default; skip if the user passes `--no-qa` or asks to skip).* Delegate to the `plan-validator` agent; present the verdict; re-decompose/fix or let the user waive. Repeat until PASS or waived.
6. **Report** — task count, parallel groups, and final QA status.

## Input Feature
<<<FEATURE_NAME>>>
