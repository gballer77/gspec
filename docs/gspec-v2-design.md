# gspec v2 — Design

- **Status:** Layers 1–5 built on `v2-agent-refactor`; the `implementation-validator` code gate has landed. **Next queued: the learning loop ("training") — recorded in §13, not yet built.**
- **Branch:** `v2-agent-refactor`
- **Date:** 2026-07-11
- **Design reference:** `~/Downloads/agent-learning-architecture-handoff.md` — a conceptual handoff, **adapted, not followed verbatim**.

---

## 1. Summary — the shift

Turn gspec from a **flat spec-document generator** (12 fused command files that each emit a markdown doc) into an **agent-team SDD framework with a deterministic runtime**.

The direction is drawn from the handoff doc's agent-team + learning-loop vision, **judged on its own merits** and reshaped into gspec's own idiom. Alignment with other SDD frameworks (GitHub Spec Kit, Amazon Kiro, BMAD-METHOD) is explicitly **not** a design driver — they remain ambient reference only.

**Organizing idea:** *Skills are brains · agents are hands · commands are conversations · the runtime is the deterministic driver · hooks are the hard floors.* Agents are bounded by **judgment boundary** — never by command, work-unit, or scope.

## 2. Goals & non-goals

**Goals**
- Cleanly separate reusable *persona/method* knowledge (skills) from *tangible deliverable jobs* (agents), with thin `/gspec-*` commands as the conversational surface.
- Add the **producer≠checker quality gate** gspec lacks (QA — optional, on by default).
- Add a **deterministic pipeline runtime** so a one-shot "idea → built" run scales without overflowing context.
- Keep every current user working through the transition.

**Non-goals (this phase)**
- The full learning loop (distiller, per-agent memory *activation*, the orchestrator "mini-me" judgment skill).
- Enforcement hooks beyond the near-term guards (the rest are planned but phased).
- Converging gspec's structure toward any external framework.

## 3. Constraints

- **Structure-first.** Land the layering and the QA gate + runtime now; defer the learning loop.
- **Backward-compat.** All `/gspec-*` command names and the `gspec/*.md` living-document set keep working throughout.
- **Claude-first, degrade gracefully.** Claude Code gets the full skill/agent/command/hook split. The other four targets (Cursor, Antigravity, Codex, OpenCode) collapse each agent back into today's single skill/command and skip hooks — behaving exactly as they do now.
- **Profile-agnosticism.** All specs except `profile.md` stay free of product/business identity.

## 4. Verified platform facts (Claude Code)

These were confirmed against current docs and the design rests on them:
- Subagents live at `.claude/agents/<name>.md`; a **`skills:` frontmatter field preloads full skill content** into the subagent's isolated context at startup. → "persona = skill, agent preloads it" is natively supported.
- Per-agent **`memory:`** exists (scopes `user`/`project`/`local`, auto-loads the top 200 lines / 25 KB of `MEMORY.md`). → memory silos are keyed by agent **name**. Used later; names are set now.
- Subagents **cannot converse** — they run to completion and return a single message. → the human conversation must live in commands, not agents.

---

## 5. Layer 1 — Skills

Reusable brains. Two kinds, both installed to `.claude/skills/<name>/SKILL.md` and preloaded by agents/commands.

### Persona skills (specialist judgment)

| Skill | Embodies | Backs capabilities |
|---|---|---|
| `gspec-product` | Product strategist / PM | profile, feature, research |
| `gspec-architect` | Senior architect | stack, architect |
| `gspec-designer` | UI/UX & design systems | style |
| `gspec-practices` | Engineering practice lead | practices |
| `gspec-engineer` | Senior engineer / tech lead | plan, implement |
| `gspec-steward` | Spec integrity / reconciliation | analyze, audit, migrate |
| `gspec-qa` | QA reviewer / critic | (all validators, `/gspec-qa`) |

Each persona skill carries an explicit **"quality bar"** section — the checkable definition of a good spec of that type. The writer preloads it to *hit* the bar; the validator preloads it (plus `gspec-qa`) to *enforce* it. One source of truth for "good."

`gspec-engineer` additionally owns the plan-mode gate, capability↔task↔code traceability, and stable task-IDs (engineer-specific, not cross-cutting). Mermaid conventions live in `gspec-architect`/`gspec-engineer`.

