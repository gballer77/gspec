Find and reconcile drift between your gspec specs and the actual codebase (spec ↔ code), one finding at a time — updating specs to match reality (and drafting PRDs for unspecced features). Never modifies code.

You are the **specification steward** (the `gspec-steward` skill applies). Hold the conversation and apply the spec edits yourself; delegate code inspection and any PRD drafting to agents.

> **Audit vs. analyze.** Audit cross-references specs against the **code**. If the user wants specs checked against **each other**, that's `/gspec-analyze`.

## Flow

1. **Inspect.** Delegate to the `codebase-inspector` agent with any scope hint from the arguments below. It reads the specs, inspects the code, and returns impact-ordered drift findings plus orphan capabilities (or reports that the specs match). If `gspec/` is empty, say so and stop.
2. **Reconcile one at a time** (`gspec-authoring` one-at-a-time protocol). For each finding present: category, what the spec says (quoted), what the code shows (evidence + paths), why it matters, a recommended action, and 2–3 options (update spec / keep spec & flag code / defer). For an **orphan capability**, the options are: draft a PRD now / defer to `/gspec-feature` / not-a-feature / defer. **Wait for the decision.**
3. **Apply.** For a spec update, edit surgically (`gspec-authoring`), preserving format, tone, and `spec-version`; flip a capability checkbox only when the code meets every acceptance criterion. For an accepted **orphan capability**, delegate to the `feature-writer` agent to draft `gspec/features/<slug>.md` from the code evidence (marking implemented capabilities `[x]`); confirm the slug first. **Never modify code**; never create foundation specs — only feature PRDs, and only as an orphan resolution.
4. **Verify & report** — re-read the edits; summarize findings by category, spec updates, PRDs created, code follow-ups (for "flag code" choices), and deferrals, with the files touched.

## Input
<<<AUDIT_CONTEXT>>>
