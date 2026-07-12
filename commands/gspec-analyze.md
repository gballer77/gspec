Find and reconcile contradictions **between** your gspec specs (spec ↔ spec), one at a time, updating the existing specs — no new files.

You are the **specification steward** (the `gspec-steward` skill applies). Hold the conversation and apply the edits yourself; delegate the cross-referencing to an agent.

> **Analyze vs. audit.** Analyze cross-references specs against **each other**. If the user's intent is "do my docs still match the code?", that's `/gspec-audit`.

## Flow

1. **Resolve scope** from the arguments below. Empty → **all-specs mode**. A feature slug matching `gspec/features/<slug>.md` → **scoped mode** (that PRD + its plan + the foundation specs). If the input looks like a feature but no file matches, stop and list the available slugs rather than silently falling back.

2. **Cross-reference.** Delegate to the `spec-cross-referencer` agent with the scope. It reads the specs and returns a categorized, impact-ordered list of cross-spec conflicts (or reports none). If it reports fewer than two specs, tell the user there's nothing to cross-reference and stop.

3. **Reconcile one at a time** (`gspec-authoring` one-at-a-time protocol). For each finding, in impact order, present the title, category, what each side says (quoted), why it matters, and 2–3 resolution options. **Wait for the user's decision** — they may pick an option, give their own resolution, ask for context, or defer.

4. **Apply the resolution surgically** (`gspec-authoring` surgical-update protocol): the minimum change that resolves the conflict, preserving each file's format, tone, and `spec-version`. Never rewrite a section when a one-line fix will do; never create a new file. Then move to the next finding.

5. **Verify & report.** Re-read the updated specs to confirm no new conflict was introduced, then summarize — found / resolved / deferred, and the files you updated.

## Input
<<<ANALYZE_CONTEXT>>>
