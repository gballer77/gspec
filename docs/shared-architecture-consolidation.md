# Shared Architecture Elements — Consolidation Plan

- **Status:** **Proposed.** Nothing here is built.
- **Date:** 2026-08-04
- **Context:** Found during autonomous dogfood build #3 (`sandbox/groundwork`, a teaching
  website, `--scope small`, 5 features). Every measurement below is from that run or from
  build #2 (`sandbox/orbital-decay`, a canvas game, 8 features), both on gspec v3.0.0.
- **Supersedes nothing.** Extends the v3 feature-folder layout described in
  [`gspec-v3-design.md`](./gspec-v3-design.md); the two-tier architecture split from
  [`per-deployable-architecture.md`](./per-deployable-architecture.md) is unchanged.

---

## The problem, in one run

v3 shares architecture between features through **anchors**: exactly one `defined-in:`
origin per anchor, and every later feature writes an `amends:` delta. A deterministic floor
(`originAnchors` / `archLintViolations` in `plugin/hooks/floors/plan-lint.mjs`) enforces
one origin per anchor name across the whole tree.

It works when writers use it, and build #3 shows both outcomes side by side:

| anchor | outcome |
|---|---|
| `Rule: Accessibility Baseline` | 1 origin + 1 `amends:` — **shared correctly** |
| `Rule: … Progressive Enhancement Contract` | **5 origins**, five different names |

The five:

| feature | anchor name |
|---|---|
| curriculum-index (written first) | `Rule: Progressive Enhancement Contract` |
| glossary | `Rule: Glossary Progressive Enhancement Contract` |
| lesson-reading-experience | `Rule: Shell Progressive Enhancement Contract` |
| practice-exercises | `Rule: Exercise Progressive Enhancement Contract` |
| specification-annotator | `Rule: Annotator Progressive Enhancement Contract` |

The first writer minted the canonical, unprefixed name. Every later writer **prefixed it with
its own feature name** instead of amending. All five are `defined-in:` origins, and the floor
reported clean — it compares anchor *names*, not meanings.

Three root causes, each independently fixable:

1. **The grammar is asymmetric.** `ANCHOR_GRAMMAR` (plan-lint.mjs:21) constrains
   `Data: /^### Entity: [A-Z][A-Za-z0-9]*$/` — one PascalCase token, so an Entity
   *cannot* be qualified. `Logic` and `UI` accept `\S.*`, any prose, so prefixing a Rule or
   Component name is free. The v3 changelog records `### Entity: SimEvent (wave variants)`
   being rejected and forced back to canonical; the identical evasion on a `Rule:` sails through.

2. **There is nowhere for a cross-cutting rule to live.** `gspec/architecture.md` mints
   **zero** anchors (verified: 0 matches for `^### (Entity|Endpoint|Screen|Component|Rule|Machine):`).
   It *states* the invariants as prose — build #3's Overview says *"Two invariants govern every
   decision below: 1. Server-rendered markup is the content. 2. Nothing crosses the network at
   runtime."* — but prose cannot be amended. A feature that wants to reference it has no
   anchor to point at, so it originates its own.

3. **Serialization does not prevent it.** The feature-arch stage runs
   `FEATURE_ARCH_CONCURRENCY = 1` (lib/build.js:155) specifically so writers can see prior
   anchors. The fifth writer ran last, with full sight of four predecessors, and still minted a
   fifth synonym.

### A second, distinct problem: the amend graph fragments

Reading an anchor's current state means reading its origin plus every delta:

| files to read | build #3 (5 features) | build #2 (8 features) |
|---|---:|---:|
| 1 | 43 | 97 |
| 2 | 3 | 4 |
| 3 | 1 | 3 |
| 4 | — | 2 |
| **6** | — | **1** |

`Entity: TunableConstants` spans **six files** at eight features. ~90% of anchors are
single-file, but the ones that fragment are the shared vocabulary — exactly what you most
need to reason about.

