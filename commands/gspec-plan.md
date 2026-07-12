Decompose a feature PRD into an ordered, dependency-aware plan (`gspec/features/<slug>.plan.md`) with parallel markers, acting as the engineer, behind a plan-mode approval gate and a QA gate. Runs between `/gspec-feature` and `/gspec-implement`.

You are the **engineer** (the `gspec-engineer` skill applies). Hold the conversation; delegate the decomposition to an agent; write the file yourself after approval.

## Flow

1. **Resolve the feature** from the arguments below (its PRD at `gspec/features/<slug>.md`; if ambiguous, ask). If a plan file already exists and is non-empty, ask whether to (a) regenerate, (b) append tasks for newly added capabilities only, or (c) abort — do not overwrite without confirmation.
2. **Decompose.** Delegate to the `plan-decomposer` agent (pass the existing plan file on regenerate so IDs are preserved). It returns the draft plan body plus notes.
3. **Plan-mode approval** (the engineer's plan-mode gate). Present the draft — total tasks, `[P]` count, the full proposed body, anything it couldn't decompose, and cross-feature dependencies. **Wait for approval**; the user may edit tasks, reorder, adjust `[P]`, or split/merge. This approval is what lets `/gspec-implement` skip its own plan-mode later.
4. **Write** the approved `gspec/features/<slug>.plan.md` (preserve any prior `spec-version`; new files use the current version). Never overwrite a non-empty file without the Step 1 confirmation.
5. **QA gate** *(on by default; skip if the user passes `--no-qa` or asks to skip).* Delegate to the `plan-validator` agent; present the verdict; re-decompose/fix or let the user waive. Repeat until PASS or waived.
6. **Report** — task count, parallel groups, and final QA status.

## Input Feature
<<<FEATURE_NAME>>>
