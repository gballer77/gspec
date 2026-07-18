Your agent has a **persistent memory silo** (Claude Code per-agent `memory:`). Its `MEMORY.md` auto-loads (top ~200 lines / 25 KB) into your context at startup — treat it as your accumulated, hard-won lessons for *this kind of work*, and let it shape how you do the task. This skill is the house convention for reading and, when warranted, adding to it.

> Applies where per-agent memory exists (Claude Code). On platforms without a silo there is nothing to capture — ignore this skill.

## When to capture — feedback-driven only
Record a lesson **only when this run carried corrective feedback**:
- a **QA verdict** you were re-delegated to fix (a validator's finding), or
- a **user correction** relayed to you in your input.

Do **not** write memory on a clean first-pass run, and never store run-specific trivia (file names, one-off values, this project's identity). Capture the **generalizable** lesson — the thing that would have made you get it right the first time, on *any* project of this kind. Silence is the default; a memory write is the exception.

## The address tag — required on every lesson
Every entry carries a **target + layer** so the distiller (the learning loop's reviewer) can route it to the right durable home. One entry looks like:

```
## <imperative one-line lesson>
- target: <agent-or-skill-name>      # what this should ultimately improve (e.g. gspec-architect, stack-writer)
- layer: skill | agent | command     # where the durable fix belongs
- trigger: <the feedback that taught it>   # e.g. "QA: stack.md omitted the package manager"
- lesson: <the generalized guidance, 1–3 sentences>
```

Choosing the **layer**:
- **skill** — the lesson is about *how this kind of spec/work should be done* → target the persona/convention skill (the broadest, most reusable home).
- **agent** — it's about *this agent's task mechanics or output contract* → target this agent.
- **command** — it's about *the interview or orchestration flow* → target the command.

An untagged memory write is blocked by the address-tag hook — always include `target:` and `layer:`.

## Keep it lean
Auto-load is capped (~200 lines / 25 KB), so `MEMORY.md` is a curated digest, not a log. One lesson per entry; **merge or delete** a lesson your new one supersedes rather than appending duplicates; push any long supporting detail into a topic file you read on demand. Only ever write your own `.claude/agent-memory/<your-name>/` files — never anything else (your Write/Edit tools are auto-enabled for memory even when your task is otherwise read-only).

## Producer ≠ checker still holds
Memory is *input to* a reviewed skill change, not a shortcut around one. The distiller turns accumulated lessons into a **proposed** skill diff that a human (or a checker agent) approves — a memory entry never edits a skill directly. Write the lesson well; let the loop promote it.
