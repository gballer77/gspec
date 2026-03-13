---
gspec-version: 1.6.0
---

# Home Page

## Overview

A marketing landing page that introduces gspec to developers, communicates its value proposition, and drives them to install it. This is the front door of a multi-page site (with planned "Getting Started" and "Docs" pages) and needs to quickly convey what gspec is, why it matters, and how to start using it.

Developers adopting AI coding tools face a recurring problem: their AI lacks product context and makes poor assumptions. gspec solves this, but developers need a clear, compelling entry point to understand the tool and take action. The home page serves as that entry point.

## Users & Use Cases

**Primary users:** Software developers evaluating whether gspec fits their workflow.

1. **First-time visitor from a link or search** — A developer lands on the page, skims the hero and problem statement, and within 30 seconds understands what gspec does and whether it's relevant to them.
2. **Developer ready to try it** — A developer who's heard about gspec arrives looking for the install command. They find it immediately in the hero section and copy it.
3. **Developer comparing tools** — A developer evaluating AI workflow tools scans the page to understand gspec's approach (spec-first, platform-agnostic) and what commands are available.
4. **Returning visitor looking for docs** — A developer who has already installed gspec returns to find links to the Getting Started guide or full documentation.

## Scope

### In Scope

- Single landing page within a multi-page site structure
- Hero section with value proposition and install CTA
- Problem statement section explaining why AI tools need structured context
- Workflow overview section showing the define → specify → build → iterate flow
- Commands overview section briefly showcasing what each command does
- Platform support section showing supported AI coding tools
- Bottom CTA section repeating the install command
- Navigation that links to other site pages (Getting Started, Docs)

### Out of Scope

- Getting Started page (separate feature)
- Documentation pages (separate feature)
- User accounts, authentication, or any backend functionality
- Blog, changelog, or community features
- Analytics dashboard or admin interface
- Search functionality

### Deferred

- Social proof section (GitHub stars, testimonials) — add when traction warrants it
- Interactive demo or playground
- Dark/light mode toggle
- Internationalization

## Capabilities

### Hero Section

- [x] **P0**: Page displays a clear tagline and one-line value proposition that communicates what gspec does
  - Headline and subtext are visible above the fold without scrolling
  - Value proposition references the core benefit (giving AI tools product context)
  - Copy is concise — headline under 10 words, subtext under 25 words

- [x] **P0**: Page displays a prominent install CTA with the install command
  - Install command (`npx gspec`) is displayed in a visually distinct, copy-friendly format
  - A copy-to-clipboard interaction is available for the install command
  - CTA is visually the most prominent action on the page

### Problem Statement

- [x] **P0**: Page includes a problem statement section explaining why AI tools build poorly without structured context
  - Section clearly articulates the two core problems (AI lacks context, specs drift from reality)
  - Content is scannable — short paragraphs or bullet points, not walls of text
  - Section logically leads into the "how it works" section below it

### Workflow Overview

- [x] **P0**: Page includes a workflow overview showing the gspec process
  - Displays the core workflow stages: Define → Research → Specify → Architect → Analyze → Build → Iterate
  - Communicates that only Define and Build are required; other stages are optional
  - Each stage includes a brief description of what it produces

### Commands Overview

- [x] **P1**: Page includes a commands overview section showcasing available commands
  - Each command is listed with its role and a one-line description of what it produces
  - Commands are visually grouped by workflow stage (fundamentals, optional depth, implementation, maintenance)
  - Section conveys breadth of capability without overwhelming — scannable, not dense

### Platform Support

- [x] **P1**: Page includes a platform support section showing compatible AI coding tools
  - Displays supported platforms (Claude Code, Cursor, Antigravity, Codex)
  - Each platform is visually identifiable (name and/or logo)
  - Section reinforces the "platform-agnostic" value proposition

### Bottom CTA

- [x] **P0**: Page includes a bottom CTA section that repeats the install command
  - Install command is displayed with the same copy-friendly format as the hero CTA
  - Section appears after all content sections, catching users who scrolled through the full page

### Navigation

- [x] **P0**: Page includes site navigation with links to other pages
  - Navigation includes links to Home (current), Getting Started, and Docs
  - Navigation is persistent and accessible from any scroll position
  - Links to pages not yet built lead to placeholder or coming-soon states rather than broken links

### Responsive Layout

- [x] **P1**: Page renders correctly across screen sizes
  - Content is readable and well-structured on desktop, tablet, and mobile viewports
  - Install command remains copy-friendly on all screen sizes
  - Navigation adapts appropriately for smaller screens

## Dependencies

- **Getting Started page** — Navigation links to this page; needs at minimum a placeholder route. No existing PRD.
- **Docs page** — Navigation links to this page; needs at minimum a placeholder route. No existing PRD.

## Assumptions & Risks

### Assumptions

- The install command (`npx gspec`) is stable and will remain the primary installation method
- The list of supported platforms (Claude Code, Cursor, Antigravity, Codex) is current
- The workflow stages and command set reflected in the project README are up to date
- Getting Started and Docs pages will be built as separate features; the home page only needs to link to them

### Risks

- **Content accuracy drift** — The home page content may fall out of sync with the actual gspec commands and workflow as the tool evolves. *Mitigation:* Keep marketing copy high-level enough that minor command changes don't require page updates; link to docs for details.
- **Placeholder pages feel incomplete** — If Getting Started and Docs aren't built promptly, navigation links to empty placeholders may undermine credibility. *Mitigation:* Use clear "coming soon" states rather than broken links or empty pages.

## Success Metrics

1. **Visitor-to-install conversion** — Measurable percentage of visitors who copy the install command (via copy button click tracking)
2. **Bounce rate** — Visitors who leave without scrolling past the hero, indicating the value proposition isn't landing
3. **Navigation click-through** — Visitors who navigate to Getting Started or Docs, indicating interest beyond the landing page

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
