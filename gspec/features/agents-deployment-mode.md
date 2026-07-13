---
spec-version: v1
---

# Agents Deployment Mode

## Overview

An opt-in "hybrid" deployment mode that emits gspec's heavy, one-shot *producer* commands (research, feature, architect, plan, implement) as Claude Code **subagents** while keeping interactive and always-on commands as **skills** in the main session. The default install behavior is unchanged — the new mode is selected explicitly at install time.

When the full gspec pipeline runs in one session (research → feature → architect → plan → implement), every phase's output, file reads, and test logs accumulate in a single context window. Long autonomous builds degrade from this "context rot" and re-process a growing transcript. Subagents solve this: each runs in its own fresh context window and returns only a summary to the parent, so heavy per-phase work never lands in the orchestrating session. Producers benefit from that isolation; interactive commands (analyze, audit, profile, style, etc.) need the conversational main-session flow and must stay as skills.

## Users & Use Cases

**Primary users:** Developers using gspec with Claude Code who want to run long, autonomous build pipelines without context degradation.

1. **Long autonomous build** — A developer running `gspec-implement` across a large feature wants the implementation phase to spawn in a fresh context window so research, architecture, and plan transcripts don't crowd the implementer's working memory.
2. **Multi-phase pipeline** — A developer chaining research → feature → architect → plan → implement wants each producer to run in isolation, returning only the artifact path and a brief summary to the orchestrating session.
3. **First-time installer with default expectations** — A developer running `npx gspec` for the first time gets the same skills-only install they get today; the new mode never activates by accident.
4. **Scripted / CI install** — An automation script passes `--mode hybrid` (or `--agents`) on the command line and gets a deterministic agent-emitting install without an interactive prompt.
5. **Re-install on an existing project** — A developer who previously chose hybrid mode re-runs `npx gspec` and the same mode is re-applied automatically from persisted project config.

## Scope

### In Scope

- A second deployment mode ("hybrid") selectable at install time, in addition to the existing "skills-only" default.
- An interactive prompt at setup offering the mode choice when the target platform supports agents.
- A non-interactive `--mode skills|hybrid` flag (with `--agents` as an alias for `--mode hybrid`).
- A declarative classification on each command's source definition that labels it as a *producer* or *interactive* command.
- An emitter path that, in hybrid mode, writes producer commands to the platform's agents directory (Claude Code: `.claude/agents/`) with agent-shaped frontmatter and a rule-based body adaptation.
- A per-agent default tool scope and model setting, editable in one place.
- Per-platform capability data (`supportsAgents: true|false`) so adding agent support to a new platform later is a data change, not new branching logic.
- Persistence of the selected mode in gspec's existing per-project install metadata so re-installs are consistent.
- Documentation describing the mode, the flag, and the producer/interactive classification.

### Out of Scope

- Converting any interactive command (analyze, audit, profile, style, stack, practices, migrate) into an agent.
- Replacing the slash-command UX for any skill.
- Building the orchestrator / "lead" command that delegates to these producer agents — tracked as a separate feature.
- Agents support on non–Claude-Code platforms (Cursor, Antigravity, Codex, Open Code). Hybrid mode is Claude-Code-only in this version.
- Changes to how `gspec/` specs themselves are read or written.
- Changes to spec sync behavior — sync remains a main-session concern; this feature only verifies it still operates correctly after a producer subagent returns.

### Deferred

- Allowing user-authored extensions to declare `deployAs: producer` and be emitted as agents in hybrid mode.
- Hybrid mode for additional platforms once their subagent equivalents are stable.
- Per-command CLI overrides for the producer/interactive classification at install time.

## Capabilities

### Mode Selection at Install

- [ ] **P0**: The installer offers an opt-in deployment mode, defaulting to current skills-only behavior
  - Running the installer with no mode flag and no interactive selection produces output byte-for-byte equivalent to the current install on the same platform.
  - The `--mode skills` and `--mode hybrid` flags select the mode non-interactively; `--agents` is accepted as an alias for `--mode hybrid`.
  - When neither flag is passed and the installer is running interactively on an agent-capable platform, the user is prompted with a two-option choice (skills-only vs hybrid).
  - When neither flag is passed on a non-agent-capable platform, no mode prompt is shown and skills-only is used.

