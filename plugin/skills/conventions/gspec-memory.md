When a run corrects you, the correction is worth more than the fix. This skill is the house convention for **recording** that correction as a memory — one file, written where the reviewer will find it. It is the producer half of the learning loop; the reviewer half is `/gspec-memorize`.

Everything gspec remembers lives in `.gspec/memory/`, in two tiers:

| Tier | Path | Written by | In your context? |
|---|---|---|---|
| **pending** | `.gspec/memory/pending/<agent>/<file>.md` | you, during a run | no — not until reviewed |
| **committed** | `.gspec/memory/<skill>.md`, `~/.gspec/memory/<skill>.md` | the human, via `/gspec-memorize` or `/gspec-teach` | yes — composed into the skill you already preload |

You write **only** to `pending/`. The committed tier is off-limits (the skill-write guard blocks it): a memory that edits a skill without passing review is the silent auto-edit this loop exists to prevent.

## When to record — feedback-driven only
Record a memory **only when this run carried corrective feedback**:
- a **QA verdict** you were re-delegated to fix (a validator's finding), or
- a **user correction** relayed to you in your input.

Do **not** write on a clean first-pass run, and never store run-specific trivia (file names, one-off values, this project's identity). Record the **generalizable** memory — the thing that would have made you get it right the first time, on *any* project of this kind. Forgetting is the default; a memory is the exception.

## On a revision run, recording is part of your return contract
A run whose input carries a QA verdict or a relayed user correction is a **recording run** — the trigger above has fired. Do not return from one without exactly one of:
- a pending memory file written, or
- an explicit line in your returned summary stating why the finding was purely project-specific (nothing generalizable to remember).

Returning from a recording run with neither — or with only run-specific trivia stored — is an incomplete run. Failing the same gate twice and remembering nothing means the next run repeats the mistake.

## One memory, one file
Write to `.gspec/memory/pending/<your-agent-name>/<scope>--<slug>.md`, where `<scope>` is the scope label you were given (the feature slug, the story, the stage — whatever names *this* unit of work) and `<slug>` is a kebab-case squash of the memory's one-line heading.

**Never append to a shared file.** Same-wave agents run concurrently and your Write replaces the whole file — a shared path silently loses whichever memory lands first. Disjoint paths are the only safe recording under fan-out. If the exact path already exists, you are superseding your own earlier memory: rewrite the file rather than inventing a second name for the same thing.

```markdown
---
target: gspec-architect        # what this should ultimately improve (a skill, agent or command name)
layer: skill                   # skill | agent | command — where the durable fix belongs
agent: architecture-writer     # you
trigger: "QA: stack.md omitted the package manager"
---

## <imperative one-line memory>

<the generalized guidance, 1–3 sentences>
```

`target:` and `layer:` are the **address tag** — the reviewer routes the memory by them, and a write missing either is blocked by the address-tag hook. The `## ` heading is the same shape a committed memory uses, so committing is a copy rather than a rewrite.

Choosing the **layer**:
- **skill** — the memory is about *how this kind of spec/work should be done* → target the persona/convention skill (the broadest, most reusable home).
- **agent** — it's about *this agent's task mechanics or output contract* → target this agent.
- **command** — it's about *the interview or orchestration flow* → target the command.

## You do not choose a scope
`personal` vs `project` vs `gspec` is decided by the human at review time, in `/gspec-memorize` or `/gspec-teach` — it turns on whether the memory should follow *them*, stay with *this repo*, or go upstream as a defect report, a call you cannot make from inside one run. Record it; the reviewer routes it.

## Producer ≠ checker still holds
A pending memory is *input to* a reviewed change, never a shortcut around one. It does not load into any agent's context and changes no behavior until a human commits it — at which point it is composed into the skill and every agent that preloads that skill remembers it. Write it well; let the loop commit it.

> **Read-only agents don't record.** If your tools do not include `Write`, you have no pending store to write to — and you do not need one: your `VERDICT: FAIL` is already recorded to `.gspec/agent-runs/feedback-log.md`, which the memorizer reads as corroborating evidence. Note the generalizable memory in your returned verdict instead.