### A third: implementers read deltas without their base

`scopeReadList` (lib/build.js:1827) gives an implementer scope its own feature folder plus
`gspec/architecture.md`, `gspec/practices.md`, and `gspec/architecture/<module>.md` — and
tells it *"Your specs for this scope are exactly these — do not read other specs."*
**Sibling feature folders are excluded.**

So the implementer of `practice-exercises` reads:

```
### Screen: Lesson
- **amends:** gspec/features/lesson-reading-experience/arch.md
#### Added … #### Changed …
```

— a diff against a base it is forbidden to read. This is likely why each amending feature
redraws the *whole* screen in its `design.html`: three features render
`<section id="screen-lesson">`, **119 KB of the 188 KB** of designs, with **35–45% line
overlap**. That redraw may be compensation, not waste (see item 5).

---

## The plan

Six items. 1 and 2 are independent and safe to build immediately. 3 is the keystone.
4, 5 and 6 depend on it.

### 1. Near-duplicate anchor lint — *prototyped and verified*

Stops synonyms being minted. An anchor of the same kind whose name contains another
anchor's name **as a full token subsequence** should have amended it.

Prototype result on build #3: **47 origins scanned → 4 flagged, 0 false positives**, and it
names the correct amend target (curriculum-index's unprefixed origin) every time.

| file | change |
|---|---|
| `plugin/hooks/floors/plan-lint.mjs` | new `nearDuplicateAnchors(rel, text, others)`; call it from `archLintViolations`, which already receives the `others` map for origin-uniqueness |
| `plugin/hooks/floors/plan-lint.test.mjs` | tests, including a genuine non-duplicate that nests names |
| `plugin/agents/feature-architect.md` | writer rule: before originating, grep for an anchor whose name is a *subsequence* of yours — extends the existing rename-inherits-origin rule |
| `website/src/pages/releases.astro` | changelog entry |

**Warn, never block.** Containment is suggestive, not proof (`Exercise Grading` vs `Grading`
could be genuinely distinct). The repo's own precedent: a false positive in a blocking
deterministic check *"FAILED A BUILD on a file that was perfectly correct… worse than not
checking at all"* (plan-lint.mjs, `designLintViolations` comment).

It runs at feature-arch, where lint findings are already repaired for free with no validator run.

**Limit:** catches containment only. A true synonym with no shared tokens
(`Client-Side Enhancement Contract` vs `Progressive Enhancement Contract`) still slips
through — that needs a validator's judgment, not a floor.

### 2. Extract the Modules table to a structured artifact

| file | change |
|---|---|
| `gspec/modules.json` | **NEW** — `name` / `dir` / `build` / `test` per module |
| `lib/build.js` | the implement prompt (lib/build.js:2455) stops saying *"generate/maintain verify.sh from the architecture Modules table"*; generation reads the artifact |
| `plugin/agents/architecture-writer.md`, `plugin/skills/personas/gspec-architect.md` | the Modules & Verification section emits the artifact |

**Why:** build #3's scaffold generated a `verify.sh` whose header reads
*"Verification entry point for every module in gspec/architecture.md § Modules & Verification"*.
It is **parsing prose out of a spec**, and it worked only because the table was regular.
This is also the last thing tying implementation to the system tier.

### 3. Shared anchors move to `gspec/architecture/<module>.common.md` — *keystone*

**A new file per module**, holding only anchors referenced by ≥N features. Membership is
**derived from the anchor graph, not chosen by a writer**, so the file cannot become a junk
drawer. Per-module, so growth is bounded by module size rather than project size.

**Sizing** (anchors referenced by ≥2 features, measured):

| build | shared anchors | file size |
|---|---:|---:|
| #3 (5 features) | 4 | ~1,950 tokens |
| #2 (8 features) | 10 | ~5,640 tokens |

Comparable to `practices.md` (2,877) and `architecture.md` (2,520), both already in every
implementer scope. Cost ≈ **+3.6% input** on a run like #2 (5,640 × ~46 turns × 34 implementer
sessions ≈ 8.8M of 244M) — partly offset because features that hosted an origin get smaller,
and plausibly self-funding, since an implementer working from a delta without its base is a
correctness risk and correctness failures cost revisions.

