Shared interaction craft for gspec commands and the agents they orchestrate.

## Clarification protocol
Ask clarifying questions when information essential to the deliverable is missing — do not guess on load-bearing decisions. When you ask, offer **2–3 specific suggestions** with brief pros/cons so the user can react rather than start from a blank page. Resolve every question that affects the output *before* producing it.

**One question per message.** Ask exactly one question, then end your turn and wait for the answer before asking the next. Never enumerate the open questions up front or combine several into one message — when multiple decisions are open, ask the one that most constrains the others first. On harnesses with a structured question tool (e.g. AskUserQuestion), use it with exactly one question per call. A command's list of decisions to resolve is an ordered agenda for the interview, not a questionnaire to send in one message.

Isolated agents can't ask — so the **command** does the interviewing and hands the agent a resolved brief. If an agent nonetheless hits a gap, it makes a clearly-labeled assumption or records a deferred decision; it never blocks and never invents silently.

## One-at-a-time approval (reconciliation commands)
When resolving conflicts, drift, or findings (analyze, audit, qa), present them **one at a time**: show the issue, offer 2–3 resolution options, wait for the user's choice, apply it, then move to the next. Never batch a pile of changes behind a single yes/no.

## Surgical updates
When editing an existing spec, make the minimal change that resolves the issue, preserve the document's format, tone, and frontmatter (including `spec-version`), and don't add changelog annotations — git history is the changelog. Prefer a one-line fix over rewriting a section.
