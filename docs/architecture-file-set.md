# Per-Module Architecture File Set — Analysis

- **Status:** Analysis. Not scheduled, not started.
- **Date:** 2026-07-24
- **Context:** Follow-up to the implemented two-tier layout (`docs/per-deployable-architecture.md`). Question: within each module/deployable, what file set most reduces the context subsequent agents must load? Includes the case for renaming "deployable" → "module".

---

## Ground the design in who reads what

The file set should follow the *access patterns*, not the document's table of contents. The architecture's consumers, what they need, and how they read:

| Consumer | Needs | Read mode | Frequency |
|---|---|---|---|
| `implementer` | structure + placement rules of the unit(s) in scope; the entities/endpoints/components its *tasks* touch | full for structure, targeted for inventories | highest (every scope, every wave) |
| `plan-decomposer` | layering/topology only (schema → API → UI; which units a feature spans) | thin, full | per feature |
| `build-orchestrator` | directory ownership per unit (file-overlap judgment), scaffold scope | thin, full | per run |
| `architecture-validator` | everything | full | per architect run |
| `codebase-inspector` | spec claims to diff against code, area by area | sampled | per audit |
| `spec-cross-referencer` | data model + contracts | targeted | per analyze |
| `implementation-validator` | Deployables table / `verify.sh` only | minimal | per gate |

Two observations fall out:

1. **Implementer scopes are feature-shaped, not concern-shaped.** A feature slice touches schema + API + UI at once, so a per-concern split does *not* mostly help the implementer avoid whole files — it helps the **thin readers** (decomposer, orchestrator) avoid the fat ones, and it makes targeted **Grep loads** possible for the implementer.
2. **Content divides by growth rate.** Identity, boundary, directory structure, and config are written once and barely move. Entity/endpoint/component inventories grow with every feature — they are the "infinitely growing" part. Separating *stable always-load* material from *growing reference* material is the single biggest context lever.

## Recommended file set

**Stable core stays small; growth goes into greppable inventory files.**

Multi-module system (Deployables table > 1 row):

```
gspec/
├── architecture.md               # system tier + index (unchanged role):
│                                 #   overview, shared data model, inter-module
│                                 #   contracts, cross-cutting auth, table, gaps
└── architecture/
    ├── frontend/
    │   ├── module.md             # ALWAYS-LOAD: identity, boundary, owned dirs,
    │   │                         #   internal structure + placement rules,
    │   │                         #   local config. Small and stable (~1 page).
    │   └── ui.md                 # inventory: one `## Page:`/`## Component:` per item
    └── backend/
        ├── module.md
        ├── data.md               # inventory: one `## Entity:` per item
        ├── api.md                # inventory: one `## Endpoint:` (or resource) per item
        └── logic.md              # inventory: one `## Rule:` / `## Algorithm:` /
                                  #   `## Workflow:` per item — business logic,
                                  #   state machines, resolved edge cases
```

Single-module project: no folders, but the same core-vs-inventory split applies at the root — `architecture.md` (core + index) plus `architecture/{data,api,ui}.md`. This is what actually fixes the original complaint (a single-module app's architecture grows forever too; the two-tier gate alone never helps it).

Rules that make it work:

- **`module.md` is the only file a consumer must read to work inside a unit.** Everything an implementer needs *regardless of task* (where files go, naming, config) lives there. It links its inventory files.
- **Inventory files are append-oriented and anchor-addressed**: exactly one `##` heading per entity/endpoint/page, named predictably, so an agent Greps for the items its tasks mention and reads only those sections. This converts "load the file" into "load the slice" without any tooling.
- **A layer file exists only when the layer applies.** No "Not Applicable" stub files — `module.md` states which inventories exist. (The N/A convention stays for *sections*, not files.) A thin CRUD module may genuinely have no `logic.md`; that absence is signal.
- **`logic.md` is where behavior lives** — the sharpened replacement for today's vague "Service & Integration Architecture" section. Each entry: inputs/outputs, the precedence and edge cases the architect resolved (rounding, tie-breaking, failure paths), invariants, a `stateDiagram` where there's a state machine, the owning code location, and the feature(s) served. The tier test, validator-enforceable: observable by a user → PRD; a decision the implementer would otherwise make → `logic.md`; something two modules must agree on → the system-tier root (cross-module workflows are contracts). It is likely the highest-value inventory for context reduction — algorithmic detail is long, feature-specific, and irrelevant to every task except the one implementing it.
- **Nothing else splits.** Config and structure fold into `module.md` (too small and too always-needed to separate). The Deployables table, shared data model, contracts, and gap analysis stay in the root — exactly the two-tier boundary already enforced.

### Loading matrix under this scheme

| Agent | Loads |
|---|---|
| `implementer` (UI task in frontend) | root + `frontend/module.md` + grep-slices of `frontend/ui.md`. Backend folder untouched. |
| `plan-decomposer` | root + each in-scope unit's `module.md` (inventories only via grep, if at all) |
| `build-orchestrator` | root + every `module.md` (structure/ownership is all it needs) |
| `architecture-validator` | everything (unavoidable — it polices the boundaries) |
| `codebase-inspector` | root + `module.md`s, inventories sampled per area |

Rough accounting for a mature two-module app (estimates): today an implementer's UI scope loads root (~300 lines) + the whole frontend sub-file (~700) ≈ 1,000 lines. Proposed: root + `module.md` (~120) + the greppped slice of `ui.md` (~100–350) ≈ 520–770. The thin readers win harder: the decomposer drops from ~1,700 (root + both fat sub-files) to ~540 (root + two `module.md`s). And because inventories absorb all growth, the always-load set stays near-constant as the project ages — that is the property that kills the "infinitely growing" problem.