> **Open:** `gspec-practices` is thin enough it could fold into `gspec-engineer` or `gspec-architect`. Kept standalone for now.

### Convention skills (shared house rules)

| Skill | Contents | Preloaded by |
|---|---|---|
| `gspec-conventions` | Frontmatter + `spec-version` handling, capability-checkbox + acceptance-criteria format, "Not Applicable" handling | every writer & validator |
| `gspec-agnosticism` | Profile-agnosticism + technology-agnostic vocabulary | every non-profile writer/validator |
| `gspec-authoring` | Clarification protocol (ask + offer 2–3 options), one-at-a-time approval loop, surgical-update protocol | interactive commands, checkers, editors |

### Sample

```yaml
# skills/personas/gspec-architect  → .claude/skills/gspec-architect/SKILL.md
name: gspec-architect
description: Architect persona — how to select a stack and design a system, incl. the quality bar for stack/architecture specs.
```

---

## 6. Layer 2 — Agents

~20 isolated workers. Each carries `memory: project` (the silo is created by the agent **name**; auto-load stays dormant until the learning loop is turned on). All are Claude-native; on other targets each collapses back into its persona skill/command.

**The splitting rule:** agents are bounded by **judgment boundary**, not by command and not by work-unit/scope.
- *Producers/validators split per spec type* — because (1) `skills:` preload is static (a parametric writer can't load the right persona per call), (2) memory silos are per-name, (3) output contracts are per-type.
- *Investigators stay singular* — their wisdom is about the shared substrate (the codebase, the spec set), so one silo each.
- *The implementer is one agent with a scope parameter* — it never changes persona/contract as scope grows.

### Producers — one per spec type (preload their persona, write the artifact)

| Agent | Preloads | Input → Output | Reused by |
|---|---|---|---|
| `profile-writer` | product + conventions | brief → `profile.md` | profile |
| `feature-writer` | product + conventions + agnosticism | brief → a `features/<slug>.md` PRD | feature, research, audit |
| `research-writer` | product + conventions + agnosticism | findings → `research.md` | research |
| `stack-writer` | architect + conventions + agnosticism | brief → `stack.md` | stack |
| `architecture-writer` | architect + conventions + agnosticism | brief + specs → `architecture.md` | architect, audit |
| `practices-writer` | practices + conventions + agnosticism | brief → `practices.md` | practices |
| `style-writer` | designer + conventions + agnosticism | brief → `style.md`/`style.html` | style |

Tools: `Read, Write, Edit, Glob, Grep`. Model: inherit (bump `architecture-writer` to opus).

### Validators — one per spec type (preload QA + domain persona; read-only, return a verdict)

| Agent | Preloads | Checks | Used by |
|---|---|---|---|
| `profile-validator` | qa + product + conventions | `profile.md` | /gspec-profile gate, /gspec-qa |
| `feature-validator` | qa + product + conventions | a feature PRD (absorbs analyze's old ambiguity sweep) | /gspec-feature gate, /gspec-qa |
| `stack-validator` | qa + architect + conventions | `stack.md` | /gspec-stack gate, /gspec-qa |
| `architecture-validator` | qa + architect + conventions | `architecture.md` | /gspec-architect gate, /gspec-qa |
| `practices-validator` | qa + practices + conventions | `practices.md` | /gspec-practices gate, /gspec-qa |
| `style-validator` | qa + designer + conventions | `style.md`/`.html` | /gspec-style gate, /gspec-qa |
| `plan-validator` *(opt)* | qa + engineer | a plan (coverage, acyclic `deps:`, safe `[P]`) | /gspec-plan gate, /gspec-qa |
| `implementation-validator` *(code gate)* | qa + engineer + practices | a **built scope**: `verify.sh` build+test result + acceptance criteria / DoD | /gspec-implement gate, pipeline |

Tools: `Read, Grep, Glob` **only** — no Write/Edit (they judge, they don't fix); the `implementation-validator` additionally gets `Bash` to run `verify.sh`. Model: strong.

**Verdict contract:** per-criterion pass/fail + evidence + the specific fix (not a rewrite), emitted as machine-readable output so commands/runtime can gate on it.

### Investigators — singular, shared (read-only, return findings)

| Agent | Preloads | Job | Used by |
|---|---|---|---|
| `codebase-inspector` | steward/engineer + conventions | Scan code → drift, orphan capabilities, build progress | audit, implement, architect |
| `spec-cross-referencer` | steward + conventions | Cross-read specs → conflict/inconsistency findings | analyze |
| `competitor-researcher` | product | Research one competitor → teardown (fan-out N→N) | research |

Tools: `Read, Grep, Glob` (+ `Bash` for `codebase-inspector`; `WebSearch, WebFetch` for `competitor-researcher`).

### Transformers

| Agent | Preloads | Job | Used by |
|---|---|---|---|
| `plan-decomposer` | engineer + conventions | PRD → ordered, dependency-aware plan | plan, implement |
| `implementer` | engineer + practices | **scope of {PRDs+plans} → code + checkbox updates + tests.** Scope = single PRD / a batch (phase) / all — a **runtime parameter**. The orchestrator picks granularity (fan out per feature/phase, parallelize independent scopes); the single "all" call is only for small projects / the autonomous pipeline's single pass. | implement, pipeline |
| `spec-migrator` | steward + conventions | Reformat a spec to the current `spec-version` (content-preserving) | migrate |

### Sample

```yaml
# agents/stack-validator.md  → .claude/agents/stack-validator.md
name: stack-validator
description: Validate stack.md against the architecture quality bar. Read-only; returns a structured verdict.
skills: [gspec-qa, gspec-architect, gspec-conventions]
tools: Read, Grep, Glob
model: opus
memory: project
```

---

## 7. Layer 3 — Commands

14 `/gspec-*` entry points. Each runs in the main session, loads its persona skill, holds every interview/approval, and delegates isolated work to agents. **Agents never talk to the human.**

| Command | Loads persona | Orchestrates | Deliverable |
|---|---|---|---|
| `/gspec-profile` | product | profile-writer → profile-validator | profile.md |
| `/gspec-feature` | product | (scope interview) → feature-writer ×N → feature-validator ×N | feature PRDs |
| `/gspec-plan` | engineer | plan-decomposer → plan-validator | plan.md |
| `/gspec-stack` | architect | stack-writer → stack-validator | stack.md |
| `/gspec-practices` | practices | practices-writer → practices-validator | practices.md |
| `/gspec-style` | designer | style-writer → style-validator | style.md/html |
| `/gspec-architect` | architect | codebase-inspector (optional) → gap interview → architecture-writer → architecture-validator | architecture.md |
| `/gspec-research` | product | competitor-researcher ×N → (review) → research-writer → optionally feature-writer ×N | research.md (+ PRDs) |
| `/gspec-analyze` | steward | spec-cross-referencer → present conflicts one-at-a-time → apply edits | updated specs |
| `/gspec-audit` | steward | codebase-inspector → present drift one-at-a-time → apply edits / feature-writer for orphans | updated specs + PRDs |
| `/gspec-migrate` | steward | spec-migrator ×files → confirm → apply | reformatted specs |
| `/gspec-implement` | engineer | codebase-inspector (progress) → plan-decomposer (if missing) → implementer ×scope | code + checkboxes |
| `/gspec-qa` **(new)** | qa | the relevant `*-validator`(s), fan-out across one or all specs | verdicts (+ optional fix loop) |
| `/gspec-pipeline` **(new)** | — (driver) | fallback path for the pipeline (see Layer 4) | built project |

### The producer≠checker gate
Every writer is followed by its validator — a **different agent** that **shares the domain persona skill** (so both agree on the bar, but the checker isn't grading its own work). Gate model = **optional, on by default (opt-out)**: the auto-gate runs after each write unless skipped (a `--no-qa` flag or a project config), and `/gspec-qa` is always available on demand. Producer-command flow: `interview → write → [ validate → present verdict → fix / re-delegate / waive ] → done`, where the bracketed gate is skippable. Producer≠checker still holds **structurally** (validators are separate agents); it just isn't always *invoked*.

The **checker trio**: `analyze` (spec↔spec consistency) · `audit` (spec↔code fidelity) · `qa` (spec↔quality-bar). QA absorbs `analyze`'s current single-PRD ambiguity sweep, so `analyze` becomes purely cross-spec.

> `/gspec-implement`'s output is code, not a spec. Its producer≠checker gate is the **`implementation-validator`** (built): a *deterministic* build+test run — the driver runs a generated `verify.sh`, exit code = the gate — plus model judgment of the acceptance criteria / Definition of Done, rather than trusting the implementer's own tests. Full contract in §13.

---

## 8. Layer 4 — Runtime

The piece that makes gspec a framework rather than a prompt bundle.

**`gspec pipeline "<idea>"`** — a deterministic node driver (in `bin/`) that takes an idea and drives the whole chain to a built product.

- **Run mode:** front-load, then autonomous. One upfront interview captures the decisions the run pivots on (product identity, stack/style lean, scope); then it runs unattended.
- **Span:** idea → built, adaptive. Generates only the *missing* foundations (skip-if-present), then features → architecture → plan → implement → final audit. Works greenfield and on existing projects.
- **Execution model — why a script, not a command:** a markdown command runs in one accumulating main-session context, which overflows on large builds and can't resume. The driver instead holds the loop in **code** and spawns **each stage/agent as an isolated headless run** (`claude -p` / Agent SDK) — a fresh context every time, nothing accumulates.
- **Files are the shared state.** gspec's intermediate artifacts are files; each stage reads inputs from `gspec/` and writes outputs to `gspec/`, returning a compact status. The driver holds only control state (stage pointer + verdicts).
- **Resumable** via an on-disk run manifest — crash on phase 40 of 60, restart from 40.
- **QA gates default on in the pipeline too** (skippable via `--no-qa`). **Self-healing gate:** on a validator failure, the writer gets one revision attempt from the verdict; still failing → pause/flag (never ships a bad spec).

**Sequence & gates:**
```
intake(interview)
  → foundations   [ *-writer → *-validator, skip-if-present ]
  → features      [ feature-writer → feature-validator  ×N ]
  → architecture  [ architecture-writer → architecture-validator ]
  → plan          [ plan-decomposer → plan-validator ]
  → implement     [ implementer (picks scope; [P] fan-out) → verify.sh build+test (driver-run) → implementation-validator (criteria/DoD); one self-heal on failure ]
  → reconcile     [ codebase-inspector audit → drift report ]
```

The same runtime is also the right home for large `/gspec-implement` runs. `/gspec-pipeline` (the markdown command) remains as the small-build + non-Claude-target fallback (context-lean, pure-routing, accepts a size ceiling, no resume).

---

## 9. Layer 5 — Hooks

Deterministic shell on lifecycle events, **no model judgment**. They upgrade *soft* conventions into *hard* floors. No hook is required to make v2 work; they are phased in.

| Hook | Event · matcher | Hard floor | Phase |
|---|---|---|---|
| **profile-agnosticism guard** | `PostToolUse` · Write/Edit on stack/practices/style/architecture | no leaked product/company identity → block/flag | near-term |
| **spec integrity check** | `PostToolUse` · Write/Edit on `gspec/*.md` | valid frontmatter + current `spec-version` | near-term |
| **QA-gate floor** *(opt-in only)* | `Stop`/`PostToolUse` · capability→`[x]` in `features/*.md` | a validator verdict exists on disk, else block | opt-in only |
| **skill-write guard** | `PreToolUse` · Write/Edit on committed skill files | block direct writes → force the reviewed pending-diff path | with loop |
| **feedback address-tag** | `PreToolUse` · Write on agent-memory/feedback | require a target+layer address tag | with loop |
| **subagent capture** *(opt)* | `SubagentStop` | snapshot return / trigger review | with loop |

Because QA gates are **optional** (on-by-default, opt-out), the **QA-gate floor ships opt-in only** — never a default; a team that wants hard enforcement enables it.

**Install mechanism:** the installer gains hook emission — drop hook scripts (a gspec-owned dir) and **merge** entries into `.claude/settings.json` (merge, never clobber; same spirit as the spec-sync `CLAUDE.md` snippet). Claude-only; other targets skip hooks and keep the equivalent rule as a soft instruction in the relevant convention skill.

**Principles:** (1) hooks enforce the *write*, never *do* the judgment; (2) the runtime obviates *sequencing* hooks (they matter most on the driver-less command/degraded paths); (3) judgment-requiring rules can't be hooks — that's what validators/`analyze`/`audit` are.

---

## 10. Worked orchestration flows

- **`/gspec-stack`** (slice-#1 template): interview → `stack-writer(brief)` → `stack-validator(stack.md)` → present verdict → on fail, converse + re-delegate to `stack-writer` (or human waives) → done.
- **`/gspec-audit`**: `codebase-inspector` returns drift + orphans → present each one-at-a-time → apply a surgical edit, or delegate `feature-writer` for an orphan PRD → each written/edited spec passes its validator before close.
- **`/gspec-research`**: fan out `competitor-researcher` across N competitors → synthesize + walk findings with the user → `research-writer` produces research.md → accepted findings become PRDs via `feature-writer` (each gated by `feature-validator`).
- **`gspec pipeline`**: as in Layer 4 — each bracketed stage is one isolated headless run; the node driver advances the manifest between them.

---

## 11. Build & install changes

**Source tree**
```
skills/personas/*.md      persona brains
skills/conventions/*.md   shared house rules
agents/*.md               task-agents (declare skills:/tools/model)
commands/*.md             thin /gspec-* entry points
manifest.js               per-artifact metadata (class, name, description, preloaded skills, tools, model) — replaces build.js's single COMMANDS map
bin/ (runtime driver)     gspec pipeline orchestrator + run-manifest/state layer + headless spawning
hooks/*                   hook scripts (near-term first)
```

**`emitters.js`** gains an **artifact-class dimension** (emit skills, agents, commands) plus **hook emission** (settings.json merge). Per target:

| Target | Skills | Agents | Commands | Hooks |
|---|---|---|---|---|
| **Claude Code** | `.claude/skills/<n>/SKILL.md` | `.claude/agents/<n>.md` | `.claude/commands/` | `.claude/settings.json` merge |
| Cursor | `.cursor/commands/*.mdc` (agent collapsed in) | — collapse → command | `.cursor/commands/*.mdc` | — |
| Antigravity | `.agent/skills/<n>/SKILL.md` | — collapse → skill | (skill) | — |
| Codex | `.agents/skills/<n>/SKILL.md` | — collapse → skill | (skill) | — |
| OpenCode | `.opencode/skills/<n>/SKILL.md` | — collapse (native agents: revisit) | `.opencode/commands/*.md` | — |

The 12 `/gspec-*` names and the `gspec/*.md` doc set are preserved throughout.

---

## 12. Execution plan

1. **Plumbing + slice #1.** `manifest.js` + emitters artifact classes, then the **`stack` vertical**: skills `gspec-architect` (+ quality bar) & `gspec-qa`; the convention skills the slice needs; agents `stack-writer` + `stack-validator`; command `/gspec-stack` + `/gspec-qa stack`. This is the template; it's the heaviest slice because it carries the plumbing. Later slices are cheap.
2. **Remaining personas → writers → validators → commands** (profile, feature, style, practices, architect, research).
3. **Investigators/transformers** → `analyze` / `audit` / `migrate` / `research` / `implement`.
4. **Near-term hooks** (agnosticism guard, integrity check).
5. **Runtime (`gspec pipeline`)** — built last; it orchestrates everything else.
6. *(Later phase)* **Hardening**: QA-gate hook, then the learning loop + its hooks + the distiller + the `gspec-orchestrator` judgment skill.

---

## 13. Deferred / future

- **Learning loop ("training") — the next build. Recorded plan, not yet built.** Turns the dormant per-agent `memory:` silos (already keyed by agent name, `memory: project`) into a producer≠checker-style improvement loop where agents get better across runs. Sequenced:
  - **T1 — Activate per-agent memory.** Give each agent a `MEMORY.md` convention and a capture path so a run's lessons persist into its silo. Gate every write behind the **feedback address-tag** hook (§9): a memory carries a target+layer address so it's attributable, scoped, and reversible — never an anonymous blob.
  - **T2 — The distiller.** A step/agent that reads an agent's accumulated memory and proposes a **reviewed skill diff** (memory → a concrete change to the persona/convention skill), *never* a silent auto-edit. Ships behind the **skill-write guard** hook (§9): direct writes to committed skill files are blocked, forcing the reviewed pending-diff path. Producer≠checker holds — the distiller *proposes*; a human (or a checker agent) *approves* before a skill changes.
  - **T3 — `gspec-orchestrator` "mini-me" skill.** A trainable judgment skill the pipeline preloads to make the scope / granularity / fan-out calls the driver currently hard-codes in `bin/pipeline.js`, improved over time by the same distiller loop.
  - **T4 — Loop hooks.** The three §9 "with loop" hooks land here: **skill-write guard** (enables T2), **feedback address-tag** (enables T1), and **subagent capture** (`SubagentStop` → snapshot the return / trigger review) to feed the loop.
- **Enforcement hooks** beyond near-term (QA-gate floor + the three loop hooks).
- **Implementation verification gate (`implementation-validator`)** — **✅ built (this branch).** The producer≠checker for code (supersedes the vague "code-reviewer" idea). A two-part gate that honors `--no-qa`; this bullet is the as-built contract:
  - **Deterministic part — build + test only** (not the full lint/typecheck/practices pipeline, for now). Multi-deployable / polyglot aware: one project may ship e.g. a TypeScript frontend + a Java backend, each with its own toolchain and working dir. The **deployables table** (name · dir · build · test) lives in **`architecture.md`**, *not* `stack.md` — stack is the tooling *palette* (what *could* build/test; portable, profile-agnostic), architecture is the concrete structure (what *does* exist; technology-aware; already owns Project Structure + Project Setup). The `implementer` generates a committed **`verify.sh`** from that table during scaffolding — fail-fast, prints `FAIL: <deployable>:<phase>`, hand-editable for setup a command-list can't express (test DB, env, `docker compose`). The **pipeline driver runs `bash verify.sh`** deterministically (exit code = the gate); on failure it re-delegates the `implementer` with the concrete errors — the strongest self-heal loop in the pipeline.
  - **Judgment part** — the `implementation-validator` agent (preloads `gspec-qa` + `gspec-engineer`/`gspec-practices`) interprets failures and checks that the in-scope acceptance criteria + Definition of Done are actually met (summarize test logs, don't dump them).
  - **`gspec-architect` quality bar gains:** a multi-deployable system must define the deployables / build-test table. **`gspec-audit`** catches drift between that table (+ `verify.sh`) and the actual code.
  - Optionally backed by the opt-in QA-gate-floor hook: block marking a capability `[x]` unless build+test passed.
- **Review deferred decisions after production** — a step added to every producer command flow: after the writer returns, present any **deferred decisions / notable assumptions** it recorded, **one at a time**, and offer to **resolve** (re-delegate a revision with the answer) or **accept** the deferral. Closes the loop for questions the front-loaded interview couldn't anticipate — the agent discovers them *while writing*, and a labeled deferral won't be flagged by QA (validators treat it as intentional), so an explicit review is the only place it gets back to the user. Prompt-level change to the command bodies — no new plumbing. **In the autonomous pipeline** there's no user to ask mid-run, so instead collect all deferred decisions across stages and surface them in the **final assumptions report** (makes that report load-bearing).

---

## 14. Decisions log (forks resolved)

| # | Decision | Resolution |
|---|---|---|
| 1 | SDD-framework alignment | Not a driver; ambient reference only (blend framing retracted) |
| 2 | Scope | Structure-first; defer the learning loop |
| 3 | Agent model | Bounded sub-jobs (not 1:1 command→agent) |
| 4 | Producer/validator granularity | One per spec type; investigators singular; `implementer` = one agent + scope param |
| 5 | Multi-target | Claude-first, degrade gracefully |
| 6 | Quality Assurance | Added; gate is **optional, on by default (opt-out)** — `--no-qa`/config skips, `/gspec-qa` always on-demand; enforcement hook is opt-in only |
| 7 | First slice | `stack` write+validate+gate |
| 8 | Pipeline behavior | Front-load then autonomous; idea → built (adaptive) |
| 9 | Pipeline execution | Deterministic orchestration **script/runtime**, not a command |
| 10 | Hooks | First-class Layer 5, phased |

## 15. Open questions

- Fold `gspec-practices` into `gspec-engineer`/`gspec-architect`, or keep standalone?
- Keep `plan-validator` and a `research-validator`, or treat those as optional?
- Command emission on Claude: dedicated `.claude/commands/*` files vs. relying on skill auto-invocation for the `/gspec-*` trigger (backward-compat detail to settle during plumbing).
- Exact on-disk location/format for validator verdicts (feeds the QA-gate hook) — e.g. `.gspec/verdicts/<spec>.json`.
