---
spec-version: v1
---

# How It Works Page

## Overview

A dedicated page explaining gspec's v2 architecture — the agent-team model that makes everything else possible. It presents the five layers (skills, agents, commands, runtime, hooks) around a single organizing idea, then explains the two properties that most set gspec apart: the producer ≠ checker quality model and the self-improving learning loop.

Where the build page shows *what* the autonomous build does, this page explains *why* it produces trustworthy output. It gives technically-minded evaluators the mental model behind the product and a reason to believe the quality claims.

## Users & Use Cases

**Primary users:** Technically-minded developers evaluating gspec who want to understand the architecture, not just the pitch.

1. **Understanding the model** — A visitor learns the five layers and how they relate, via the "brains / hands / conversations / driver / floors" framing.
2. **Believing the quality claims** — A skeptical reader learns that producers never grade their own work and that gates are backed by deterministic checks.
3. **Grasping the learning loop** — A visitor sees how corrections become durable skill improvements rather than one-off fixes.

## Scope

### In Scope

- A dedicated, linkable page presenting the five-layer architecture
- A hero stating the organizing principle in plain language
- A per-layer breakdown with a short description and a representative count for each layer
- A producer ≠ checker section explaining the quality model
- A learning-loop section (capture → distill → improve)
- A "Claude-first, degrade gracefully" note linking to platform capabilities
- Inline caveats on any capability whose support is not uniform across harnesses (the runtime/autonomous build, the enforcement hooks, the hard-enforcement side of the quality gate, and the learning loop), each linking to the platform capabilities page
- Cross-links to the build page and platform capabilities
- Navigation entries (primary nav + footer)

### Out of Scope

- Exhaustive enumeration of every skill, agent, and hook by name (belongs in the repo/docs)
- API-level or code-level architecture reference
- Contribution or extension-authoring guidance

### Deferred

- An interactive architecture diagram
- A dedicated learning-loop deep-dive page

## Capabilities

### Organizing-Principle Hero

- [x] **P0**: Page leads with the agent-team framing
  - States the "skills are brains, agents are hands, commands are conversations, runtime is the driver, hooks are the hard floors" principle in plain language

### Five-Layer Breakdown

- [x] **P0**: Page presents all five layers
  - Each layer has a name, a one-line role, a short description, and a representative count
  - Layers are visually distinct and legible at a glance

### Producer ≠ Checker

- [x] **P0**: Page explains the quality model
  - Communicates that the writing agent is never the approving agent
  - Notes that validators are read-only and that gates are backed by deterministic checks

### Learning Loop

- [x] **P1**: Page explains how gspec improves over time
  - Presents the capture → distill → improve flow
  - Frames corrections as durable skill improvements

### Harness-Support Caveats

- [x] **P0**: Capabilities that are not uniform across harnesses are caveated in place
  - Each harness-limited capability (runtime/autonomous build, enforcement hooks, the hard-enforcement side of the quality gate, and the learning loop) carries a visible caveat rather than implying uniform support
  - Every caveat links to the platform capabilities page for the harness-by-harness detail
  - Caveats are visually consistent and do not overwhelm the primary explanation

### Discovery & Navigation

- [x] **P0**: The page is reachable from site navigation
  - Primary navigation and footer include a link to this page
  - Cross-links to the build page and platform capabilities are present
  - Active-page navigation state is consistent with other pages

### Responsive Layout

- [x] **P1**: The page renders correctly across screen sizes
  - Layer breakdown, quality-model grid, and learning-loop flow adapt without horizontal overflow

## Dependencies

- **Platform Capabilities** (`platform-capabilities.md`) — The "Claude-first" note links there.
- **Build Page** (`build-page.md`) — Cross-linked; how-it-works explains the architecture, the build page shows it running.

## Assumptions & Risks

### Assumptions

- The five-layer model is stable enough to present publicly.
- Representative counts (13 skills, 23 agents, 15 commands, etc.) are accurate at publish time and maintained as the framework evolves.

### Risks

- **Counts drift** — Skill/agent/command counts change as the framework grows. *Mitigation:* Present them as representative figures and update alongside releases.
- **Too abstract** — An architecture page can lose non-expert readers. *Mitigation:* Lead with a plain-language principle and keep each layer to a short description.

## Success Metrics

1. **Engagement** — Visitors who scroll through the full layer breakdown.
2. **Click-through** — Visitors who continue to the build page or platform capabilities.

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md`, `gspec/style.md`, `gspec/stack.md`, and `gspec/practices.md` to resolve project-specific context.
