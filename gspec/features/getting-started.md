---
gspec-version: 1.6.0
---

# Getting Started

## Overview

A guided walkthrough page that teaches new users how to use gspec by building a fictional example project from scratch. The page walks through the full workflow — install through implementation — showing what to run and what gspec produces at each step.

Developers who install gspec face a cold-start problem: they have a set of commands but no mental model for how they fit together or what good output looks like. The Getting Started page bridges this gap by providing a concrete, end-to-end example that developers can follow along with or reference as they apply gspec to their own projects.

## Users & Use Cases

**Primary users:** Developers who have just installed gspec (or are about to) and want to learn the workflow.

1. **New user following along** — A developer just ran `npx gspec`, opens the Getting Started page, and works through each step on their own project, using the example as a reference for what to expect.
2. **Evaluating developer reading through** — A developer considering gspec reads the walkthrough to understand the full workflow and what kind of output it produces before committing to using it.
3. **Returning user checking a specific step** — A developer who has used gspec before comes back to refresh their memory on a particular command (e.g., "what does the style command need from me?"), using the sidebar nav to jump directly to that section.
4. **Developer sharing with a teammate** — A developer links a colleague to the Getting Started page to explain how gspec works, rather than explaining it themselves.

## Scope

### In Scope

- Single long-scroll page with a sidebar progress navigation
- A fictional but realistic example project used throughout (e.g., a task management app)
- Walkthrough covering the full workflow: install → profile → style → stack → practices → feature → implement
- Abbreviated example output shown for key commands (profile, implement); other commands show the command invocation and a brief description of what gets produced
- Each section covers: what the command does, what the user runs, what to expect
- Navigation consistent with the site (Home, Getting Started, Docs)

### Out of Scope

- Coverage of optional commands (research, epic, architect, analyze) — these belong in the Docs pages
- Interactive or runnable code (no embedded terminals or sandboxes)
- Video or animated content
- Multiple example projects or alternative paths
- The Docs page (separate feature)

### Deferred

- "Try it yourself" interactive sandbox
- Example project variations for different types of apps
- Downloadable example project files
- Coverage of the iterate commands (dor, record)

## Capabilities

### Sidebar Progress Navigation

- [x] **P0**: Page displays a sidebar navigation showing all walkthrough sections
  - Sidebar lists every section of the walkthrough (install, profile, style, stack, practices, feature, implement)
  - Current section is visually highlighted as the user scrolls
  - Clicking a sidebar item scrolls to that section
  - Sidebar remains visible and accessible throughout the page

### Example Project Introduction

- [x] **P0**: Page introduces the fictional example project used throughout the walkthrough
  - Example project is described in 2-3 sentences at the top of the walkthrough (before the first command)
  - The example is a realistic, relatable app concept that developers can map to their own projects
  - The introduction sets expectations: "we'll build specs for [project] from scratch using every core command"

### Install Section

- [x] **P0**: Page includes an install section showing how to add gspec to a project
  - Displays the install command in a copy-friendly format
  - Mentions platform selection (Claude Code, Cursor, Antigravity, Codex) and that the CLI prompts for it
  - Section is brief — install is simple and shouldn't take more than a few lines

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

- [x] **P1**: Page includes a "what's next" section after the walkthrough
  - Points users to the Docs page for coverage of optional commands (research, architect, epic, analyze)
  - Mentions the iterate workflow (dor, record) for keeping specs in sync
  - Encourages users to start with their own project now that they've seen the full flow

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
- **Page length** — Covering all seven commands on one page could feel long. *Mitigation:* The sidebar nav lets users jump to specific sections; keep each section concise and focused.

## Success Metrics

1. **Completion rate** — Percentage of users who scroll through or navigate to the final section (implement or next steps), indicating they engaged with the full walkthrough
2. **Time on page** — Average engagement time, indicating users are reading rather than bouncing
3. **Navigation to Docs** — Click-through rate on "Next Steps" links, indicating users are continuing to learn after the walkthrough

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
