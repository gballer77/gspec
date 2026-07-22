# gspec harness parity: filling the Claude-only gap

**Status (2026-07-21):** Claude Code is the only full-fidelity target. This doc records, per remaining harness, what it would take to close the gap, at two investment levels: the **cheap way** (reuse the engine-agnostic runtime plus inlined instructions) and the **right way** (harness-native hard enforcement and memory). Platform facts were verified against vendor and community docs in July 2026; all of these tools move fast, so re-verify the load-bearing cells before building.

## What the gap is

Every non-Claude harness already gets the spec-authoring surface (skills, agents or their inlined equivalent, commands or workflows) and the autonomous build where an engine adapter exists. The Claude-only column reduces to two systems:

1. **Deterministic enforcement floors.** The hook guards that turn soft conventions into hard floors: `spec-integrity`, `profile-agnosticism`, `task-immutability`, `skill-write-guard`, `practices-enforce`, the `reconcile` nudge, and the memory `address-tag`. Every one of them governs a **file write** under `gspec/`, `.claude/skills/`, or the task files.
2. **The learning loop.** Per-agent **memory silos**, feedback-driven **capture**, and `/gspec-distill` promotion of lessons into source skills.

## Two strategies

There are two independent ways to deliver each, and they compose.

### Path A: runtime-native (engine-agnostic, no harness features)

gspec's build runtime (`lib/build.js`) already drives each stage as an isolated headless run and, for non-Claude engines, **injects the agent persona into the prompt** (`lib/engines.js`, `inject()` / `readInjectedAgent()`). That injection seam is the whole opening:

- **Memory:** before a stage runs, read a runtime-owned silo (for example `.gspec/agent-memory/<agent>/MEMORY.md`) and inject it ahead of the persona. This reproduces Claude's `memory:` auto-load with no native memory feature.
- **Capture:** the build already records QA-feedback learnings (the "Learnings recorded this run" report, `reportLearnings` in `lib/build.js`). Extend it to append a tagged lesson to that silo when a stage received corrective feedback.
- **Distill:** `/gspec-distill` is just an agent reading silo files and proposing edits, so it is already portable once silos exist.
- **Enforcement (build path only):** the driver runs the writer/validator QA gates and `verify.sh` itself, deterministically, on every engine. That is enforcement with no harness hook.

**Prerequisite:** the harness must be a **build engine** (headless-invocable, wired in `lib/engines.js`). Today only Claude, Codex, and Pi are. Cursor, OpenCode, and Antigravity all ship headless CLIs, so adding adapters is straightforward. Path A covers only the autonomous build path, not interactive `/gspec-*` use.

### Path B: harness-native (covers the interactive path)

Reproduce the floors and the memory silo using each harness's own hook or extension system. Feasibility varies more than expected, because the harnesses differ sharply in whether their hooks can observe a **file write**.

## Verified platform capabilities (July 2026)

| Harness | File-write hook? | Tool-interception model | Native per-agent memory | Headless engine |
|---|---|---|---|---|
| **Claude Code** | Yes (Pre/PostToolUse on Write/Edit) | Any tool | Yes (`memory:` silos) | Yes (wired) |
| **Codex** | **No** (hooks fire on Bash only) | Bash only; PreToolUse `deny`, PostToolUse audit + `additionalContext` | No (AGENTS.md instructions) | Yes (wired) |
| **Cursor** | **Yes** (`onPreEdit` / `onPostEdit`) | Editor-event hooks | No (rules / AGENTS.md) | Yes (`cursor-agent -p`) |
| **OpenCode** | **Yes** (plugin tool-execution interception) | Any tool, via 25+ lifecycle events | No (community "mem" plugins) | Yes (`opencode run`) |
| **Pi** | **Yes** (`tool_call` block/modify) | Any tool, via the extension API | No (episodic-memory extensions exist) | Yes (wired, via `pi-subagents`) |
| **Antigravity** | **Yes** (JSON hooks incl. after-file-edit) | Before-tool / after-edit / session-start | No | Yes (`agy -p`) |

The decisive cell is **file-write hook**. Where it is "Yes", the existing `.mjs` guards port with hard-block (or advisory) semantics intact. Where it is "No" (Codex), harness-native enforcement of gspec's floors is impossible and the right way becomes an MCP write-mediator.

## Per-harness plan

### Codex: the hard case
- **Current:** native TOML sub-agents; build engine; hooks exist but fire on the Bash tool ONLY (both Pre and Post), so no gspec floor (all file-write) can run as a Codex hook.
- **Cheap way:** Path A. Runtime injection for memory + capture; the driver's QA gates cover build-path enforcement; the floors stay inlined in the composed agent bodies for the interactive path. No Codex-feature dependency, and largely already true.
- **Right way:** an **MCP write-mediator** server. Codex governs MCP tools at the server boundary, so routing spec writes through a gspec MCP tool is the only route to true deterministic file-write enforcement on Codex. Largest lift; benefits any MCP-capable harness.
- Note: the one floor that could port is `subagent-capture` (Codex has a `SubagentStop` event), but the runtime already captures verdicts, so it adds little.

