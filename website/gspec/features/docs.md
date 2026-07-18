---
spec-version: v1
---

# Documentation

## Overview

A comprehensive reference page covering the gspec workflow and every command in detail. The page serves as the go-to resource for developers who want to understand what each command does, when to use it, how it relates to other commands, and how to get the most out of it.

The Getting Started page teaches the core workflow through an example, but developers need deeper reference material when they're ready to use optional commands (research, architect, analyze), troubleshoot issues, or understand nuances. The Docs page fills that gap with complete, reference-style documentation for the full command set.

## Users & Use Cases

**Primary users:** Developers actively using gspec who need detailed information about specific commands or the overall workflow.

1. **Developer reaching for an optional command** — A developer has been using the core workflow and wants to try `architect` or `research` for the first time. They come to Docs to understand what it does, when it's worth using, and what to expect.
2. **Developer troubleshooting or optimizing** — A developer's `implement` output isn't what they expected. They check Docs to understand how commands interact, what inputs affect output quality, and common pitfalls to avoid.
3. **Developer choosing the right command** — A developer has a large body of work and isn't sure whether to use `feature`, `epic`, or just go straight to `implement`. They scan the Docs to understand the tradeoffs.
4. **Developer onboarding a team** — A tech lead is rolling out gspec to their team and uses the Docs page as the canonical reference for how each command works and when to use it.

## Scope

### In Scope

- Single long-scroll page with sidebar navigation for jumping between sections
- Workflow overview section showing how all commands fit together and the recommended flow
- Detailed reference section for every command: profile, style, stack, practices, research, feature, epic, architect, analyze, implement, migrate
- Each command section includes: what it does, when to use it, what it produces, example invocation, key questions it asks, best practices, common pitfalls, and how it relates to other commands
- Commands grouped by workflow stage (Define, Research, Specify, Architect, Analyze, Build, Maintenance)
- Navigation consistent with the site (Home, Getting Started, Docs)

### Out of Scope

- Hands-on walkthrough with example output (covered by Getting Started)
- API or programmatic usage documentation
- Contributing guide or development documentation for gspec itself
- Changelog or version history
- Search functionality within docs

### Deferred

- Individual sub-pages per command (currently single-page; may split if page becomes too long)
- Search/filter within the docs page
- Version-specific documentation (e.g., docs for older gspec versions)
- Community-contributed tips or recipes
- Video or animated explanations

## Capabilities

### Sidebar Navigation

- [x] **P0**: Page displays a sidebar navigation listing all sections
  - Sidebar lists the workflow overview and every command, grouped by workflow stage
  - Current section is visually highlighted as the user scrolls
  - Clicking a sidebar item scrolls to that section
  - Sidebar remains visible and accessible throughout the page

### Workflow Overview Section

- [x] **P0**: Page includes a workflow overview showing how all commands relate to each other
  - Displays the full workflow: Define → Research → Specify → Architect → Analyze → Build → Maintenance
  - Clearly communicates which stages are required (Define, Build) and which are optional
  - Shows the relationships between commands (e.g., research can feed into feature, architect reads feature specs)
  - Includes a visual diagram or structured representation of the workflow flow

### Define Stage Commands

- [x] **P0**: Page includes a detailed reference section for the profile command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices and common pitfalls
  - Covers: how it relates to other commands (foundational input for all downstream commands)

- [x] **P0**: Page includes a detailed reference section for the style command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices and common pitfalls
  - Covers: how it relates to other commands (consumed by implement for UI decisions)

- [x] **P0**: Page includes a detailed reference section for the stack command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices and common pitfalls
  - Covers: how it relates to other commands (consumed by architect and implement for technology decisions)

- [x] **P0**: Page includes a detailed reference section for the practices command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices and common pitfalls
  - Covers: how it relates to other commands (consumed by implement for code quality and workflow standards)

### Research Stage Command

- [x] **P0**: Page includes a detailed reference section for the research command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices and common pitfalls
  - Covers: how it relates to other commands (reads profile, can generate feature PRDs from findings)