**Solves all three problems at once:** one home (no copies, so no cross-spec sync problem at
all), a consolidated place to reason about shared vocabulary, and the delta-without-base gap.

| file | change |
|---|---|
| `gspec/architecture/<module>.common.md` | **NEW** |
| `plugin/hooks/floors/paths.mjs` | `isModuleArch` / `moduleName` must **exclude** the new pattern; add `isSharedArch(rel)` and `sharedModuleName(rel)` |
| `lib/build.js` — `budgetLabel` | new branch **before** the `architecture/<name>.md` branch |
| `lib/build.js` — `SPEC_BUDGETS` | new entry `architecture/<name>.common.md` ≈ 2,500 |
| `lib/build.js` — `scopeReadList` | add the file to implementer scopes (today it adds only `architecture/<module>.md`) |
| `lib/build.js` | promotion step after feature-arch: compute the ≥N set, move origin blocks in |
| `plugin/skills/personas/gspec-architect.md` | describe the file and its derived membership |
| `website/src/pages/releases.astro` | changelog entry |

#### Gotchas verified against the current code

A file at `gspec/architecture/site.common.md` **today**:

| predicate | result | consequence |
|---|---|---|
| `isGuardedSpec` | `true` | ✅ identity ban enforced for free — see below |
| `isModuleArch` | `true` | treated as a module-tier file |
| `moduleName` | `"site.common"` | ❌ wrong, should be `site` |
| `budgetLabel` | `architecture/<name>.md` | ❌ inherits **360 words** at small scope (600 × 0.6) |

Without the `paths.mjs` and `budgetLabel` changes the file is silently measured against the
module tier's tight budget and reported as wildly over.

**Agnosticism boundary.** Feature `arch.md` is *enriched* (`isEnrichedDoc` — product identity
allowed by design); the module tier is *guarded* (identity forbidden). Promotion moves blocks
across that boundary, so promoted content must be identity-free. Sampled in build #3:
`Screen: Lesson`, `Component: SpecExcerpt` and `Rule: Accessibility Baseline` contain
**0 mentions** of the product name — so this is enforceable rather than blocking, and
`isGuardedSpec` already returns `true` for the new path, meaning the existing floor enforces
it with no change.

#### Why a separate file rather than folding into `architecture/<name>.md`

1. **It does not reopen the section ceiling.** `plugin/agents/architecture-writer.md` states
   the required-section list is a **ceiling**, and build #3 validated it (0 invented sections,
   0 directory-tree lines, versus 2 invented sections and a 31-line tree in build #2). Putting
   anchors in the module tier would require widening it.
2. **It does not mix lifecycles.** The module tier is stable; a shared-anchor file changes
   whenever any feature promotes something. `architecture-writer.md`'s own rule:
   *"the stable file must not be the most-edited one."*
3. **It does not distort budgets.** 600 words is correct for the module tier's job;
   shared anchors need ~2,500.
4. **It keeps derived and authored apart.** Membership here is computed; the module tier is
   authored. One file holding both muddies "this is generated, do not hand-edit."

### 4. Parallelize feature architecture — *depends on 3*

`lib/build.js`: `FEATURE_ARCH_CONCURRENCY` **1 → 5** (matching `FEATURE_WRITER_CONCURRENCY`),
and rewrite the rationale comment at lib/build.js:148.

**Evidence:** build #3's serial feature-arch took **2h 39m**; the parallel feature-design stage
took **13m 14s** for the same five features (designs landed within 41 seconds of each other;
architectures were spread over hours). *And serialization did not prevent the duplication
anyway.*

