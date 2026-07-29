# gspec v3 — design system, thin architecture, enriched feature folders

- **Status:** **Implemented** across v3.0.0 – v3.3.1. Every section below shipped; two decisions were reversed during implementation and are marked in place (the module tier stayed at `gspec/architecture/<name>.md` rather than co-locating; the `gspec/design/` floor exclusion was kept). The per-release user-facing record is `website/src/pages/releases.astro`.
- **Date:** 2026-07-28
- **Supersedes:** `docs/per-deployable-architecture.md` (the shipped two-tier layout) and the analysis on `origin/feature/architecture-file-set-analysis` (`docs/architecture-file-set.md`), whose open questions are answered by the Decisions table below.
- **Scope:** five shipped releases — v3.0.0, v3.1.0, v3.2.0, v3.2.1, v3.3.0 (plus v3.3.1, a fix found by dogfooding the migration).

---

## Context

gspec's three "middle" specs each do a job they're the wrong shape for:

- **`style.md`/`style.html`** mixes a design system (tokens) with concrete component styling, so it grows with the product and duplicates decisions that belong to individual screens.
- **`architecture.md`** is asked to be both the high-level system picture *and* the place every entity field, endpoint signature, and algorithm lands. It grows without bound; the shipped two-tier per-deployable split only helped multi-deployable projects, and only for a while.
- **`tasks/<slug>.md`** is a bare task list. Every downstream agent that reads it must also load the profile, stack, style, architecture, and the PRD to have enough context to act.

v3 re-cuts the boundary along **stable vs. growing**:

- **Style becomes a pure design system** — palette, type scale, spacing, radius, elevation, themes, icons, accessibility target. The vector for implementation, never the concrete elements.
- **Architecture becomes thin and high-level, two-tier at the top level** — `gspec/architecture.md` for the system, `gspec/architecture/<name>.md` for each module's identity, boundary, owned directories, and file-placement rules (the shipped two-tier layout, kept). No algorithms, no field lists, no endpoint inventories. It stops growing.
- **Each feature becomes a folder** — `gspec/features/<slug>/` holds the PRD (`prd.md`, relocated from `features/<slug>.md`) beside the feature's own `arch.md` (data, API, UI, and logic as sections), a **renderable `design.html`** that *is* the mockup, and `tasks.md`. Everything about a feature lives in one place. The PRD stays spec-agnostic; **its three siblings are the opposite** — deliberately enriched and denormalized so an implementer reading only this folder needs nothing else.

The design deliverable is HTML, not Markdown, for the same reason `style.html` is: a design you can *open in a browser* is checkable by a human in seconds and cannot quietly disagree with the tokens it claims to use. It also makes the token rule mechanically enforceable — an HTML token block is separable from prose in a way a Markdown table never was.

Intended outcome: the always-load context set stays near-constant as a project ages, and all growth lands in per-feature folders that close when the feature ships.

## Decisions

These are settled; the rest of this document is mechanism.