### Cursor: closest to native parity
- **Current:** native sub-agents, skills, commands, and hooks (Feb 2026); not yet a build engine.
- **Cheap way:** add a Cursor engine adapter (`cursor-agent -p`) so Path A applies, and keep the inlined floors.
- **Right way:** port the guards to **Cursor hooks** (`onPreEdit` / `onPostEdit`), which DO observe file edits, so the write-guards keep their hard-block semantics (unlike Codex). Adapt each `.mjs` guard to Cursor's event payload and register them in the Cursor hooks config. No native memory silo, so keep the runtime-managed silo (Path A) even in the right-way build.

### OpenCode: plugin-complete
- **Current:** native sub-agents (persona inlined), skills, commands; not yet a build engine.
- **Cheap way:** add an OpenCode engine adapter (`opencode run`) for Path A, plus inlined floors.
- **Right way:** a **gspec OpenCode plugin** (JS/TS). The plugin SDK intercepts tool execution (block or validate writes) across 25+ lifecycle events and can persist memory snapshots, so both the floors and a real memory silo land in one plugin. Ship it as an install prerequisite.

### Pi: extension-complete
- **Current:** sub-agents via the `pi-subagents` extension (already a prerequisite); build engine.
- **Cheap way:** Path A (runtime injection is already how Pi receives its persona), plus inlined floors.
- **Right way:** a **gspec Pi extension** (TypeScript). The extension API's `tool_call` hook blocks or modifies any tool call (a true pre-write block, matching Claude), and Pi already has episodic-memory extensions (MEMORY.md + JSONL retrieval) to adopt or fork for the learning loop. This is the fullest non-Claude parity available; the cost is building and maintaining the extension.

### Antigravity: workflows plus native hooks
- **Current:** no agent files (sub-agents are spawned at runtime), so gspec ships skills + one self-contained workflow per capability; not a build engine; QA is self-review folded into the workflow.
- **Cheap way:** add an `agy -p` engine adapter for Path A where the workflow model allows, plus the floors already inlined in the workflows.
- **Right way:** Antigravity has JSON lifecycle hooks (including after-file-edit) honored in headless runs via `settings.json`, so the write-guards port similarly to Cursor. No native memory silo, so keep the runtime-managed silo.

## Recommended phasing

1. **Path A on every build engine (Codex and Pi now; add Cursor / OpenCode / Antigravity adapters).** One code change (`lib/build.js` + `lib/engines.js`) closes the learning-loop gap on the build path across all engines with no harness dependency. Highest leverage per unit of work.
2. **Right-way harness-native enforcement, cheapest-first:** Cursor and Antigravity (native file-edit hooks, guards port with light payload adaptation), then OpenCode and Pi (a plugin / extension each, more work but full memory + enforcement), then Codex (MCP write-mediator, the largest lift and the only Codex option).
3. Keep the inlined-instruction floors as the universal baseline on the interactive path until each harness-native piece lands.

## Caveats

- Only Claude has hard enforcement on BOTH the interactive and build paths today. Path A gives every build engine hard enforcement on the build path; the interactive path stays instruction-only until Path B lands per harness.
- Memory silos are runtime-managed (filesystem) on every non-Claude harness; none has a Claude-style per-agent silo natively (OpenCode and Pi can approximate one via a plugin / extension).
- These platforms change monthly. Re-verify the "file-write hook?" and "tool-interception" cells before building, since they decide whether the right way is native hooks or an MCP / plugin detour.

## Sources (verified July 2026)

- Codex hooks (Bash-only, `deny` / `additionalContext`): [DeepWiki: openai/codex hooks](https://deepwiki.com/openai/codex/3.11-hooks-system), [Codex CLI Hooks reference](https://agenticcontrolplane.com/blog/codex-cli-hooks-reference), [Codex CLI Hooks complete guide](https://codex.danielvaughan.com/2026/04/15/codex-cli-hooks-complete-guide-events-policy-patterns/)
- Cursor hooks / headless CLI: [Cursor headless CLI docs](https://cursor.com/docs/cli/headless), [Cursor Agent CLI](https://cursor.com/blog/cli)
- OpenCode plugins / headless: [OpenCode plugins docs](https://opencode.ai/docs/plugins/), [OpenCode plugin development guide](https://lushbinary.com/blog/opencode-plugin-development-custom-tools-hooks-guide/)
- Pi extension API / memory: [DeepWiki: pi extension API](https://deepwiki.com/earendil-works/pi/6.1-extension-api-and-lifecycle-events), [Pi extensions docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- Antigravity CLI hooks / headless: [Antigravity CLI guide](https://www.aibuilderclub.com/blog/antigravity-cli-guide), [Antigravity CLI deep dive](https://agentpedia.codes/blog/antigravity-cli-deep-dive)
