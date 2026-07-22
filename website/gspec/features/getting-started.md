---
spec-version: v1
---

# Getting Started

## Overview

A guided onboarding page that teaches new users how to use gspec via two selectable paths, presented as tabs: an **autonomous build** path (one command builds the whole project, positioned for greenfield work) and a **spec-by-spec** path (run each command yourself, for hands-on control and existing codebases). Install and a shared introduction sit above the tabs; both paths produce the same living specs.

Developers who install gspec face a cold-start problem: they have a set of commands but no mental model for how they fit together or what good output looks like. Compounding this, gspec 2.0 supports two very different ways of working, and a new user needs to quickly understand which fits their situation. The Getting Started page bridges both gaps — it lets the user pick the path that matches their project and follow a concrete, end-to-end example for it.

## Users & Use Cases

**Primary users:** Developers who have just installed gspec (or are about to) and want to learn the workflow.

1. **New user following along** — A developer just ran `npx gspec`, opens the Getting Started page, and works through each step on their own project, using the example as a reference for what to expect.
2. **Evaluating developer reading through** — A developer considering gspec reads the walkthrough to understand the full workflow and what kind of output it produces before committing to using it.
3. **Returning user checking a specific step** — A developer who has used gspec before comes back to refresh their memory on a particular command (e.g., "what does the style command need from me?"), using the sidebar nav to jump directly to that section.
4. **Developer sharing with a teammate** — A developer links a colleague to the Getting Started page to explain how gspec works, rather than explaining it themselves.

## Scope

### In Scope

- Single page with a sidebar progress navigation and a right-hand table of contents
- A shared top: introduction (explaining the two paths) and a single install section used by both
- A tabbed path selector letting the user choose between the autonomous-build path and the spec-by-spec path
- **Autonomous build path** — when-to-use framing that calls out greenfield as the primary use case, how to run `/gspec-build` (intake → nine stages → verified code), and what the run produces; notes the harnesses with a wired engine (Claude Code, Codex, Pi)
- **Spec-by-spec path** — a walkthrough over a fictional example project covering profile → style → stack → practices → feature → implement, with abbreviated example output for profile and implement
- Cross-links between the two paths so users can switch at any time
- Each spec-by-spec section covers: what the command does, what the user runs, what to expect
- Navigation consistent with the site

### Out of Scope

- Full reference coverage of every command (research, architect, analyze, audit, qa, distill, migrate) — these belong in the Docs page
- Interactive or runnable code (no embedded terminals or sandboxes)
- Video or animated content
- Multiple example projects
- The Docs page (separate feature)

### Deferred

- "Try it yourself" interactive sandbox
- Example project variations for different types of apps
- Downloadable example project files
- Persisting the selected path across visits

## Capabilities

### Sidebar Progress Navigation

- [x] **P0**: Page displays a sidebar navigation showing all walkthrough sections
  - Sidebar lists the shared sections plus both paths' sections, grouped under "Autonomous build" and "Spec by spec" headings
  - Current section is visually highlighted as the user scrolls
  - Clicking a sidebar item scrolls to that section; if the item belongs to the inactive path, its tab is activated first
  - Sidebar remains visible and accessible throughout the page

### Example Project Introduction

- [x] **P0**: The spec-by-spec path introduces the fictional example project it walks through
  - Example project is described in 2-3 sentences at the start of the spec-by-spec path (before the first command)
  - The example is a realistic, relatable app concept that developers can map to their own projects
  - The introduction sets expectations: "we'll build specs for [project] using each core command"

### Install Section

- [x] **P0**: Page includes an install section showing how to add gspec to a project
  - Displays the install command in a copy-friendly format
  - Mentions platform selection (Claude Code, Cursor, Antigravity, Codex, Open Code, Pi) and that the CLI prompts for it
  - Section is brief — install is simple and shouldn't take more than a few lines
  - Install is shared by both paths and sits above the path selector

### Path Selector

- [x] **P0**: Page lets the user choose between the two workflow paths
  - A tabbed control offers the autonomous-build path and the spec-by-spec path, each with a one-line description of when it fits
  - The autonomous-build tab is flagged for greenfield use; the spec-by-spec tab is flagged as hands-on
  - Selecting a tab shows that path's content and hides the other
  - The selection is keyboard- and screen-reader-accessible (tab roles, selected state)
  - The two paths share the same specs, and the page makes clear the user can switch at any time

### Autonomous Build Path

