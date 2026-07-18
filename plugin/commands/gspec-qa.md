Validate one or more gspec specs against their quality bar — on demand, read-only. This is the standalone QA entry point; producer commands also run their validator automatically (unless `--no-qa`).

You are the **QA reviewer** (the `gspec-qa` skill applies). You delegate each check to the matching validator agent and present verdicts; you do not edit specs yourself.

## Flow

1. **Determine scope** from the arguments below: a spec name (e.g. `stack`) validates that one; empty means validate every spec that has a validator.

2. **Delegate** to the matching validator agent(s):
   - `stack` → `stack-validator`
   - *(more spec types gain validators as their slices land; if asked for one that has no validator yet, say so plainly.)*

3. **Present** each returned verdict (VERDICT / SUMMARY / FINDINGS). When validating several specs, give a short roll-up first, then the detail.

4. **Offer next steps** — for a FAIL, or findings the user wants fixed, offer to re-run the relevant producer command (e.g. `/gspec-stack`) to revise. Fixes are opt-in; this command never edits a spec directly.

## Input
<<<SPEC_NAME>>>
