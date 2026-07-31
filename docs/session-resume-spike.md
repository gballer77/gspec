# Spike: resuming the producer's session for a QA revision

**Verdict: do it, for `claude` only, with a fallback to a fresh agent.**

Measured 2026-07-30 against this repo, `claude-haiku-4-5`, three runs.

## The experiment

A revision today spawns a fresh agent that re-reads everything the verdict refers
to. The alternative is to resume the session that produced the work, so the
producer already holds that context.

| run | what it did | input tokens | cost | turns |
|---|---|---|---|---|
| **A** | fresh: read two files, summarize | 57,544 | $0.0354 | — |
| **B** | **resumed A**, asked a follow-up | **32,401** | **$0.0054** | **1** |
| **C** | fresh: read the same files *and* answer the same follow-up | 57,589 | $0.0278 | 3 |

**B vs C — the comparison that matters: 56% of the input, 19% of the cost, one
turn instead of three.**

Cost falls further than tokens because a resumed turn is nearly all `cache_read`
(31,904 of 32,401), which is billed far below fresh input, and because the agent
does not spend turns re-reading.

## Was the resumed answer actually right?

Yes — and this was the real risk. A session that had been compacted would answer
confidently from a summary. Run B listed all 8 exported function names from
`lib/config.js`, **exactly matching** the file. No loss.

## What breaks, and how it degrades

A stale or unknown session id fails **loudly and distinguishably**:

```
$ claude -r 00000000-dead-beef-... -p "say OK"
exit 1
No conversation found with session ID: 00000000-dead-beef-...
```

Not JSON, not a silent fresh start. So the driver can detect it and fall back to
a fresh agent — which is the pre-existing behavior, so the fallback is free.

## Engine support

- **claude** — `-r/--resume <session_id>` works with `-p`. Sessions persist on
  disk, so a resume works across process restarts (runs A and B were separate
  invocations). `--fork-session` exists if a branch is ever wanted.
- **codex, pi** — no resume flag surfaced in `--help`. This is claude-only, and
  the driver must treat resumption as an optimization, never a requirement.

## What we give up

**Isolation.** A fresh agent per revision is a reproducibility property: the same
prompt yields the same starting state. A resumed agent carries whatever it
previously concluded — including a wrong assumption that produced the defect.
This is a real cost, not a hypothetical one, and it argues for resuming only for
*revisions of the producer's own work*, never for judgment.

**Producer ≠ checker is unaffected** and must stay that way: resume the producer
to fix its own output; the validator is always a separate agent with a fresh
context. Never resume a session that has already judged.

## Caveat on the numbers

This workload was small (57k input). The implementer's real runs are ~10M input,
where the resumed context is itself large. The *direction* is solid — fewer turns
and cache-priced input both hold — but **do not extrapolate 19% to the implement
stage** without measuring there.

## What this means for the surgical-revision work

They are complementary, and resumption does not replace it:

- Resuming makes the prompt naturally surgical — the agent already has the
  context, so the revision only needs to carry the findings.
- But `codex`/`pi` and every stale-session fallback still take the fresh path,
  and that path must not re-send the full authoring prompt.

So: build the surgical revision prompt first (it helps every engine), then layer
session resumption on top for `claude`.