### Companion lever: plan-time routing

The cheapest remaining win: `plan-decomposer` already reads the architecture per feature — have it stamp each task with the architecture files (or anchors) it needs (`arch: architecture/backend/api.md#endpoint-post-shorten`), the way tasks already carry `covers:`. Implementers then load precisely what the plan names, with zero routing work of their own. Worth doing whenever the file set lands.

## Co-location option: `<module-dir>/gspec/` instead of `gspec/architecture/<name>/`

Instead of keeping module folders under the root `gspec/architecture/`, each module's spec files could live in its own directory: `worker/gspec/module.md` + inventories. Two properties make this stronger than it first looks:

- **Fractal layout.** A module's `gspec/` is shaped exactly like a single-module project's `gspec/` (its `module.md` plays the role the root `architecture.md` plays there, plus flat inventories). Extracting a module to its own repo takes valid specs with it; adopting an existing gspec project as a module works in reverse. Single-module stops being a special case — it's the recursion's base case.
- **Physical spec↔code binding.** `git mv worker/ jobs/` carries the spec with the code. A directory rename touches one table cell (`dir`), and the audit already checks the table against reality — nothing dangles by construction.

Costs:

- **Bigger blast radius.** Everything today assumes one `gspec/` dir (migrate inventory, cross-referencer read list, spec-review pause, hook path matchers). All fixable — discovery becomes table-driven (row → `dir` → `<dir>/gspec/`) — but more surface than the central scheme.
- **The root-module wart.** A multi-module repo with a `dir: .` row would co-locate that module's `gspec/` onto the root `gspec/`, blurring the tier boundary. Fix by rule: in multi-module mode every module must live in a subdirectory; `dir: .` is legal only in single-module layout. The architect enforces this at design time, when it's cheap.

**Lean: co-locate, and decide before building the file set** — implementing `gspec/architecture/<name>/` first means migrating off it later. The deciding question: are modules potentially extractable, team-ownable subtrees (co-locate), or is the architecture one document sharded purely for context (central)?

## Rename resilience (module names will change)

Directory renames are solved physically by co-location. Name renames (the table key, which also keys `verify.sh`'s `FAIL: <module>:<phase>` and routing pointers) are made mechanical and checkable instead of prevented:

1. **The table is the single source of truth.** Folder location, `module:` frontmatter, and `verify.sh` keys must agree with the row; validator + audit check referential integrity, so a half-done rename is a caught finding, not silent drift.
2. **Indirect references, never raw paths.** Routing pointers are two-part keys resolved through the table — `arch: worker:api#endpoint-shorten`, not a file path. Dir renames then touch only the table; name renames are a greppable token sweep. (Stale pointers in checked tasks are moot: immutable but done — they no longer route anything.)
3. **An explicit rename flow** (steward-side, fits `/gspec-migrate` or the architect command): update the row → `git mv` the folder → fix frontmatter → regenerate `verify.sh` → sweep pointers in unchecked plan tasks. Deterministic, scriptable.
4. **Rejected: opaque stable IDs** (`m1`) decoupled from names. Theoretically rename-proof, but module names surface in `verify.sh` output and audit findings where humans read them — unreadable keys cost more daily than renames cost occasionally. Names stable-by-default + the rename flow is the better trade.

## Rename: "deployable" → "module"

The rename is justified on accuracy, not taste: the table's definition has always been "independently **build/test-able** unit" — deployment was never the criterion (a shared library row builds and tests but deploys nowhere). "Module" matches both the verification role and the new architecture-folder role.

Alternatives considered: **unit** (too vague), **target** (already means harness target inside gspec — real collision), **container** (C4-correct but reads as Docker), **service/app** (not general enough), **subproject/workspace** (tool-flavored: Gradle/npm). "Module" has only incidental prose collisions (v1 legacy files).

Rename surface (measured): ~105 occurrences across 19 files (personas, agents, commands, `lib/build.js`, `scripts/manifest.js`, README, docs, one test). Includes the contract strings: the **Deployables & Verification** section becomes **Modules & Verification**, `FAIL: <deployable>:<phase>` becomes `FAIL: <module>:<phase>`, sub-file frontmatter `deployable:` becomes `module:`, audit's "deployable" drift category becomes "module". This is a spec-format change → bump `spec-version` and teach `spec-migrator` the section/frontmatter rename (existing `verify.sh` scripts keep working — the FAIL key is just a name).

## Sequencing

1. Decide central vs co-located (blocking — it sets where every file in step 3 goes).
2. Rename first (mechanical, touches the same files the split will touch — doing it second means editing everything twice).
3. Land the file set: persona layout section (folder shape + inventory anchor convention + the `dir: .` rule if co-located), writer/validator (validator additionally checks anchor discipline, referential integrity vs the table, and that `module.md` stays lean), consumer routing updates, migrate path.
4. Add plan-time `arch:` routing (two-part keys resolved through the table) and the rename flow.

## Open questions

- Anchor naming convention for inventories (`## Entity: User` vs `## User`) — pick one and have the validator enforce it, or grep-routing degrades.
- Should `module.md` carry a hard size budget the validator enforces (e.g. flag > ~150 lines as a major finding)? Without a number, growth will creep back into the always-load file.
- Does the single-module root split (`architecture/` inventories with no folders — or, co-located, flat inventories beside `architecture.md`) land in the same change or later? Same shape, different gate.
- Module names must be filesystem-safe (they key folders) — worth stating as a table constraint the validator checks.
