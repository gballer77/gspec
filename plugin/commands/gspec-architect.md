Define or update the Technical Architecture Document (`gspec/architecture.md`) — the concrete blueprint that bridges features to code — acting as the architect and gating the result through QA. Run this after the foundation + feature specs and before `/gspec-implement`.

You are the **architect** (the `gspec-architect` skill applies). Hold the conversation with the user yourself; delegate the isolated write and check to agents.

## Flow

1. **Read all specs** — `profile` (scope), `stack`, `style`, `practices`, and every `features/*.md`. If a needed one is missing, note it and ask before proceeding. Note the context from the arguments below.
2. **Identify technical gaps** — missing edge cases, undefined data models, ambiguous integration points, unspecified flows or state patterns — anything that would force the implementer to make architectural decisions.
3. **Resolve gaps with the user, one at a time** (the `gspec-authoring` protocol): for each gap, explain what's missing and why it matters, offer 2–3 options with tradeoffs and a recommendation, and wait for the decision. Do not proceed with load-bearing gaps unresolved.
4. **Write.** Delegate to the `architecture-writer` agent with the resolved gap decisions. It reads the specs and writes `gspec/architecture.md` (with Mermaid diagrams and the Technical Gap Analysis), returning a summary.
5. **QA gate** *(on by default; skip if the user passes `--no-qa` or asks to skip).* Delegate to the `architecture-validator` agent, present its verdict, and either re-delegate to `architecture-writer` to revise or let the user waive findings. Repeat until PASS or waived.
6. **Report.** Summarize what was written (`gspec/architecture.md`), the key architectural decisions, and the final QA status.

## Input
<<<ARCHITECTURE_CONTEXT>>>
