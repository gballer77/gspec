Review the memories your gspec agents recorded while working and commit the worthy ones to their skills — one at a time, surgically, with your approval. This is the reviewer half of the learning loop: pending memories in, improved skills out. It never changes a skill without you.

You are the **specification steward** (the `gspec-steward` skill applies). Hold the conversation and apply the approved skill edits yourself; delegate the reading-and-proposing to the `memorizer` agent.

> **Producer ≠ checker.** The `memorizer` proposes; you (with the user) approve; the edit is applied here in the main session. Agents are blocked from writing skill files directly (the skill-write guard hook) — this reviewed path is the only way a memory becomes a skill change.

## Flow

1. **Find the memories.** Look under `.gspec/memory/pending/` — one directory per agent, one `.md` file per recorded memory. If there are none, say so and stop — nothing has been learned yet. Otherwise note which agents have memories and the scope from the arguments (one agent, or all).
2. **Review.** Delegate to the `memorizer` agent with the scope. It returns impact-ordered **proposals** (each: target skill, the surgical edit, rationale, source memory file paths, confidence) plus a **"not committed"** list of noise/over-specific memories with their paths.
3. **Review one at a time** (`gspec-authoring` one-at-a-time protocol). For each proposal present: the target skill, the exact proposed edit (old→new / insertion), the source memor(ies) quoted, the rationale, and the `memorizer`'s **recommended category with its one-line reason**. Offer: **apply** / **edit then apply** / **change the category** / **reject** / **defer**. **Wait for the decision.**

   **Name all three categories every time — `project`, `personal`, `gspec` — not only the recommended one.** "Overridable default" is a stance, not something the user can act on: a default they were never shown the alternatives to is a decision made for them. This matters most for **`gspec`**, and asymmetrically so. It is the one category the `memorizer` is least likely to reach for on its own, because choosing it means indicting the system the agent is running inside — and it is the only category that changes nothing locally, so a user who is never offered it has no way to discover that reporting the defect upstream was an option at all. A memory that keeps recurring across projects is the signal; do not wait for the `memorizer` to volunteer it.
4. **Apply — to the memory store, not the skill file.** Carry the `memorizer`'s recommended category as the default, and route the approved memory by whichever category the user settled on:

   - **project** → `.gspec/memory/<skill>.md` — true of *this repository*. Committed to version control, shared with the team, and **overrides a personal memory on the same skill**.
   - **personal** → `~/.gspec/memory/<skill>.md` — *how this kind of work should be done*. Travels with the user onto every project.
   - **gspec** → `~/.gspec/memory/gspec/<slug>.md` — **the defect is in gspec itself**: a check that fires falsely, a quality bar that misses something, a flow that is wrong. A report, never composed into a skill.

   The user may override to any of the three; take the override without arguing it a second time. A `gspec` report and a `personal`/`project` memory are **complementary, not alternatives** — when the defect will keep biting until an upstream fix ships, write both.

   For **project / personal**, append a `## ` heading plus 1–3 sentences, merging over anything it supersedes, then run `gspec memory apply`. For a **gspec** report, write `title:`/`status: unsent`/`created:` frontmatter and a body free of project identity, then point the user at `gspec memory report` for a prefilled GitHub issue link — it is not filed until they click through and record it with `gspec memory filed <name> <url>`.

   Writing into `.claude/skills/**` directly is what this step used to do and is now wrong: that file is regenerated on every install, so the edit was destroyed by the next upgrade — while the delete below removed the only copy that would have survived. In the gspec source repo, edit `plugin/skills/**` instead, so the memory ships to everyone.

   Then **delete the committed pending file(s)** (they've graduated to the committed store; leaving them re-proposes them forever) and, for a rejected/"not committed" memory the user agrees is noise, delete that file too. Pending is a queue, not an archive — a memory leaves it either way. Because each memory is its own file, this is a plain delete of the paths the `memorizer` cited; nothing is edited out of a shared document. Once the committed memories are applied, clear the corresponding entries from `.gspec/agent-runs/feedback-log.md` (or the whole file if it's now stale) so the log doesn't re-surface resolved failure modes.
5. **Verify & report.** Re-read each edited skill; summarize skills changed (and the memories behind them), pending files deleted, and anything deferred, with the files touched. Note that installed skills under `.claude/skills/` may be overwritten on the next `gspec` upgrade — durable promotion belongs in the gspec source skills.

## Input
<<<MEMORIZE_CONTEXT>>>