- [x] **P0**: Page teaches the autonomous-build path
  - Explains when to use it, explicitly calling out greenfield (new project / prototype) as the primary use case, and noting it also works on existing projects via skip-if-present foundation
  - States the harnesses with a wired engine (Claude Code, Codex, Pi) and points other harnesses to the spec-by-spec path
  - Shows both ways to run it — the `/gspec-build` slash command in the harness and the headless `gspec build` script — and that the idea can be passed directly as an argument or captured via the intake interview
  - Shows the nine pipeline stages in order
  - Explains the quality gates (independent validator per stage, verify.sh) and what the finished run produces
  - Links to the dedicated build page for full mechanics

### Profile Walkthrough

- [x] **P0**: Page walks through the profile command with example context
  - Shows the command the user runs
  - Explains what the command asks for (product identity, audience, value proposition)
  - Displays abbreviated example output showing a condensed version of the generated profile for the fictional project

### Style Walkthrough

- [x] **P0**: Page walks through the style command with example context
  - Shows the command the user runs
  - Explains what the command produces (visual design language, design tokens, component patterns)
  - Briefly describes the kind of questions the command asks and the output it generates

### Stack Walkthrough

- [x] **P0**: Page walks through the stack command with example context
  - Shows the command the user runs
  - Explains what the command produces (technology choices, infrastructure, architecture patterns)
  - Briefly describes the kind of questions the command asks and the output it generates

### Practices Walkthrough

- [x] **P0**: Page walks through the practices command with example context
  - Shows the command the user runs
  - Explains what the command produces (development standards, testing, code quality)
  - Briefly describes the kind of questions the command asks and the output it generates

### Feature Walkthrough

- [x] **P0**: Page walks through the feature command with example context
  - Shows the command the user runs with an example feature description
  - Explains what the command produces (a PRD with prioritized capabilities and acceptance criteria)
  - Briefly describes the conversational flow (command asks clarifying questions, then generates the spec)

### Implement Walkthrough

- [x] **P0**: Page walks through the implement command with example context
  - Shows the command the user runs
  - Explains that implement reads all existing specs to build with full context
  - Displays abbreviated example output showing a condensed view of the implementation plan and progress

### Next Steps Section

- [x] **P1**: Page includes a "what's next" section after the paths
  - Points users to the Docs page for coverage of the remaining commands (research, architect, analyze, qa)
  - Links to the How It Works page for the agent-team architecture
  - Encourages users to start with their own project now that they've seen both paths

### Responsive Layout

- [x] **P1**: Page renders correctly across screen sizes
  - Sidebar navigation collapses or adapts on smaller screens (e.g., becomes a top progress bar or hamburger menu)
  - Command displays and example output remain readable on mobile
  - Content is well-structured at all viewport sizes

## Dependencies

- **Home Page** ([home-page.md](home-page.md)) — Site navigation and shared layout. The home page links to this page.
- **Docs page** — The "Next Steps" section links to Docs. Needs at minimum a placeholder route. No existing PRD.

## Assumptions & Risks

### Assumptions

- The core command set (profile, style, stack, practices, feature, implement) is stable and represents the recommended workflow order
- A single fictional example project is sufficient to teach the workflow — users can extrapolate to their own projects
- Abbreviated output excerpts are enough to set expectations without overwhelming the page

### Risks

- **Example staleness** — If gspec commands change their output format or conversational flow, the example walkthrough becomes misleading. *Mitigation:* Keep example output abbreviated and high-level so minor format changes don't require page updates.
- **Example project mismatch** — The chosen fictional project may not resonate with all developers (e.g., a task app feels irrelevant to someone building a CLI tool). *Mitigation:* Choose a broadly relatable example and keep the focus on the gspec workflow rather than the example project's domain.
- **Page length** — Covering two full paths on one page could feel long. *Mitigation:* The tabbed path selector shows only one path at a time, and the sidebar nav lets users jump to specific sections.
- **Path confusion** — Users may not know which path fits their situation. *Mitigation:* Each tab carries a one-line "when it fits" cue (greenfield vs. hands-on/existing), and the shared intro frames the choice before the tabs.

## Success Metrics

1. **Completion rate** — Percentage of users who scroll through or navigate to the final section (implement or next steps), indicating they engaged with the full walkthrough
2. **Time on page** — Average engagement time, indicating users are reading rather than bouncing
3. **Navigation to Docs** — Click-through rate on "Next Steps" links, indicating users are continuing to learn after the walkthrough

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
