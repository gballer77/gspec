# Per-Deployable Sub-Architecture Files — Proposal

- **Status:** Idea captured for later. **Not scheduled, not started.**
- **Date:** 2026-07-21
- **Context:** Discussion about whether each deployable should get its own architecture file, similar to the top-level `gspec/architecture.md`.

---

## The idea

Today the architect authors a single `gspec/architecture.md` that includes a **Deployables & Verification** table (`name · dir · build · test`, one row per toolchain). The proposal is to give each deployable its own sub-architecture file, mirroring the top-level document, so a polyglot / multi-deployable system can describe each unit's internal structure in its own focused spec.

## The core constraint: not everything can move down

You cannot simply shard `architecture.md` into N per-deployable files. Some of what it holds is inherently **cross-deployable** and belongs to no single unit:

- the **shared data model** (entities multiple units speak to)
- the **contracts between deployables** (an API surface is exactly the boundary *between* two units)
- the **auth flow** spanning e.g. frontend → backend
- the **deployables table itself**, which is the index of all units

So the right shape is a **two-tier model**, not "top file → sub-files":

- **`architecture.md` (system tier):** system context, inter-deployable contracts, shared data model, cross-cutting auth, and the deployables index table.
- **per-deployable files (component tier):** internal project structure, internal components, deployable-local data/entities, and that unit's slice of the API it *owns*.

This maps cleanly onto the **C4 model** — container level up top, component level per container. That analogy is the guide for what goes in which tier.

## When it pays off vs. when it's ceremony

Gate on the deployables table:

- **Single-deployable (one row — likely the common case):** a second file layer is pure overhead. Keep one file.
- **Polyglot / multi-deployable (e.g. TS frontend + Java backend, or microservices):** the split genuinely helps — the implementer works one deployable at a time and loads a focused sub-arch instead of the whole system.

Proposed rule: **1 row → single `architecture.md`; >1 row → system file + `architecture/<name>.md` per deployable**, with each table row pointing at its sub-arch file. `<name>` reuses the deployable name that already keys `FAIL: <deployable>:<phase>` in `verify.sh`.

## Blast radius (what a real implementation would touch)

- **`gspec-architect` persona** — required sections + quality bar would need a system-tier vs component-tier definition.
- **`architecture-writer` / `architecture-validator` agents** — write and QA multiple files; validator must police the tier boundary (no cross-cutting concern buried in a sub-file; no duplication/drift between tiers).
- **`implementer` + `verify.sh`** — the table stays the authority for `verify.sh`, so generation is **unaffected**. (Good.)
- **`spec-cross-referencer` + audit** — adds a feature × deployable traceability axis and a new drift surface (top vs sub tier).

## Chief risk

Drift between the two tiers. Gspec's ethos is "resolve ambiguity, leave the implementer no decisions"; more files means more places for the tiers to disagree. The validator has to actively enforce the boundary or that guarantee erodes.

## Recommendation

Do it as a **conditional two-tier model gated on the deployables table**, not an unconditional per-deployable split. Keep `architecture.md` as the always-present system spec + index; spawn `architecture/<name>.md` only when there is more than one deployable.

## Open questions before committing

- What project scale is actually targeted — mostly single apps, or real polyglot/microservice systems?
- Sub-files always-on for consistency, or gated as above?
- Exact directory/naming: `architecture/<name>.md` vs `deployables/<name>.md`.