### Specify Stage Commands

- [x] **P0**: Page includes a detailed reference section for the feature command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices and common pitfalls
  - Covers: how it relates to other commands (produces PRDs consumed by architect and implement)

- [x] **P0**: Page includes a detailed reference section for the epic command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices, common pitfalls, and when to use epic vs. feature
  - Covers: how it relates to other commands (decomposes into multiple feature PRDs)

### Architect Stage Command

- [x] **P0**: Page includes a detailed reference section for the architect command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: key questions the command asks the user
  - Covers: best practices, common pitfalls, and when architect adds value vs. going straight to implement
  - Covers: how it relates to other commands (reads feature PRDs and stack, produces architecture consumed by implement)

### Analyze Stage Command

- [x] **P0**: Page includes a detailed reference section for the analyze command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: best practices and common pitfalls
  - Covers: how it relates to other commands (cross-references all specs, resolves contradictions before implement)

### Build Stage Command

- [x] **P0**: Page includes a detailed reference section for the implement command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: how it reads and prioritizes all existing specs
  - Covers: best practices, common pitfalls, and incremental implementation (checkbox tracking)
  - Covers: how it relates to other commands (consumes all specs; can be run with or without feature PRDs)

### Maintenance Stage Command

- [x] **P0**: Page includes a detailed reference section for the migrate command
  - Covers: what it does, when to use it, what it produces, example invocation
  - Covers: best practices (when to migrate, what to expect)
  - Covers: how it relates to other commands (updates existing spec files to current gspec format)

### Consistent Command Section Structure

- [x] **P1**: Every command section follows a consistent internal structure
  - Each command section uses the same sub-headings in the same order for scanability
  - Consistent formatting for example invocations (copy-friendly command display)
  - Related commands are cross-linked within each section (e.g., architect section links to feature and implement sections)

### Responsive Layout

- [x] **P1**: Page renders correctly across screen sizes
  - Sidebar navigation collapses or adapts on smaller screens
  - Command sections remain readable on mobile
  - Example invocations remain copy-friendly at all viewport sizes

## Dependencies

- **Home Page** ([home-page.md](home-page.md)) — Site navigation and shared layout. The home page links to this page.
- **Getting Started** ([getting-started.md](getting-started.md)) — Docs references Getting Started for the hands-on walkthrough; Getting Started references Docs for optional command coverage. Both pages link to each other.

## Assumptions & Risks

### Assumptions

- The full command set (profile, style, stack, practices, research, feature, epic, architect, analyze, implement, migrate) is stable and represents the complete gspec offering
- A single long-scroll page with sidebar nav is sufficient for the current command count (11 commands); if gspec grows significantly, the deferred sub-page structure may become necessary
- The README and command source files contain accurate, up-to-date information about each command's behavior

### Risks

- **Content staleness** — Docs must stay in sync with actual command behavior as gspec evolves. *Mitigation:* Structure docs so each command section is self-contained and independently updatable; keep descriptions focused on stable concepts rather than exact output formatting.
- **Page length** — 11 detailed command sections plus a workflow overview on a single page could feel overwhelming. *Mitigation:* Sidebar nav allows direct jumping; consistent section structure makes scanning efficient; consider splitting into sub-pages (deferred) if user feedback indicates the page is too long.
- **Duplication with Getting Started** — Some content overlap is inevitable (e.g., what profile does). *Mitigation:* Getting Started focuses on the example-driven walkthrough; Docs focuses on reference detail, best practices, and pitfalls. Cross-link rather than duplicate.

## Success Metrics

1. **Direct navigation rate** — Percentage of site visitors who navigate to Docs, indicating demand for detailed reference material
2. **Section engagement** — Which command sections are most viewed (via scroll tracking or sidebar click tracking), indicating which commands need the most documentation support
3. **Getting Started → Docs conversion** — Percentage of Getting Started visitors who continue to Docs, indicating the learning funnel is working
4. **Return visits** — Percentage of Docs visitors who return, indicating the page is useful as an ongoing reference rather than a one-time read

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
