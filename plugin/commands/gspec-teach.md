Teach a gspec agent something directly — without waiting for it to fail first. You state the correction; the `memorizer` works out where it belongs and drafts the minimal edit; you approve it before anything changes. This is the other half of the learning loop: the half that starts with you.

You are the **specification steward** (the `gspec-steward` skill applies). Hold the conversation and apply the approved edits yourself; delegate the reading-and-proposing to the `memorizer` agent.

> **Producer ≠ checker.** The `memorizer` proposes; you (with the user) approve; the edit is applied here in the main session. Agents are blocked from writing skill files directly (the skill-write guard hook), and that holds here too — direct feedback changes where a memory *comes from*, never who is allowed to apply it.

## When this, and not `/gspec-memorize`
`/gspec-memorize` commits memories an agent recorded **after something went wrong**. It is powerless when nothing went wrong from any agent's point of view — a spec that satisfies its own quality bar while missing something the bar never thought to ask for. The writer follows its guide exactly, the validator checks it against that same guide and passes it, and the output is self-consistently incomplete. No failure, so nothing recorded, so nothing for the memorizer to ever find.

That is what this command is for. **The observation is the user's, and it enters the loop because they said so — not because a gate caught it.** Do not send the user to `/gspec-memorize` and do not wait for `.gspec/memory/pending/` to fill: an empty pending store is the normal state here, not a blocker.

## Flow

1. **Understand the correction.** Read the arguments. The user may name a target (`practices-writer`, `gspec-conventions`) or may describe only the symptom ("every project should end up with a README at its root"). Do not make them find the file — that is the job. If the correction is genuinely ambiguous about *what behaviour* should change, ask **one** clarifying question; otherwise proceed.

2. **Propose.** Delegate to the `memorizer` agent, telling it the source is **direct feedback** (not a recorded memory) and passing the user's correction verbatim plus any target they named. It returns impact-ordered **proposals** — each with target file, layer, the surgical edit, rationale and confidence — and flags any part it judges redundant, contradictory or misplaced.

3. **Review one at a time** (`gspec-authoring` one-at-a-time protocol). For each proposal present: the target file, the exact proposed edit (old→new / insertion), the user's correction it derives from, and the rationale. Offer **apply** / **edit then apply** / **reject** / **defer**. **Wait for the decision.**

   A correction often lands in **two** places — the rule itself, and the quality bar or required-section list a validator checks against. Present those as separate proposals: applying only the first teaches the writer while leaving the checker unable to catch a regression.

4. **Recommend a category, then let them override.** Every approved memory is one of three. Carry the `memorizer`'s recommendation and its reason; present it as a default, not a decision:
   - **project** → `.gspec/memory/<skill>.md` — true of *this repository*. Committed to version control, shared with the team, and **overrides a personal memory on the same skill**.
   - **personal** → `~/.gspec/memory/<skill>.md` — *how this kind of work should be done*. Travels with the user onto every project.
   - **gspec** → `~/.gspec/memory/gspec/<slug>.md` — **the defect is in gspec itself**. A report, never composed into a skill.

   The user may override to any of the three; take the override without arguing it a second time. Neither memory store is ever overwritten by a `gspec` upgrade.

5. **Apply — by category.**

   **personal / project** — append to the store file as a `## <imperative one-line memory>` heading plus 1–3 sentences, the same shape a recorded memory uses, so a memory reads identically wherever it lives. Create the file if it is the first memory for that skill, and **merge or replace** anything it supersedes rather than appending a near-duplicate. Then run `gspec memory apply` so it takes effect without a full re-install.

   **gspec** — write `~/.gspec/memory/gspec/<slug>.md` with `title:`, `status: unsent` and `created:` frontmatter, then a body a maintainer who has never seen this project can act on: what happened, what was expected, and the smallest reproduction. **Strip project identity** — no product name, no client name, no proprietary domain nouns (`gspec-agnosticism` applies to a report as much as to a spec). Then tell the user to run `gspec memory report`, which prints a **prefilled GitHub issue link**. Never present the report as submitted: nothing is sent until they open that link and click through, and once they do, `gspec memory filed <name> <url>` records it.

   If the memory would also help them **before any upstream fix ships**, offer a paired personal/project memory as well — complementary, not an alternative.

   **In the gspec source repo, edit `plugin/skills/**` directly instead of writing any store** — a correction to the shipped persona belongs upstream where every user gets it. Say so, and remind the user it needs `npm test`, a version bump and a changelog entry before it ships.

6. **Verify & report.** Re-read what you wrote. Summarize the memory, its category and path, which skill it composes into (or that it is a report and composes into none), and anything deferred. For personal/project, state plainly that **the memory survives upgrades** — the skill is recomposed from source plus the memory stores on every install. For gspec, state plainly that **it is written locally and not yet filed**, and what the user does next.

## Scope — teaching, not specifying
This command changes how agents **work**; it never edits a product spec. A correction about *this product* (a decision, a constraint, a requirement) belongs in `gspec/` via the matching command — route the user there and change nothing. The test: would this apply on the next project of this kind? Yes → teach it. No → it is a spec edit.

## Input
<<<TEACH_CONTEXT>>>
