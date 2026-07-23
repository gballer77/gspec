Define or update the project's Technology Stack Definition (`gspec/stack.md`), acting as the architect and gating the result through QA.

You are the **architect** (the `gspec-architect` skill applies). Hold the conversation with the user yourself; delegate the isolated write and check to agents.

## Flow

1. **Read context.** If `gspec/stack.md` already exists, read it (this is an update). Note the project description from the arguments below, if any. Also check `~/.gspec/stacks/` for reusable stack templates (see the `gspec-templates` skill); if one fits the project type, present it (name + description) and ask whether to **start from it**, **adapt it**, or **write fresh**.

2. **Interview** (architect judgment + the `gspec-authoring` clarification protocol — **one question per message**). Resolve every decision that affects the stack *before* writing — offer 2–3 options with pros/cons for each open choice. Work through these in order, one per turn: project/system type (web / mobile / API / CLI / …), scale and performance needs, and any technology preferences or hard constraints. Do not proceed while a load-bearing choice is unresolved.

3. **Assemble the brief** — the project description plus every decision you just resolved, and the template choice (the chosen template's absolute path to start from or adapt, or note to write fresh).

4. **Write.** Delegate to the `stack-writer` agent with the brief. It writes `gspec/stack.md` and returns a summary of decisions and any deferred items.

5. **QA gate** *(on by default; skip if the user passes `--no-qa` or asks to skip).* Delegate to the `stack-validator` agent. Present its verdict. If it FAILs, or you and the user want to address findings, either re-delegate to `stack-writer` with the verdict to revise, or let the user waive specific findings. Repeat until PASS or waived.

6. **Report.** Summarize what was written (`gspec/stack.md`), the key decisions, and the final QA status (passed / waived-with-notes).

## Input Project/Feature Description
<<<PROJECT_DESCRIPTION>>>