- [ ] **P0**: Hybrid mode requested on a platform that does not support agents falls back safely
  - The installer prints a clear warning naming the platform and the reason for the fallback.
  - The install proceeds in skills-only mode for that platform rather than failing.
  - The exit status indicates success, not error.

### Producer / Interactive Classification

- [ ] **P0**: Each command's source definition carries a single declarative classification (producer vs interactive)
  - The classification lives in exactly one place per command (e.g. a frontmatter field on the command source, or a single central manifest) — not duplicated in the emitter logic.
  - The classification reflects this split: `gspec-research`, `gspec-feature`, `gspec-architect`, `gspec-plan`, and `gspec-implement` are producers; `gspec-profile`, `gspec-style`, `gspec-stack`, `gspec-practices`, `gspec-analyze`, `gspec-audit`, and `gspec-migrate` are interactive; spec sync remains a main-session runtime behavior.
  - The emitter reads the classification at build time; changing a command's role does not require editing the emitter.

- [ ] **P1**: Per-platform agent-capability is data, not branching code
  - Each platform target declares a single `supportsAgents` boolean (or equivalent capability descriptor).
  - The emitter consults this descriptor; adding a new platform with agent support later requires only a data change.

### Producer Emitter (Hybrid Mode)

- [ ] **P0**: In hybrid mode on an agent-capable platform, producer commands are emitted to the platform's agents directory with agent-shaped frontmatter
  - Each producer file is written to the platform's agents directory (Claude Code: `.claude/agents/<name>.md`) instead of the skills directory.
  - Frontmatter contains: `name` (the command name, keeping the `gspec-` prefix for namespacing), a delegation-oriented `description` (so an orchestrator can decide when to spawn it), a scoped `tools` list, and a `model` setting.
  - Interactive commands in the same install continue to be emitted to the skills directory unchanged.

- [ ] **P0**: Each producer agent has a sensible default tool scope, editable in one place
  - `gspec-research`: read/search, web search, web fetch, write.
  - `gspec-feature`: read/search, write, edit.
  - `gspec-architect`: read/search, write, edit, shell.
  - `gspec-plan`: read/search, write, edit.
  - `gspec-implement`: read/search, write, edit, shell.
  - Defaults are defined in a single configuration surface and can be overridden per-command without modifying the emitter.

- [ ] **P1**: Each producer agent has a sensible default model setting
  - The default model setting for all producer agents is `inherit`.
  - A per-command override is supported (so, for example, `gspec-architect` could be pinned to a larger model) from the same single configuration surface as the tool scope.

- [ ] **P0**: Producer agent bodies are adapted, not just re-headered, so they work under autonomous delegation
  - Mid-run interactive Q&A is removed: when essential information is missing, the agent stops and reports what it needs rather than asking and waiting.
  - Instructions to invoke other `/gspec-*` slash commands are removed; producers read inputs from `gspec/` and write outputs to `gspec/`.
  - In-line approval steps (e.g. proposing a research outline, breaking a request into multiple features) are converted into "produce the artifact and report it for approval" — the gate moves up to the orchestrator/human.
  - Each producer ends with a concise summary plus the artifact path(s) for the parent.
  - The role-prompt content beyond these rule-based adaptations is preserved from the existing source command body — no per-command hand rewrite.

- [ ] **P0**: Skills-only mode and non-agent platforms are unaffected
  - In skills-only mode on any platform, producers are emitted as skills exactly as today.
  - In hybrid mode on a non-agent platform, the fallback in P0 above applies and producers are emitted as skills.
  - Interactive commands and spec-sync rules are emitted identically in both modes.

### Mode Persistence

- [ ] **P0**: The selected deployment mode is persisted in gspec's per-project install metadata
  - After a successful install, the chosen mode is recorded somewhere durable in the project (existing per-project config if one exists, otherwise a minimal added record).
  - Re-running the installer with no mode flag re-applies the persisted mode automatically.
  - When the installer is invoked with a `--mode` flag that disagrees with the persisted value, the flag wins and the persisted value is updated.

### Interaction Verification

- [ ] **P0**: Spec sync still operates after a producer subagent run
  - When a producer subagent writes a new or modified file under `gspec/`, the main-session sync rules detect and reconcile the change after the subagent returns.
  - A verification step (test or documented observation) confirms this behavior; any regression is surfaced explicitly.