The race it prevents — two writers both minting `### Entity: User` — produces **duplicate
origins, which the floor already catches**. The existing comment concedes this: it is
*"a blocker finding after the fact."* So serialization buys avoided rework, not correctness.
This item trades it for planned rework, done once in item 3's promotion step.

Re-validating all five feature architectures afterwards costs **$0.23** —
`feature-architecture-validator` is the cheapest agent in the system at 3.0 turns/run
(5 runs, 15 turns, build #3).

### 5. `design.html` delta rendering — *depends on 3, re-measure first*

`designLintViolations` (plan-lint.mjs:164-167) builds its `declared` list from heading text
alone and cannot tell an origin from an amendment, so a feature that only *amends* a screen
must still render the whole thing.

**Do not act on this before item 3 lands.** The hypothesis is that the redraw compensates for
the implementer being unable to see the base; remove it first and you delete the compensation
while the gap still exists. After item 3, re-measure whether implementers use the redrawn
screen at all.

### 6. Spec↔spec consistency inside the build

`gspec-analyze` exists ("reconcile conflicts between documents") but is **not a build stage** —
the run is profile → research → stack → practices → style → features → architecture →
feature-arch → feature-design → plan → review → implement → audit. The reconcile audit
(`codebase-inspector`) checks spec↔**code** drift, not spec↔spec. Once anchors move between
files, this belongs in the build.

---

## Sequencing

```
1 (lint) ──┐
2 (modules)┴─→ 3 (shared file) ─→ 4 (parallelize)
                              ├─→ 5 (design deltas)
                              └─→ 6 (consistency stage)
```

1 and 2 are independent and safe now. 3 is the keystone. 4, 5, 6 all depend on it.

## Open decisions

- **N** in "referenced by ≥N features" — 2 or 3. Build #2 at N=2 gives 10 anchors; N=3 gives 6.
- **Do amendments move too, or stay in features?** Promotion moves the *origin*. If deltas stay,
  a human still reads six files for `TunableConstants`' full current state. Moving them too
  fully solves the fragmentation but costs feature locality.
- **Scaling.** At 50 features a fixed N blows any budget. Two levers: raise N as the project
  grows, or rely on per-module scoping to bound it. The latter is another argument for this
  being a module-scoped file.
- **Naming.** `<module>.common.md` vs `<module>.lib.md`. Recommendation: `.common.md` —
  "lib" reads as code library, "common" states the membership rule.

## Related but out of scope

`features/<slug>/arch.md` is **74.8% prose**, of which ~22% of the whole file is defence of
rejected alternatives (~1,250 tokens per feature). Normative payload — code, tables, status
lines — is 23.4%. Proposal: move rationale to a `## Decisions` section outside the implementer
read list, add a writer density rule and a lint. **Budget stays 3,000**; an earlier attempt to
raise it to 5,000 was reverted, because that measured the symptom rather than the cause.

Cross-feature duplication is *not* the cause of arch.md size — verbatim overlap between feature
`arch.md` files is only **1.2–4.5%**.

## Evidence index

All figures reproducible from `sandbox/groundwork` and `sandbox/orbital-decay`:

- anchor counts, origins vs amends, duplicate origins — parse `^#{2,4} (Entity|Endpoint|Screen|Component|Rule|Machine):` plus the following status line (`- **amends:**` / `- **defined-in:**`; **match through emphasis**, or every delta reads as a fresh origin)
- stage wall-clock — `sandbox/driver3.log` and file mtimes under `gspec/features/*/`
- per-agent turns, runs, input and cost, split initial vs revision — `.gspec/build/run.json` → `usage` → `byKind`
- context composition — engine transcripts under `~/.claude/projects/<slugified-cwd>/*.jsonl`; note extended-thinking text is **not** recorded (`thinking: ""` with only a signature), so ~39% of implementer input is unattributable from disk
