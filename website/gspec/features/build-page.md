---
spec-version: v1
---

# Build Page

## Overview

A dedicated marketing page for gspec's headline 2.0 capability: the autonomous build pipeline (`/gspec-build`). It explains, in plain terms, that gspec can take a plain-language idea and drive the whole workflow — specs, plan, and code — as a deterministic, resumable run with quality gates at every stage.

The autonomous build is the single biggest thing that changed between v1 and v2, and before this page it had nowhere to live on the site. The home page can only tease it; prospective users evaluating gspec against other agentic-SDD tools need a page that makes the pipeline, its reliability model, and its platform availability legible.

## Users & Use Cases

**Primary users:** Developers evaluating gspec who want to understand what "autonomous build" actually means and whether they can trust it.

1. **Understanding the pitch** — A visitor arrives from the home page or nav and learns what `/gspec-build` does at a glance: one intake, a pipeline runs, a working product.
2. **Assessing trust** — A skeptical developer wants to know how an autonomous run avoids shipping garbage. They read the reliability model — isolated agents, producer ≠ checker gates, verify.sh, resumable runs.
3. **Checking availability** — A developer on a specific harness checks whether the build runs on their tool and links through to the platform capabilities page.

## Scope

### In Scope

- A dedicated, linkable page for the autonomous build
- A hero framing the "idea to built product" value proposition and the `/gspec-build` entry point
- A section showing the two ways to run the build — from the coding harness (`/gspec-build`) and as a headless script (`gspec build`) — and that the idea can be passed directly as an argument or captured via the intake interview
- A visual pipeline diagram showing the nine stages, grouped into phases, noting skip-if-present foundation
- A reliability section explaining the mechanisms that make a long autonomous run trustworthy
- A "where it runs today" section naming the harnesses with a wired engine and linking to platform capabilities
- Navigation entries (primary nav + footer) and a home-page section linking to this page

### Out of Scope

- Step-by-step build tutorials or command flags (belongs in docs / getting-started)
- Live demos or recorded terminal sessions
- Per-harness engine setup instructions

### Deferred

- An interactive/animated pipeline walkthrough
- Case studies or example builds

## Capabilities

### Value-Proposition Hero

- [x] **P0**: Page leads with the autonomous-build value proposition
  - Communicates "idea to built product" and the `/gspec-build` entry point
  - Includes a copyable install/entry command
  - Offers a path onward to how-it-works and platform capabilities

### Invocation Modes

- [x] **P1**: Page shows how to start a build
  - Presents both entry points: the slash command inside a coding harness and the headless `gspec build` script
  - Shows that the idea can be passed directly as an argument, with the intake interview as the fallback when it's omitted
  - Notes the script options that matter most (engine selection, resume)

### Pipeline Diagram

- [x] **P0**: Page presents the nine-stage pipeline visually
  - All nine stages appear in order, grouped into meaningful phases
  - Skip-if-present foundation behavior is communicated
  - The diagram is legible at a glance and adapts to narrow viewports

### Reliability Model

- [x] **P0**: Page explains why an autonomous run can be trusted
  - Covers isolated agent runs, producer ≠ checker quality gates, the verify.sh build-and-test gate, resumable runs, the continuation loop, and the learnings report
  - Framed in plain language, not internal jargon

### Platform Availability

- [x] **P1**: Page states where the build runs today
  - Names the harnesses with a wired engine (Claude Code, Codex, Pi)
  - Links to the platform capabilities page for the full picture

### Discovery & Navigation

- [x] **P0**: The page is reachable from site navigation
  - Primary navigation and footer include a link to this page
  - The home page links through to this page
  - Active-page navigation state is consistent with other pages

### Responsive Layout

- [x] **P1**: The page renders correctly across screen sizes
  - Hero, pipeline diagram, and reliability grid adapt without horizontal overflow
  - The pipeline stages stack cleanly on mobile

## Dependencies

- **Home Page** (`home-page.md`) — A home-page section links here.
- **Platform Capabilities** (`platform-capabilities.md`) — This page links there for the harness-by-harness build availability picture.
- **How It Works** (`how-it-works-page.md`) — Cross-linked; the build page shows the pipeline, how-it-works explains the architecture behind it.

## Assumptions & Risks

### Assumptions

- The nine-stage pipeline and its grouping are stable enough to present publicly.
- Naming the three harnesses with wired engines is accurate at publish time and maintained alongside the parity reference.

### Risks

- **Overpromising autonomy** — "Autonomous" can read as "unattended and perfect." *Mitigation:* The reliability section explicitly frames gates that pause the run rather than shipping broken work.
- **Engine availability drifts** — The set of harnesses with wired engines can change. *Mitigation:* Defer detail to the maintained platform capabilities page and link to it.

## Success Metrics

1. **Engagement** — Visitors who scroll through the pipeline and reliability sections.
2. **Click-through** — Visitors who continue to platform capabilities or how-it-works.

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md`, `gspec/style.md`, `gspec/stack.md`, and `gspec/practices.md` to resolve project-specific context.