| | |
|---|---|
| Detail home | **Feature folders are durable** — the permanent canonical home of a feature's architecture detail. Module architecture stays thin forever. |
| Arch layout | **Top-level two-tier** (the shipped layout, kept): table row `\| web \| apps/web \| … \|` → `gspec/architecture/web.md`, keyed by module *name*. Single-module: no sub-files — the root carries both tiers. **This reverses an earlier co-location choice** (`<dir>/gspec/architecture.md`), deliberately: once feature folders became the durable home of module detail, extracting a module no longer takes its real architecture anyway — the fractal-extraction argument died, and co-location's costs (spec-integrity prefix rewrite, Codex stop-gate blindness, table-driven discovery, `dir: .` collision rules, false positives outside `gspec/`) were being paid for nothing. Every spec lives under `gspec/`: one tree, one prefix. |
| Feature folder | `gspec/features/<slug>/` with exactly four files — `prd.md`, `arch.md`, `design.html`, `tasks.md` — split along the boundaries that are *forced* (the agnosticism boundary; file format; the immutability hook's target), never along concerns. **Four writer/validator pairs**, one file each: `feature-writer`→`prd.md`, `feature-architect`→`arch.md`, `feature-designer`→`design.html`, `plan-decomposer`→`tasks.md`. No parallel `plans/` root — the slug appears once in the tree. |
| Style scope | **Tokens only.** HTML strongly preferred. No component specimens — concrete visuals live in each feature's `design.html`. |
| Migration | **Mechanical only** — moves, renames, version stamp; then warn and tell the user to re-run `/gspec-architect` + `/gspec-plan`. No agent-driven content splitting. |
| `gspec/design/` | **Retired from the flow.** The mockup *is* `design.html` — self-contained, so any imagery is a `data:` URI inside it. No asset folder is ever written. The floors keep their `gspec/design/` *exclusion* though (see v3.2 §8): removing it would start nagging mockups an existing project already has for a `spec-version` they never carried. |
| Rollout | **Four releases**: v3.0.0 rename + spec-version `v2`; v3.1.0 thin two-tier architecture; v3.2.0 feature folders + tokens-only style + deterministic-first gates; v3.3.0 recommended model tiering at install. |

### Why `arch.md` is one file, not four

An earlier draft split the architecture detail four ways (`data.md`/`api.md`/`ui.md`/`logic.md`), carried over from the per-module inventory design in `docs/architecture-file-set.md`. That rationale does not transfer. **The inventory split solves unbounded growth; a per-feature folder is bounded by the feature's own size, so it never has that problem.**

The hoped-for win — an implementer loading only `ui.md` for a UI task — does not materialize either. The implementer's unit of work is a *scope*, not a task: `build-orchestrator` emits scopes carrying plan files, and `runImplementScope` works through every unchecked task in them. A feature slice crosses concerns by construction (T1 schema → T2 API → T3 UI, chained by `deps:`), so one run needs all of them. Scoping by concern instead would make the waves strictly sequential and pay a fresh agent plus a re-read at every boundary — worse on both axes. This is the finding already recorded in `docs/architecture-file-set.md`: *"Implementer scopes are feature-shaped, not concern-shaped."*

Partial loading is still real, but it comes from **anchors, not file boundaries** — `## Entity: Order` is greppable and section-loadable wherever it lives. And "this feature is headless" saves the same tokens as a `Not Applicable` section as it does as an absent file.

Since `feature-architect` writes all four either way, collapsing them costs nothing at write time and *deletes* machinery: no `{wrote, skipped}` manifest, no `required`/`anyOf` delivery variant, no multi-file digest. Each stage now owns exactly one file per feature, so the existing `outputsPresent`/`hashFile`/`memoize` primitives work unchanged.

Accepted cost: a very large feature makes `arch.md` fat. gspec already treats that as a decomposition signal — *"a feature that can't be specified within its budget is more than one feature"* — and leaning on the existing signal beats hiding the size behind file boundaries.

### Known tradeoff of "durable feature folders"

Because module architecture never grows, there is no single file that answers *"what does the `User` entity look like today?"* — the answer is the origin definition in one feature folder plus any deltas in later ones. This is accepted deliberately: it is what keeps the always-load set constant. The cost is paid by the **anchor origin/delta discipline** (v3.2 §5), which makes reconstructing current state a single `grep` rather than a search. If that discipline erodes, this decision stops being viable — treat it as load-bearing, not stylistic.

## Target layout

```
gspec/
  profile.md  stack.md  practices.md  research.md
  style.html                      # tokens ONLY
  architecture.md                 # system tier: overview, module boundaries,
                                  #   shared model (names only), inter-module
                                  #   contracts, cross-cutting auth,
                                  #   Modules & Verification, Gap Analysis
                                  # (single-module: also carries the module tier)
  architecture/                   # module tier — one file per Modules row, keyed by
    web.md                        #   the row NAME (multi-module only); thin, ~1 page,
    api.md                        #   stable: identity, boundary, owned dirs, placement
  features/<slug>/                # ONE folder per feature — the slug appears once
    prd.md                               # the PRD — spec-agnostic, guarded, format unchanged
    arch.md                              # ENRICHED, durable: ## Data / ## API / ## UI / ## Logic
                                         #   (inapplicable ones marked Not Applicable)
    design.html                          # renderable mockup; only when the feature has UI
    tasks.md                             # unchanged grammar
```

---

## Release v3.0.0 — rename + spec-version `v2` + migrate skeleton

Mechanical and self-contained. It touches the same files v3.1/v3.2 touch, so it goes first to avoid editing everything twice.

### 1. `deployable` → `module`

~105 occurrences across ~19 files. Contract strings that change:

- **Deployables & Verification** section → **Modules & Verification**
- `FAIL: <deployable>:<phase>` → `FAIL: <module>:<phase>` in `verify.sh` (existing scripts keep working — the key is just a name)
- sub-file frontmatter `deployable:` → `module:`
- the audit's `deployable` drift category → `module`

The rename is justified on accuracy, not taste: the table's definition has always been "independently build/test-able unit" — deployment was never the criterion (a shared library row builds and tests but deploys nowhere). "Module" matches both the verification role and the new architecture-folder role.

Primary files: `plugin/skills/personas/gspec-architect.md` (:51, :57-77), `gspec-engineer.md` (:34-38), `plugin/agents/{architecture-writer,architecture-validator,implementer,implementation-validator,build-orchestrator,codebase-inspector}.md`, `lib/build.js`, `scripts/manifest.js`, `README.md`, `docs/`.

### 2. Single-source `SPEC_VERSION`, then flip `v1` → `v2`

Four copies exist today with nothing asserting they agree: `bin/gspec.js:17`, `scripts/build.js:19`, `plugin/hooks/floors/spec-integrity.mjs:9`, prose in `templates/preamble.md:59`.

- New `lib/spec-version.js` exports the constant; `bin/gspec.js` and `scripts/build.js` import it.
- The floor **cannot** import it (it is copied standalone into `.claude/hooks/floors/`), so it stays a literal copy.
- New `test/spec-version.test.mjs` asserts all four agree, including a grep of `templates/preamble.md`.
- Land this **before** the flip.

### 3. `budgetLabel` — identity-preserving refactor

Split classification out of lookup in `lib/build.js`, keying `SPEC_BUDGETS` by the **conventions-table label** rather than by path:

```js
export function budgetLabel(rel) {
  const r = norm(rel);
  if (/^gspec\/architecture\/[^/]+\.md$/.test(r)) return 'architecture/<name>.md'; // v3.1
  const f = r.match(/^gspec\/features\/[^/]+\/([^/]+\.(?:md|html))$/);   // v3.2: the feature
  if (f) return `features/<slug>/${f[1]}`;                               //   folder, incl. prd.md
  if (r.startsWith('gspec/features/') && r.endsWith('.md')) return 'features/<slug>.md'; // flat PRD — legacy after v3.2
  if (r.startsWith('gspec/') && !r.slice(6).includes('/')) return r.slice(6);
  return null;
}
export function budgetFor(rel, scope = DEFAULT_SCOPE) {
  const base = SPEC_BUDGETS[budgetLabel(rel)];
  return base ? Math.round(base * (SCOPE_FACTOR[scope] ?? 1)) : null;
}
```

This makes `test/build-budgets.test.mjs` an identity comparison — delete the `expected.feature` → `expected['features/<slug>.md']` remap at `:44-46`. All existing assertions pass unchanged. In v3.2 the flat-PRD branch's label row is renamed to `features/<slug>/prd.md` (same 1,800 budget) and the flat branch itself is kept only for the migration window.

### 4. `/gspec-migrate` — frontmatter + version only

Rename `deployable:` → `module:` in existing `gspec/architecture/*.md`, stamp `spec-version: v2`. **No relocation** — architecture files never move in v3; the only relocations (tasks and flat PRDs into feature folders) land in v3.2 (see hazard H1).

### 5. Docs

Version bump in `package.json` + `package-lock.json`, changelog entry in `website/src/pages/releases.astro`, README rename sweep, `docs/gspec-v2-design.md` roster/contract updates.

---

## Release v3.1.0 — thin, top-level two-tier architecture

The file layout is the **shipped** two-tier layout, unchanged: `gspec/architecture.md` + `gspec/architecture/<name>.md` per Modules row, keyed by row name. v3.1 changes what the tiers *contain* (thin), not where they live. (An earlier draft co-located module specs at `<dir>/gspec/architecture.md`; see the Decisions table for why that was reversed — the reversal deletes a spec-integrity rewrite, a Codex stop-gate walker, table-driven discovery with a fallback walk, the `dir: .` collision rule, and two hazards.)

### 1. Two new pure floor modules

Today every floor re-derives "is this a gspec spec?" with its own regex, and they disagree — which is why `gspec/architecture/<name>.md` is spec-integrity-checked but *not* agnosticism-guarded (a basename accident at `plugin/hooks/floors/agnosticism.mjs:19`, not a decision). One vocabulary fixes that.

**`plugin/hooks/floors/paths.mjs`** (new, pure):

```js
export function norm(rel)
export const ROOT_SPECS = new Set(['profile.md','stack.md','practices.md',
                                   'architecture.md','style.md','style.html','research.md'])
export function isRootSpec(rel)
export function isFeaturePrd(rel)       // gspec/features/<slug>/prd.md — the agnostic file
                                        //   (plus flat gspec/features/*.md through the
                                        //    migration window)
export function isModuleArch(rel)       // gspec/architecture/<name>.md — the module tier
export function isEnrichedDoc(rel)      // gspec/features/<slug>/<arch.md|design.html|tasks.md>
                                        //   — a closed basename set; prd.md is NOT in it
export function isFeatureDesign(rel)    // gspec/features/<slug>/design.html — token rules apply
export function isFeatureTasks(rel)     // gspec/features/<slug>/tasks.md — the hard-block target
export function featureSlug(rel)
export function isGspecSpec(rel)        // the union — v3 has no excluded-asset category
```

Ship this in v3.1 **with the v3.2 feature-folder predicates already written but unused** — v3.2 then only rewires call sites.

**`plugin/hooks/floors/modules.mjs`** (new, pure — takes *text*, caller does I/O):

```js
export function parseModulesTable(architectureMdText)  // → [{name, dir, build, test}]
export function moduleSpecPaths(modules)               // 1 row  → [] (root carries both tiers)
                                                       // >1 row → ['gspec/architecture/<name>.md', …]
```

### 2. Discovery stays trivial

Because every spec stays under `gspec/`, the two jobs that co-location would have split apart stay one job:

- **Predicate** ("is this path a spec?"): `spec-integrity.mjs`'s existing `gspec/` prefix is already correct — untouched. `agnosticism.mjs` replaces its basename allowlist with `paths.mjs` calls, which fixes the sub-file accident: `gspec/architecture/<name>.md` becomes guarded via `isModuleArch` instead of falling through basename luck.
- **Enumeration** ("what specs exist?"): `readdir('gspec/architecture')`. The Modules table cross-checks it — `moduleSpecPaths()` says which files *should* exist (the delivery gate, §4) and the validator/audit flag orphans in either direction. No table-driven path resolution, no fallback walk, no `.gspec/modules.json`, and the Codex stop-gate's `gspec/**` walk (`gspec-stop-gate.mjs:29-46`) already sees everything.
- `bin/gspec.js:1074` `collectGspecFiles` still needs its one real fix: it doesn't recurse into `gspec/architecture/` (or `gspec/features/` subfolders) — a pre-existing bug, one line per dir.

### 3. Thin module architecture

Rewrite `plugin/skills/personas/gspec-architect.md:57-77` **wholesale** (Layout + required sections), not incrementally.

- `gspec/architecture.md` — system tier: overview/system context, module boundaries, shared data model **at the name level** (entities and relationships, no field lists), inter-module contracts, cross-cutting auth, Modules & Verification, Technical Gap Analysis.
- `gspec/architecture/<name>.md` — module tier: identity, boundary, owned directories, internal structure + file-placement rules, module-local config. Frontmatter `spec-version` + `module:` (matching its table row) — **no `covers:` list.** A `covers:` on the module tier would grow with every feature and force a per-feature edit to the one file this design promises never changes (and by an agent that shouldn't hold write access to it). The module→features index is *derived*, not maintained: every feature folder's `arch.md` names its `module:`, so `grep -l "^module: api" gspec/features/*/arch.md` answers it with zero sync surface.
- **Single-module (one table row, or N/A)** — no sub-files; the root carries both tiers: the system sections above plus the module-tier sections, one document, no `module:` frontmatter needed. This is the shipped gate, kept: a second file for one module is pure ceremony.

**The module tier's ceiling is prohibitions, not a number.** The word budget stays advisory (the "size alone never blocks" contract is load-bearing and shouldn't gain an exception). Hardness comes from content-shape prohibitions in `architecture-validator`'s bar, each a `[major]`:

- an `### Entity:` heading or any field-list table → belongs in `gspec/features/*/arch.md` under `## Data`
- an endpoint inventory or `### Endpoint:` heading → belongs under `## API`
- pseudocode, an algorithm, or a fenced block over ~15 lines → belongs under `## Logic`
- any section outside the required list

### 4. Architecture stage delivery check

`type: 'gated'` currently uses `outputs: ['gspec/architecture.md']`. The root existing does not imply the module tier exists — the stage could report `done` with a multi-row table and zero sub-files (a gap that exists in the shipped layout *today*; v3.1 closes it). Give the stage its own predicate: *`gspec/architecture.md` exists **and** every path from `moduleSpecPaths()` exists* (trivially satisfied in the single-module case, where the list is empty).

### 5. Budgets (atomic pair — same commit, always)

`plugin/skills/conventions/gspec-conventions.md` table and `SPEC_BUDGETS` in `lib/build.js` must change together or `test/build-budgets.test.mjs` goes red.

| label | budget |
|---|---|
| `architecture.md` | 2,100 (was 3,000) — system tier 1,500 + module tier 600, since single-module carries both in this file. `budgetFor` is pure and can't count modules; a multi-module system tier simply lands well under a ceiling that was never a target. |
| `architecture/<name>.md` | 600 (was an unmeasured 1,500 in the conventions table — the driver never budgeted sub-files at all; v3.1 fixes that gap and thins the target) |

### 6. `/gspec-migrate` — nothing structural

Architecture files do not move: v1's two-tier layout is already at these paths. Migrate's whole v3.1 contribution is the warning — *"`architecture.md` (and sub-files) hold N words of entity/endpoint/logic detail that v3 places in `gspec/features/<slug>/arch.md`; re-run `/gspec-architect` after `/gspec-plan` to thin them"* — never a content edit (the mechanical-only rule). No `collectLegacyLayout` change in this release.

---

## Release v3.2.0 — feature folders + tokens-only style

### 1. Prerequisite refactor: extract the revision loop

`gate()` (`lib/build.js:1010-1030`) and the features case (`:1240-1258`) already contain the same revision loop verbatim. A third copy is where it becomes a liability. Extract first, in the same release:

```js
async function reviseUntilPass(stage, target, ctx, { deliveredOk, sizeTargets, initialVerdict })
  // → { verdict, downgraded, detail }
```

Both `gate()` and the new handler call it. It is covered by `build-qa-loop.test.mjs` and `build-failure.test.mjs`, so the refactor is verifiable before new stages land on it.

### 2. Three stages, one handler, one file each

`gate()` deliberately does **not** generalize — it is single-target/single-deliverable and every foundation stage depends on it. But because each stage now produces exactly **one** file per feature, no new delivery primitive is needed either: `outputsPresent` (`:858-863`) already answers "does this path exist and is it non-empty?"

Replace the single `plan` entry (`lib/build.js:216`) with three, all `type: 'feature-plan'`, all served by **one** handler `runFeaturePlanStage(stage, ctx, { rerunning })`:

```js
{ id: 'feature-arch',   title: 'Feature architecture', type: 'feature-plan',
  writer: 'feature-architect',  validator: 'feature-architecture-validator',
  file: 'arch.md',
  concurrency: FEATURE_ARCH_CONCURRENCY },   // = 1 — anchor race, see §5
{ id: 'feature-design', title: 'Feature design',       type: 'feature-plan',
  writer: 'feature-designer',   validator: 'feature-design-validator',
  file: 'design.html', appliesWhen: hasApplicableUiSection },
{ id: 'plan',           title: 'Plans',                type: 'feature-plan',
  writer: 'plan-decomposer',    validator: 'plan-validator',
  file: 'tasks.md',   wellFormed: hasTaskCheckbox },
```

Three stages rather than one stage with sub-phases, because the manifest already keys `status`/`attempts`/`passed` **by stage id** — three entries give three resume points and three memo namespaces for free. Keeping `id: 'plan'`/`title: 'Plans'` on the third preserves manifest compatibility for in-flight runs. Writer-outer iteration (all features get `arch.md`, *then* all get `design.html`) means a crash never leaves one feature straddling two writers.

`appliesWhen` is now a **content** predicate rather than a file-existence one: `hasApplicableUiSection(cwd, slug)` reads `arch.md` and returns false when its `## UI` section is marked Not Applicable (or absent). One small read per feature, and it reuses the Not Applicable convention every spec already follows.

**The features stage moves into the folder too.** With the PRD at `gspec/features/<slug>/prd.md`, the existing `features` stage — which v3 otherwise left untouched — changes paths in the same release: `feature-writer`'s target and the "use this exact slug as the filename" prompt language become "write to this exact folder"; `looksCompletePrd` (`:867-872`) and the PRD-validator target strings re-point; `listFeaturePrds` (`:305-315`) reads directory names instead of filenames, accepting flat `*.md` too through the migration window; the memoization keys follow the new path. `/gspec-migrate` gains the PRD relocation (`features/<slug>.md → features/<slug>/prd.md`) alongside the tasks one, and `collectLegacyLayout` learns flat PRDs as a stale-layout signal. This is the price of colocation: the one stage v3 didn't touch joins the rewrite — but it buys a tree where each slug appears exactly once, and the orphan class "feature folder with no PRD" (which only the cross-referencer would have caught across two roots) becomes visible in a single `ls`.

### 3. Half-written work

With one file per stage per feature, "did the writer finish?" is just "does the file exist and parse?" — the `{wrote, skipped}` JSON manifest and the multi-file digest an earlier draft needed are both gone. What remains is the resume record, which is genuinely necessary because the fan-out can die between features:

**A per-slug `written` record beside the existing `passed` map:**

```
stages['feature-arch'].written[slug] = <file hash>   // after the writer returns
stages['feature-arch'].passed[slug]  = <file hash>   // after QA PASSes
```

On re-run (`priorStatus` failed/running):

| state | action |
|---|---|
| no `written` record | **regenerate** — the writer died mid-fan-out; anything on disk is a torso |
| `written`, hash matches | skip regeneration; re-validate unless `passed` matches |
| `written`, hash changed | skip regeneration (honor a hand-edit made during the pause), re-validate |

That is exactly `gate()`'s `revalidate` semantics per feature, falling out of content-addressing rather than a flag — and it uses the existing `hashFile` (`:843-848`) and `ctx.isMemoized`/`ctx.memoize` (`:1661-1672`) with **no signature change**. The features stage is untouched.

**One memo key is finer than its file: `feature-design`.** If the design stage's memo key were the hash of `arch.md`, any arch edit — a data-model tweak — would invalidate and regenerate the most expensive artifact per feature. Key it instead on the `## UI` section text plus the style guide's token block: the design regenerates only when what it depicts changes. The section text is already being extracted for `hasApplicableUiSection`, so this costs one substring.

**Bugs this fixes on the way:** today's checkpoint (`:1273`) is a bare `pathExists` with no `rerunning` guard, so a plan file that exists is never re-validated even after a QA failure; and `plan-validator` is non-blocking with no revision loop (`:1292-1295`). Both go away. **Flag the second in the changelog** — a build that used to march past a bad plan now pauses. A `nonBlocking: true` escape on the `plan` stage entry is a one-line fallback if it proves too aggressive.

### 4. All three writers get `Write`

`plan-decomposer` is the only writer in the roster that doesn't write (`Read, Grep, Glob`; the driver writes its stdout via `extractPlanBody` `:1472`). That exists solely because `/gspec-plan` has an approval gate *before* the write — a command concern that leaked into the agent contract. With 3–6 files per feature, stdout-marshalling means either N round-trips or a bespoke multi-file envelope.

| agent | tools |
|---|---|
| `feature-architect` (new) | `Read, Write, Edit, Glob, Grep` |
| `feature-designer` (new) | `Read, Write, Edit, Glob, Grep` |
| `plan-decomposer` (changed) | `Read, Write, Edit, Glob, Grep` |
| `feature-architecture-validator` (new) | `Read, Grep, Glob` |
| `feature-design-validator` (new) | `Read, Grep, Glob` |

The delivery check gets **better**, not worse: the plan case doesn't use `runWriterResilient` (`:895-933`) at all today — it exits on non-zero and sniffs stdout for a checkbox. Switching to `runWriterResilient(stage.writer, prompt, ctx, {}, () => outputsPresent(cwd, [`gspec/features/${slug}/${stage.file}`]))` gains retry-on-non-zero-exit, retry-on-exit-0-with-nothing, and accept-a-present-artifact-after-a-post-write-crash. The checkbox sniff survives as `wellFormed`. `extractPlanBody` and its call site are deleted.

Costs to pay:

1. `/gspec-plan`'s approval gate inverts from review-before-write to review-after-write. Not a new pattern — `/gspec-architect` already works that way. Rewrite `plugin/commands/gspec-plan.md` steps 3–4 and the "you do **not** write the file" line in `plugin/agents/plan-decomposer.md`.
2. The tool string is a permission change across targets: `scripts/manifest.js`'s `tools:` drives `cursorReadonly()`, `codexSandbox()` (`read-only` → `workspace-write`), `opencodeToolsMap()`, `piToolsCsv()`. Correct and intended, but user-visible.
3. Path discipline — a fan-out writer choosing its own path produces `gspec/features/Auth/Data.md`. The driver `slugify`s (`:1434-1440`) and passes the exact folder in the prompt with "use this exact path" language, mirroring the features stage.

### 5. Anchor discipline

New section in `gspec-conventions.md` (shared, not a persona — five consumers need it: `feature-architect`, its validator, `plan-decomposer`, `implementer`, `spec-cross-referencer`).

**Rigid heading grammar.** `arch.md` has exactly four H2 concern sections; every item is an **H3** under the one that owns it, in exact form, because the anchor must be a fixed-prefix line-anchored regex:

| section | item anchor |
|---|---|
| `## Data` | `### Entity: <PascalName>` |
| `## API` | `### Endpoint: <METHOD> <path>` (uppercase method, path as routed, no trailing slash) |
| `## UI` | `### Screen: <Name>` · `### Component: <Name>` |
| `## Logic` | `### Rule: <Name>` · `### Machine: <Name>` |

An inapplicable concern is its H2 plus one **Not Applicable** line and a reason — the existing convention, and the signal `appliesWhen` reads for the design stage.

`design.html` mirrors the UI section: `<section id="screen-<kebab>">` with an `<h2>`, where the id is `slugify()` of the `### Screen:` name, so the mapping is mechanical in both directions.

**A machine-readable status line opens every block:**

```
### Entity: Order
- **module:** api
- **defined-in:** gspec/features/checkout/arch.md     ← self ⇒ ORIGIN
- **amends:** gspec/features/checkout/arch.md         ← present ⇒ DELTA
```

Exactly one origin per anchor across the tree; any number of deltas. A delta carries only `#### Added` / `#### Changed` / `#### Removed` and never restates the origin. Every `arch.md` carries frontmatter `spec-version` + `feature: <slug>` + `module: <name>`, so a grep hit is self-describing without opening the file.

**The cross-feature grep story** (stated verbatim in `feature-architect.md`) — before writing any item:

1. `Grep -rn "^### Entity: Order$" gspec/features/`
2. Zero hits → you are the origin: write `defined-in:` pointing at your own file plus the full definition. One or more hits → read the block carrying `defined-in:`; write only a delta with `amends:`. (Deltas of deltas are legal; read them in `features/` lexical order to reconstruct current state.)
3. Never reword an existing anchor. A rename is a new anchor plus `superseded-by:` on the old one.

**The race this creates.** The features stage's fan-out is safe because PRDs are file- *and* content-disjoint. Feature folders are file-disjoint but **not anchor-disjoint**: two concurrent `feature-architect` runs both grep for `### Entity: User`, both find zero hits, both declare themselves origin. Fix — the anchor-*producing* stage runs serially; the anchor-*consuming* stages stay parallel:

```js
const FEATURE_ARCH_CONCURRENCY = 1;   // feature-arch — anchor producer
// feature-design and plan keep FEATURE_WRITER_CONCURRENCY = 5
```

Named constant so it's a one-line change if too slow. Cost is N sequential runs — identical to today's `plan` stage, already a serial `for` loop. Rejected: dependency-wave scheduling (the feature-planner's `dependencies` aren't persisted across stages) and a driver-maintained anchor index (a fourth source of truth).

**Claw back the wall-clock: pipeline validation behind the serial writer.** Only *writers* produce anchors — validators are read-only. So feature N's validator can run concurrently with feature N+1's writer: the handler fires the validation promise and moves to the next slug, awaiting the set at the end. One rule keeps it safe: a failed validation's **revision** writer produces anchors too, so revisions are queued and run serially *after* the fan-out completes, never interleaved with it. Roughly halves the serial stage's wall-clock without touching the race fix.

**Anchors earn their keep at read time too — `arch:` task routing.** The anchor grammar exists for the origin/delta story above, but it also makes partial loading possible. `plan-decomposer` stamps each task with the anchors it touches, exactly the way tasks already carry `covers:`:

```markdown
- [ ] **T7** **P0** add the cart totals endpoint in `src/routes/cart.ts`
  - deps: T3
  - covers: "User can see an itemized cart total"
  - arch: #endpoint-post-cart-totals, #rule-taxrounding
```

Anchors are `slugify()` of the H3 text, resolved against the sibling `arch.md` — a within-folder fragment, never a path, so nothing to keep in sync when files move. The implementer loads the **union of anchors across its unchecked tasks**, plus the module tier, rather than the whole file.

This is the "plan-time routing" lever recorded in `docs/architecture-file-set.md` (*"Implementers then load precisely what the plan names, with zero routing work of their own"*), pointed at anchors inside the feature's own `arch.md` instead of at module files.

**Where it pays.** Run 1 of a scope has every task unchecked, so the anchor union is most of the file — little win. Run 4 has three tasks left and loads three blocks. Because `MAX_SCOPE_RUNS` is 6 and *every continuation run re-reads from scratch* (`lib/build.js:1040-1043`), the saving compounds precisely where the cost is worst. That is the opposite profile from splitting a feature into smaller scopes, which is most expensive on the runs that are already cheap — see §11.

### 6. The two new validators

**A deterministic lint floor runs first.** A large share of the checks below are pure regex over text: anchor grammar and section shape, origin uniqueness across the tree, `amends:` targets resolving, screen coverage in both directions, `arch:` lines resolving, token literals outside the token block. Spending an agent run to discover a malformed heading is waste — and the race backstop (origin uniqueness) shouldn't depend on a model noticing. New pure floor **`plugin/hooks/floors/plan-lint.mjs`**, same pattern as the others (takes texts, no I/O), run by the driver **before** each agent validator:

- Lint failures go straight back to the writer as a revision prompt with the exact violations — **zero agent cost** for mechanically-broken drafts.
- The agent validator only ever sees lint-clean drafts, so its whole budget goes to judgment calls (tier boundary, enrichment, delta honesty) instead of grammar.
- On Claude it also runs as a PostToolUse advisory on `gspec/features/**` writes, and the Codex Stop gate picks it up through `scanGspecTree` — the same dual-wiring every existing floor has.

This is the repo's producer≠checker philosophy applied one level down: deterministic floor, model judgment on top. The items below marked **(lint)** are enforced deterministically; the validator re-states them only when the lint can't see them (e.g. a field table floating in prose is grammar; *which* section owns a concern is judgment).

**`feature-architecture-validator`** checks:

1. **Section and anchor shape (lint)** — exactly the four H2 concern sections, no others; every H3 matches its section's grammar and sits under the section that owns it (an `### Endpoint:` under `## Data` is a finding); architectural content not under an anchor (a field table floating in prose) is `[major]` and is the validator's half — grammar is the lint's.
2. **Uniqueness within the file (lint).**
3. **Origin uniqueness across the tree (lint)** — a second `defined-in:` for an anchor is a `[blocker]`. The race backstop, now deterministic.
4. **Delta discipline** — an `amends:` target must exist and contain that anchor **(lint)**; a delta restating unchanged fields is `[major]` (judgment).
5. **Tier boundary** — nothing belonging in the module tier (owned dirs, placement rules) or the PRD (capability prose, acceptance criteria).
6. **Applicability honesty** — an inapplicable concern is its H2 plus a **Not Applicable** line and a reason, never a silently omitted section; a `## API` marked Not Applicable for a feature with endpoints is a `[blocker]`.
7. **No dead anchors** — every H3 is named by at least one task's `arch:` line. An unreferenced anchor is either spec nobody builds or a missing task; `[minor]` on its own, `[major]` when the anchor describes an entity or endpoint the PRD's capabilities clearly require. (The forward direction — every `arch:` resolves — is `plan-validator`'s, since it owns `tasks.md`.)
8. **Enrichment — the inverted bar.** ⚠️ The QA persona and every existing validator push toward agnosticism and single-source-of-truth. The enriched siblings are deliberately denormalized: an implementer reading only `arch.md`/`design.html`/`tasks.md` must not need `architecture.md`/`stack.md`/`style.md` — nor `prd.md`, which it touches only to flip capability boxes. "See stack.md for the ORM" is a `[major]` — the ORM name must be inlined. **Without this stated inversion the validator will fail every feature folder for "duplicating architecture content".**

Correspondingly: do **not** preload `gspec-agnosticism` into `feature-architect`/`feature-designer`. The floor's boundary now runs *inside* the feature folder, by basename: `isGuardedSpec` guards `gspec/features/<slug>/prd.md` (and the legacy flat `features/<slug>.md`) and returns `false` for the three enriched siblings — never a folder-level exemption, which would silently unguard the PRD. Accepted consequence — product identity can now legitimately appear in `arch.md`/`design.html`/`tasks.md`. State this in the release notes rather than letting it be discovered. And because the PRD writer now works next to tech-heavy siblings, `feature-writer`'s prose gains an explicit rule: *the PRD never reads its siblings* — the floor on `prd.md` is the backstop, not the fence.

**`feature-design-validator`** — build it; don't reuse `style-validator`. That agent's bar is the *design-system* bar (token-set completeness, computed contrast table, agnosticism, "visual not behavioral"); for `design.html` every one of those is inapplicable or inverted. Reusing it means either branching the bar on the target inside one agent (what makes validators unreliable) or systematic false FAILs — and it breaks the 1:1 writer↔validator pairing the stage plumbing and memoization assume. Its checks:

1. **Renders standalone** — self-contained, no external CSS/JS/fonts/images, no build step; opens correctly from `file://`. First line, before `<!DOCTYPE html>`, is `<!-- spec-version: … -->` (the existing HTML rule in `spec-integrity.mjs:31`).
2. **Screen coverage both directions (lint)** — every `### Screen: <Name>` under `arch.md`'s `## UI` has a `<section id="screen-<slugify(Name)>">`, and every such section has a matching screen. An orphan either way is `[major]`.
3. **Token discipline (lint)** — every color, spacing, radius, and type value outside the copied token block is a `var(--…)` reference. A literal hex/rgb/hsl elsewhere is `[major]`.
4. **No token authorship** — the design defines no new tokens; a `--custom-thing: …` that has no counterpart in the style guide is `[major]` (a design inventing a token is a style-guide change wearing a disguise).
5. **Real states, not a happy path** — each screen shows its empty / loading / error / populated states where the PRD's acceptance criteria imply them.
6. **Visual, not behavioral** — no interaction logic; that is `arch.md`'s `## UI` and `## Logic`.

### Tokens in `design.html` — copy, then verify

`design.html` must be self-contained to render, so it carries a **copy** of the style guide's `:root` custom-property block. Duplication is unavoidable here; drift is not:

- The copied block is fenced by a provenance comment (`<!-- gspec:tokens from gspec/style.html — generated copy, do not hand-edit -->`) and is the **only** place a literal color may appear.
- New pure floor **`plugin/hooks/floors/token-sync.mjs`** (takes both texts, does no I/O) extracts the custom-property declarations from the style guide and from `design.html` and reports any name present in one and absent in the other, or any value that differs. Deterministic, so a PostToolUse advisory can carry it.
- **`floors/token-literals.mjs` now DOES extend to `gspec/features/*/design.html`.** Its own header explains that it governs only `style.html` because a Markdown guide's token tables aren't mechanically separable from prose — with an HTML design that objection disappears. Change `appliesToTokenLiterals` (`:16-18`) from `=== 'gspec/style.html'` to `isRootStyleHtml(rel) || isFeatureDesign(rel)`.
- **When the project's style guide is `style.md`**, there is no CSS custom-property block to copy. The designer transcribes the token table into the block and `token-sync` degrades to advisory name-matching. This is the concrete reason `style.html` is the recommended format, and the designer persona should say so.

### 7. Tokens-only style

`plugin/skills/personas/gspec-designer.md:16-34` — keep the token block, light/dark themes, icon set, WCAG target, and the computed contrast table. Remove component specimens, imagery direction, and usage examples. Budgets: `style.md` 2,000 → 900; `style.html` 1,500 → 700 prose.

The persona now serves **two** deliverables with opposite jobs, so state the split explicitly: the style guide is the *vector* (tokens, no concrete elements); `features/<slug>/design.html` is the *application* (concrete screens, no token authorship). It should also state why `style.html` is recommended rather than merely preferred — only the HTML form gives `design.html` a custom-property block to copy and `token-sync` an exact comparison.

`/gspec-migrate` **must not touch `style.html`/`style.md`** — the specimens it would strip have nowhere to go until the features are re-planned, and stripping is unrecoverable. Leave them (they merely become over-budget, which is advisory) and warn.

### 8. Retire `gspec/design/` outright

There is no asset folder in v3. `design.html` is self-contained (the same rule `style.html` already lives under), so a mockup's imagery is a `data:` URI inside it. That removes a whole category of machinery:

- **Keep the exclusion, don't relocate it — and don't delete it either.** `spec-integrity.mjs` and `agnosticism.mjs` both carry an explicit `gspec/design/` skip. An earlier draft deleted both on the grounds that every file under `gspec/` is then a governed spec, which is a simpler contract. That was wrong in practice: a project upgrading from v2 still has mockups in that folder, and they would immediately start failing the spec-version check for a marker they never had. Retiring the folder from the *flow* costs nothing; retiring it from the *floors* costs every existing user a wall of findings. The lines stay, with a comment saying why.
- No `isPlanAsset` predicate, and no `design.html`-vs-`design/` prefix ambiguity for the path predicates to discriminate.
- **Migration:** an existing `gspec/design/**` has no v3 home. `/gspec-migrate` leaves it in place and warns that its mockups belong in the relevant feature's `design.html` — it must not delete user-supplied artwork (same reasoning as the `style.html` no-touch rule in §7).
- **Cost to accept:** binary mockups get bigger as base64 and are no longer diffable. Worth it — the alternative is a second, unvalidated home for design intent, which is what `gspec/design/` was and why it drifted. Reference-only material (a Figma URL, a brand PDF) belongs in the profile or the brief, not in the spec tree.
- `implementer.md:5` and `spec-cross-referencer.md:11` both reference `gspec/design/` mockups in their read lists; both now point at the feature's `design.html`.

### 9. Manifest, degrade, and budgets

- Four new `V2_AGENTS` entries **in the same commit** as the `STAGES` entries (`test/dist-agents.test.mjs` derives its roster from `STAGES` — this one is self-enforcing).
- `DEGRADE_CAPABILITIES` has **no test**: an agent absent from it silently never ships to cursor/antigravity/opencode. Add `test/dist-degrade.test.mjs` asserting every `V2_AGENT` is either reachable from a degrade entry or on an explicit build-runtime-only allowlist (current members: `feature-planner`, `research-planner`, `build-orchestrator`).
- `composeDegraded` (`scripts/build.js:186`) supports exactly **one** `also` agent and one `check`. `/gspec-plan` now composes three writers + three validators into one file, so `also` must become an array and a second `check` slot is needed.
- Budget rows (atomic with `gspec-conventions.md`): `features/<slug>/arch.md` 2,400, `features/<slug>/design.html` 600 **words of prose** (markup, tokens, and rendered screens excluded — `countSpecWords` already keys prose-only counting on `/\.html?$/` at `lib/build.js:161`, so this generalizes for free), `features/<slug>/tasks.md` → no word budget (task-count budget; `budgetFor` returns `null`).

### 10. Consumer routing

`implementer.md:5`, `plan-decomposer.md:7`, `build-orchestrator.md:5`, `codebase-inspector.md:7`, `spec-cross-referencer.md:11`, `gspec-orchestrator.md:17-19` — all must route on the new layout. The implementer's read list collapses dramatically: **its own feature folder, plus `gspec/architecture/<name>.md` for the modules it touches**. That collapse is the point of the whole change.

### 11. Scope shape — one feature per scope

The collapse in §10 only holds if a scope covers **one** feature. Today nothing guarantees that, and v3 makes the failure mode worse rather than better.

**How scope shape is decided today.** `build-orchestrator` returns waves of `{label, instruction, plan}` where `plan` is a list of plan files; the driver runs whatever it is given (`lib/build.js:1316-1328`). The persona example (`gspec-orchestrator.md:17-19`) shows one file per scope, but that is a suggestion, not a constraint — a scope may carry any number. And the fallback is the maximum-context case:

```js
// lib/build.js:1332 — fires whenever parseBuildPlan fails or the orchestrator exits non-zero
const scope = { label: 'all in-scope work', plan: await listPlanFiles(ctx.cwd) };
```

That is *every* plan file in one scope, reached by a JSON parse hiccup rather than a decision.

**Why v3 inverts on multi-feature scopes.** Enrichment amortizes across *runs of the same feature* and multiplies across *features in one scope* — the opposite of today's shared-spec model:

| a scope covering 3 features | today | v3 |
|---|---|---|
| shared specs | architecture + stack + style read **once** (~7,000w) | inlined per feature folder — read **three times** |
| per-feature | 3 small task files | 3 × ~2,400w denormalized |

So on a bundled scope v3 is worse than the status quo. The whole context argument for this design rests on scopes being feature-shaped, which means the driver has to enforce it rather than hope for it.

**Four changes, all in the driver:**

1. **One feature per scope.** The orchestrator's job becomes *ordering and concurrency* — which features may share a wave — not bundling. The driver splits any scope whose `plan` names more than one feature into sibling scopes in the same wave, and logs that it did. Scopes within a wave already fan out via `Promise.all` (`:1322`), so wall-clock barely moves; the cost is agent count, and it buys an exact context bound — one feature folder + one module tier + practices, constant regardless of project size.
2. **Fix the fallback.** `listPlanFiles` must yield one scope *per feature*, not one scope containing everything. This matters more than (1) because it fires on a parse failure rather than a design choice, and `listPlanFiles` (`:317-324`) is being rewritten for the folder layout anyway.
3. **Driver-computed read list in the scope prompt.** The doc's remaining soft spot is that the implementer's read discipline is prose. Close most of it mechanically: the driver knows the scope's feature, and that feature's `arch.md` frontmatter names its `module:` — which *is* the path (`gspec/architecture/<name>.md`), no table resolution needed. So the scope instruction carries the *exact* resolved read set — *"your specs are `gspec/features/<slug>/` (all four files — `prd.md` is there for capability checkboxes, not context), `gspec/architecture/<name>.md`, and `gspec/practices.md`; do not read other specs"* — pre-resolved paths instead of routing rules to follow. (The implementer still writes `prd.md`: it flips capability boxes when their covering tasks complete. Colocation makes that write target a sibling instead of a second tree.) Deviations become visible in the transcript, and the read-set claim in §10 stops being a hope.
4. **Inline the remaining tasks in continuation prompts.** `runImplementScope` already counts unchecked boxes between runs (`:1056-1059`); extracting the unchecked task *lines* is the same regex. Continuation prompts include them verbatim — IDs, `deps:`, `covers:`, `arch:` — so run 4's fresh agent starts holding its three remaining tasks and their anchors, greps three blocks of `arch.md`, and never re-reads `tasks.md` at all. Stacks directly on §5's anchor routing, exactly where the continuation re-read cost is worst.

**Rejected: sub-feature scoping** (an implementer handling only some tasks within a feature). It reads well and does not survive contact:

- **Context is dominated by the spec, not the task list.** A scope reads `arch.md` + `design.html` + module tier + practices; the tasks themselves are one sentence each. Three sub-scopes read the same spec three times for the same work.
- **The continuation loop already does this, adaptively.** `runImplementScope` (`:1057-1071`) spawns fresh agents while the unchecked count drops — task-level incremental progress driven by *actual* context exhaustion. It pays the re-read only when the window really fills; static splitting pays it always.
- **`deps:` chains are mostly sequential** within a feature (schema → API → UI), so sub-scopes would serialize anyway while adding a re-read at every boundary.
- **Checkbox races.** Scopes today are file-disjoint by construction. Sub-feature scopes share one `tasks.md`, so concurrent implementers write the same file and `gspec-task-immutability` — a PreToolUse *block* — starts firing on legitimate writes.
- **`verify.sh` granularity.** Half a feature often doesn't build. A feature is the natural coherent, verifiable increment.

`arch:` anchor routing (§5) is the mechanism that gets the intended saving without any of this: it shrinks *what a run reads* instead of *how many runs there are*.

### 12. The implement gate goes deterministic-first

Today's gate is two-part: `verify.sh` (deterministic) then `implementation-validator` (agentic). But `verify.sh` proves only that the code passes *its author's own tests* — the implementer writes both, so the deterministic half is producer==checker. The failure modes that actually burn autonomous builds (weak tests, stubs behind checked boxes, silent descoping, design infidelity) are exactly the ones it can't see, and today they all fall to one broad agentic judgment. Apply the plan-lint pattern one stage later:

**Gate 1 (exists):** `verify.sh` — build + test per module, driver-run, self-heal on failure.

**Gate 1.5 (new): `plugin/hooks/floors/implementation-lint.mjs`** — pure checks the driver runs before spending the validator:

- Every file path named in a **checked** task exists and is non-empty (tasks name concrete files, so stub-by-omission is greppable)
- No `TODO` / `FIXME` / `not implemented` / stub-throw markers in files named by checked tasks
- Checkbox consistency: no `prd.md` capability checked while a covering task in `tasks.md` is unchecked — pure text, both files in one folder
- The practices `## Enforcement` rules swept repo-wide (today they fire only per-write; code written before a rule change escapes until touched again)
- Literal hex/rgb/hsl in UI source outside token definitions — the regex `token-literals` already has

Failures go straight back to the implementer with exact violations — zero agent cost, and a *targeted* fix instead of a vague FAIL that sends a self-heal run off to rediscover the problem. Because the checks are pure, they also run between continuation runs in `runImplementScope`: a stubbed checked-task is caught at run 2, before more work stacks on top of it.

**Gate 2 (kept, narrowed):** `implementation-validator`'s charter shrinks to what only judgment can answer — are the acceptance criteria actually satisfied, do the tests *meaningfully* assert them, does the UI honor `design.html`. And it validates **per feature folder against its code** rather than judging the whole repo, which is where agentic code QA gets vague. Cost honesty: the direct saving is one validator run per mechanical failure — modest; the real saving is fewer QA retry *cycles* (each one costs a self-heal implementer run) and fewer false FAILs from an overbroad charter.

The deeper producer==checker fix — tests authored independently of the implementation — is out of v3's scope; the narrowed gate is the pragmatic backstop until then.

### 13. The audit goes incremental — and gains the drift category

v3 quietly makes `reconcile` the new unbounded reader: under v2 the audit's spec side was fat but fixed; under v3 it is **every feature folder, growing forever** — the "reads everything, grows with age" problem moved out of the implementer and into `codebase-inspector`. Same medicine as everywhere else:

- **Incremental by default.** The audit records the commit it last ran at (`.gspec/audit-baseline`); the next run git-diffs against it and reads only the modules and feature folders that changed, plus the always-small root tier. A `--full` flag (and a periodic nudge when the baseline is old) keeps the exhaustive pass available.
- **New drift category: `enrichment`.** This closes the design's one guarantee regression versus v2's single-source-of-truth: enriched folders inline stack/style facts that nothing re-checks after the stack changes. The audit compares each *changed-set* folder's inlined claims (the ORM, the framework, token usage) against current `stack.md`/`style.html` and reality, and files findings in the existing category taxonomy. Checking it only over the changed set is what lets the correctness fix land without reintroducing the cost problem.

---

## Release v3.3.0 — recommended model tiering at install

The single biggest cost lever is already shipped and unused: the `models` map in `.gspec/config.json` (v2.6.0), resolved per agent as exact name → role tier → `default` (`lib/config.js:41-78`). Nothing recommends a strategy, so almost every install runs every agent — validators included — on the engine's default (usually top-tier) model. v3.3 ships an opinionated default.

### The recommended tiering

Matched to the work, not the title:

| tier | agents | why |
|---|---|---|
| **top** | `implementer`, `feature-architect`, `architecture-writer` | judgment-heavy; errors compound downstream |
| **mid** | every other writer, `plan-decomposer`, the planners, `implementation-validator`, `feature-designer` | structured output against clear contracts |
| **cheap** | spec validators (`qa` tier) | post-lint, what remains is focused judgment over small texts |

Expressed compactly through the existing selector system — `qa` covers every `*-validator` by suffix, exact names carve out the exceptions:

```json
{ "models": {
    "default": "<mid>",
    "qa": "<cheap>",
    "implementation-validator": "<mid>",
    "implementer": "<top>",
    "feature-architect": "<top>",
    "architecture-writer": "<top>"
} }
```

Validators are roughly half of all v3 agent runs; a tier down on them is plausibly ~30% off the plan stage, with the lint floors (v3.2 §6, §12) absorbing the mechanical checks that made cheap validators risky. One code prerequisite: `ROLE_BY_NAME` (`lib/config.js:41-49`) gains entries for the suffix-less v3.2 agents — `feature-architect`, `feature-designer` — so role-tier selectors can reach them.

### The install-time question

During `gspec install` for the **claude** and **codex** targets (the two primary build engines), the installer asks:

> *Use the recommended model selection for this engine? (writes a `models` map to `.gspec/config.json`)*

- **Yes** → `writeProjectConfig` (`lib/config.js:87-93`) merges the target-specific map — the tier placeholders resolved to that engine's real model names from a small per-engine table in `bin/gspec.js` (the only place model names live, so new models are a one-table update).
- **No** → nothing written; today's behavior.
- **A `models` map already exists** in project or global config → the question is skipped entirely; user configuration is never second-guessed.
- **Headless installs** (`--yes`/non-TTY) → nothing written by default; a `--models recommended` flag opts in explicitly. Silently changing which models spend the user's money is not an install default.

Uses the existing `promptConfirm` (`lib/prompts.js`) and the existing config merge — no new mechanism. Other targets (cursor, opencode, pi) are skipped: cursor/opencode don't run the build runtime's agents, and pi's model roster is too fluid to recommend from a table; revisit on demand.

### Surfaces

`bin/gspec.js` (the prompt, the per-engine table, the flag), `test/install-targets.test.mjs` (config written on yes / skipped on existing / headless off), README install flow, and the standard release pair (`releases.astro` + version bump). A staleness note ships in the doc: the recommended map is *config, not contract* — re-running install refreshes it, and it never overrides a hand-edited map.

---

## Hazards

**H1 — stale layout wearing a current version.** A user who migrates at 3.0 or 3.1 gets files stamped `spec-version: v2` while still in the old *layout* (flat `gspec/tasks/`, flat `gspec/features/*.md`), so the version check never flags them once 3.2 lands. Mitigation: `collectLegacyLayout` (`bin/gspec.js:1110-1129`) — which detects layout independent of version — learns both 3.2 signals (`gspec/tasks/*.md` present, flat `gspec/features/*.md` present) in the 3.2 release, and the installer surfaces them exactly as it surfaces `.plan.md` legacies today.

**H2 — the hard block silently disappears (worst one).** `plugin/hooks/claude/gspec-task-immutability.mjs:19` is single-segment (`/^gspec\/tasks\/[^/]+\.md$/`) and the hook fails open. The instant `/gspec-plan` writes `gspec/features/auth/tasks.md`, the only hard PreToolUse block in the system stops firing, with no error anywhere. Codex is worse: `gspec-session-start.mjs:26-30` snapshots the old path while `scan.mjs:38` scans the new one, so the baseline is empty and `taskViolations` never runs. **All four land in one commit** — the Claude matcher, `scan.mjs`, `codex/gspec-session-start.mjs`, and a hook unit test asserting the new path matches *and* the legacy path still does (support both through the migration window).

**H3 — the module tier drifts from the table.** The two-tier file set is keyed by the Modules table's row *names*: a renamed row leaves `gspec/architecture/<old-name>.md` orphaned, and a new row can go without its file. The delivery predicate (v3.1 §4) catches missing files at build time, but **orphans** — a sub-file with no matching row — are caught by nothing deterministic; today only the validator's and audit's prose asks for it. `plan-lint`-style: `parseModulesTable` + `readdir` makes orphan detection a pure function; wire it into the same lint pass so a half-done rename is a caught finding, not silent drift.

**H4 — architecture stage skip-if-present goes wrong quietly.** Covered in v3.1 §4. Easy to miss because the `STAGES` entry looks unchanged.

**H5 — orchestrator path lag causes a silent under-build.** `runImplementScope` (`:1048-1073`) counts unchecked boxes across `scope.plan`, emitted by `build-orchestrator` from the JSON example in `gspec-orchestrator.md:17-19` (`gspec/tasks/auth.md`). If the model emits the stale path after 3.2, `countUnchecked` reads nothing → returns 0 → the loop exits after one run declaring the scope complete. Fix the persona example **and** add defensive normalization in the driver: any `plan` entry matching `gspec/tasks/<slug>.md` is rewritten to `gspec/features/<slug>/tasks.md` when the latter exists, with a warning. This class of lag is guaranteed for a while.

**H6 — the agnosticism boundary is one basename wide.** Guarded and exempt files now share a folder: `prd.md` is guarded, its three siblings are not. Get the branch order or the basename test wrong in either direction and the failure is silent — enriched docs nagged into agnosticism (which guts the design's whole premise), or PRDs quietly unguarded. This is the floor most worth exhaustive unit tests: all four basenames × guarded/exempt, plus the legacy flat-PRD path, plus a `features/<slug>/prd.md`-shaped path *outside* `gspec/`.

**H7 — files edited more than once.**

| file | 3.0 | 3.1 | 3.2 | mitigation |
|---|---|---|---|---|
| `lib/build.js` | rename + `budgetLabel` | arch delivery, module-tier budget | plan rewrite | land `budgetLabel` once in 3.0 as an identity refactor |
| `gspec-architect.md` | rename | module tier | boundary vs feature folders | write 3.1 as a wholesale replacement of Layout + required sections |
| `gspec-conventions.md` + `SPEC_BUDGETS` | — | module-tier row | plans rows, style shrink, anchors | **atomic pair, same commit, always** |
| `plugin/hooks/floors/*` | — | `paths.mjs`/`modules.mjs` | feature-folder rewiring, `plan-lint`, `token-sync` | ship `paths.mjs` in 3.1 with 3.2's predicates written but unused |
| `releases.astro` + `package.json` | ✓ | ✓ | ✓ | required by CLAUDE.md, every release (incl. 3.3) |
| `bin/gspec.js` | rename sweep | — | migrate relocations, `collectLegacyLayout` | install prompt + per-engine model table land in 3.3 only |

**H8 — `test/helpers.mjs` is the single point that breaks ~6 build test files at once.** `FAKE_ENGINE_SH`'s stage-title→spec-path map (`:83-101`) and the `*"ordered plan"*` stdout arm. The arm goes away; `deliver()` gains a `write_feature_file <slug> <prd.md|arch.md|design.html|tasks.md>` helper and three new prompt arms keyed on the new stage titles — and the existing feature-PRD arm (`:69`, `gspec/features/<slug>.md`) re-points into the folder in the same change.

**H9 — this repo is its own counterexample.** `website/gspec/` holds v1 specs with an `architecture.md` and no `tasks/`. Under CLAUDE.md's doc-sync rule they need migrating during 3.0/3.1, or gspec ships a layout it tells users not to use.

**H10 — one command or two.** `/gspec-plan` after 3.2 drives three writers and three gates. Recommendation: keep **one** command — the folder is one deliverable, and one command means one degrade composition, one manifest entry, one doc surface. Splitting `design.html` into a `/gspec-design` costs a full command surface across five targets for a step that never runs standalone.

**H11 — the context thesis fails silently on a bundled scope.** Everything in this design assumes one feature per scope; a scope covering three features reads three denormalized feature folders and is *worse* than v1 (v3.2 §11). There is no error when this happens — the build succeeds, just expensively — so it will not be noticed without instrumentation. Land the driver-side split and the fallback fix in the same release as feature folders, and log the scope→feature mapping so a bundled scope is visible in the run output.

**H12 — `arch:` anchors go stale against checked tasks.** A checked task is immutable, so its `arch:` line freezes with it. If a later feature supersedes an anchor (`superseded-by:`), the old task points at a heading that may no longer exist. This is harmless — checked tasks route nothing — but `plan-validator`'s "every `arch:` resolves" check must therefore apply to **unchecked tasks only**, or every mature plan file fails QA. Same carve-out the immutability rule already implies.

---

## Verification

**Per release:**

1. `npm test` — regenerates `dist/` then runs the suite. Specifically watch `build-budgets` (the conventions table is the source of truth — when it and `SPEC_BUDGETS` differ, change `lib/build.js`, not the table), `build-style-outputs` (the outputs-are-alternatives invariant), `dist-agents`, and the floor unit tests under `plugin/hooks/*/*.test.mjs`.
2. New tests to add: `test/spec-version.test.mjs` (3.0), `paths.mjs`/`modules.mjs` floor unit tests (3.1), `test/dist-degrade.test.mjs` (3.2), task-immutability cases for both the new and legacy plan paths (3.2), `plan-lint.mjs` unit tests including a two-origin fixture proving the race backstop fires deterministically (3.2), `implementation-lint.mjs` unit tests — stub markers, checked-task file existence, capability/task checkbox consistency (3.2), and install-prompt cases — models map written on yes, skipped when one exists, absent on headless (3.3).
3. `node bin/gspec.js install --target <each of claude, opencode, codex, cursor, pi>` into a scratch dir; confirm the emitted agent/command set and that `plan-decomposer`'s new tool string produces the right sandbox mode per target.

**End-to-end (the real gate), per release:**

4. In a scratch directory, run `gspec build "<small brief>"` with a fake or real engine through to the review pause. Confirm: every Modules row resolves to an existing architecture file (3.1); `gspec/features/<slug>/` contains the expected file set with correct anchors, and a second feature amending a first feature's entity produces a delta with `amends:` rather than a second origin (3.2).
5. **Open `gspec/features/<slug>/design.html` in a browser.** It must render standalone with no console errors, and its screens must visibly use the style guide's palette and type scale — this is the check the format exists for, and no test replaces it. Then confirm `token-sync` reports clean, and that editing one token value in `style.html` makes it report dirty.
6. **Resume test** — kill the run mid-`feature-arch` fan-out, re-run with `--resume`, and confirm the half-written feature regenerates while completed ones don't. This is the mechanism most likely to be subtly wrong.
7. **Scope shape** — confirm the implement stage logs one scope per feature, including when the orchestrator returns a bundled scope (it should split and say so) and when `parseBuildPlan` fails outright (the fallback should produce N scopes, not one). Then force a continuation run on a large feature and confirm the second run's `arch:` anchor union is smaller than the first's — that is the only direct evidence the routing works.
8. Run `/gspec-migrate` against a checked-out v1 project (or a fixture built from `website/gspec/`) and confirm the moves, the frontmatter rename, the version stamp, and the warning text — and that `style.html` is untouched.
9. **Audit incrementality** — run the reconcile stage twice with one feature folder edited in between; the second run's read set is the changed folder + root tier only, and an `enrichment` drift finding appears when the edit contradicts `stack.md`. `--full` still reads everything.
10. **Model tiering (3.3)** — install for claude answering yes, run a small build, and confirm the run-start "models in play" line shows the tiered selectors and the validators actually ran on the cheap tier.
