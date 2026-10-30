Plan a chore — a refactor, migration, module extraction, or other larger piece of work on the code — as `gspec/chores/<slug>/chore.md` plus its ordered plan `tasks.md`, acting as the engineer and gating both through QA. No code — this plans the work; `/gspec-implement` runs it.

You are the **engineer** (the `gspec-engineer` skill applies). Hold the conversation with the user yourself; delegate each isolated write and check to agents.

> **Chore vs. feature.** A feature changes *what* the product does and is a living spec (`/gspec-feature`). A chore changes *how* it is built and is a one-off record — once done it is never kept current. If the request adds user-visible capability, it is a feature; say so and route it there.

## Flow

1. **Read** the specs (`architecture.md` + any `architecture/*.md`, `stack.md`, `practices.md`, the feature folders) and any existing `gspec/chores/` — an open chore that overlaps this one is a conflict to raise now. Skim the code the request names, enough to ask grounded questions. Note the request from the arguments below.
2. **Assess scope.** A chore must fit one plan (≤ 25 tasks). If it does not, propose a split into sequenced chores and **ask the user to confirm before writing anything.**
3. **Interview** (the `gspec-authoring` clarification protocol — **one question per message**, 2–3 suggestions each) to resolve: the goal and the problem it fixes, scope in/out, the approach (big-bang vs. staged/strangler, ordering), the **invariants** (what must not change — behavior, public API, data), done criteria, and rollback. Resolve everything before writing.
4. **Pick the slug** (kebab-case, a verb phrase: `extract-billing-module`, `migrate-orm`) and confirm it; it must not already exist under `gspec/chores/`.
5. **Write.** Delegate to the `chore-writer` agent with the resolved brief → `chore.md` + summary. Present the **Affects** list it found, calling out any entries beyond what the user named — that list is what keeps the durable specs honest, so get the user's eye on it.
6. **QA gate** *(on by default; skip if the user passes `--no-qa` or asks to skip).* Delegate to the `chore-validator` agent, present the verdict, and either re-delegate to `chore-writer` to revise or let the user waive findings. Repeat until PASS or waived. **Every edit re-opens the gate** — after any revision, however small (including a fix the validator itself proposed), re-run `chore-validator` on the file as it now stands before reporting PASS. A PASS on a version the validator never saw is not a PASS.
7. **Plan.** Delegate to the `plan-decomposer` agent in **chore mode** (the chore path, the target `gspec/chores/<slug>/tasks.md`). Every Done Criterion and every Affects spec entry must be covered by a task. Then the plan-mode approval exactly as `/gspec-plan` runs it — present the draft (total tasks, `[P]` count, the full body), **wait for approval**, and write the approved file.
8. **Plan QA gate** *(same `--no-qa` rule).* Delegate to the `plan-validator` agent in chore mode; fix or waive until PASS. The same rule holds: any edit to `tasks.md` after a verdict — yours or the decomposer's — is re-validated before you report PASS.
9. **Report** — the chore path, task count, the Affects spec entries, and QA status. Then the one-line nudge: run `/gspec-implement chore <slug>` to execute it.

## Input
<<<CHORE_DESCRIPTION>>>