- [ ] **P1**: Save / restore / playbooks are unaffected
  - Existing save, restore, and playbook flows operate on `gspec/` specs and do not depend on the installed command format; they work identically in skills-only and hybrid modes.

- [ ] **P1**: `gspec-migrate` continues to work in a hybrid-mode project
  - `gspec-migrate` remains a skill in both modes and operates correctly on a project installed in hybrid mode.

### Documentation

- [ ] **P0**: Project documentation describes the mode, the flag, and the classification
  - The README (or equivalent installer docs) describes the two modes, the interactive prompt, the `--mode` / `--agents` flag, and the platform scoping (Claude Code only in this version).
  - The producer-vs-interactive classification is documented so users can predict which commands become agents.
  - Documentation notes that in hybrid mode an orchestrator delegates to `gspec-*` agents via the platform's Agent tool, whereas in skills mode it invokes them as slash commands.

## Dependencies

- **Existing build/installer transform** — This feature extends the current source-to-platform emitter (the transform that writes `.claude/skills/`, `.cursor/commands/`, etc.). No new parallel system; the existing emitter is the integration point.
- **Existing per-project install metadata (if any)** — Mode persistence reuses whatever per-project config gspec already maintains. If none exists, a minimal record is added.
- **Orchestrator / "lead" command (separate feature, out of scope here)** — In hybrid mode the orchestrator is the natural caller of the emitted producer agents. This feature makes the agents *available*; the orchestrator that delegates to them is tracked separately.
- **External dependencies** — None beyond the platforms gspec already targets.

## Assumptions & Risks

### Assumptions

- The existing build/installer emitter is the correct place to extend; a parallel system is not warranted.
- Subagents on the target platform run in their own fresh context window and return only a summary to the parent — this is what makes the isolation worthwhile.
- Subagents cannot invoke slash commands; producer bodies must read from and write to `gspec/` instead of calling `/gspec-*`.
- The classification of each existing command (producer vs interactive) as listed in §Capabilities is correct and stable for this version.
- Among current platform targets, only Claude Code has a stable subagents concept; other targets keep their existing skills/commands format.

### Risks

- **Producer body adaptation drift** — Rule-based body rewrites (removing mid-run Q&A, converting approvals into report-and-stop) could miss edge cases in a specific producer and leave an instruction that doesn't make sense for autonomous delegation. *Mitigation:* keep the adaptation rules small, well-documented, and easy to audit; provide a verification step that diffs the emitted agent body against the source command for each producer.
- **Spec sync regression after subagent writes** — A subagent writing under `gspec/` from its own context might not trigger the main session's sync reconciliation. *Mitigation:* explicit verification step (P0 capability above); if broken, flag and resolve before release.
- **User confusion between modes** — Developers who install in one mode and expect commands of the other mode (e.g. typing `/gspec-implement` in a hybrid install) may be surprised. *Mitigation:* clear README description of which commands are slash-invocable vs delegated in each mode; consistent `gspec-` prefix across both modes for predictability.
- **Tool scope too narrow or too broad** — Default tool scopes per producer may not match real usage. *Mitigation:* keep defaults editable in one place; revisit after first real autonomous runs.
- **Persistence conflicts** — If a project's persisted mode and a passed flag disagree, the wrong precedence rule could surprise users. *Mitigation:* documented rule — flag wins and updates the persisted value.

## Success Metrics

1. **Default install parity** — `npx gspec --target claude` with no mode flag produces output byte-for-byte equivalent to the pre-feature install on the same platform. Measured by a deterministic diff against a known-good fixture.
2. **Producer isolation in hybrid mode** — A full producer pipeline run (research → feature → architect → plan → implement) in hybrid mode keeps the orchestrating session's context substantially smaller than the same pipeline run in skills-only mode. Measured qualitatively at first; eventually by recorded transcript size.
3. **Mode persistence correctness** — Re-running the installer on a project previously installed in hybrid mode, with no flag, produces a hybrid install (no regression to skills-only); re-running with `--mode skills` flips the mode and updates the persisted record. Measured by an automated install/re-install test.
4. **Fallback safety on non-agent platforms** — Requesting `--mode hybrid` on a non-agent-capable platform succeeds with a warning and emits a skills-only install. Measured by an automated install test per platform.

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
