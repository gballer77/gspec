---
spec-version: v1
---

# gspec — Product Profile

## 1. Product Overview

- **Product Name:** gspec
- **Tagline:** Living specs, and an agent team that builds from them.
- **Category:** Open-source developer tooling (CLI + AI agent framework)
- **Current Stage:** 2.0 — agent-team framework with an autonomous build

## 2. Mission & Vision

### Mission Statement

gspec gives development teams a structured way to define and maintain product specifications — profile, style, stack, practices, features, and architecture — so that AI coding tools have the context they need to produce accurate, consistent output. In 2.0 it goes further: an agent team executes that workflow, with an autonomous build that can take an idea to working code, quality gates that catch their own mistakes, and a learning loop that improves future runs. It solves the twin problems of AI tools making uninformed assumptions and specifications drifting out of sync with code.

### Vision Statement

A world where every AI-assisted codebase carries a living, version-controlled specification layer that keeps humans and AI aligned on what is being built, why, and how — eliminating the gap between product intent and generated code.

## 3. Target Audience

### Primary Users

- **Small development teams (2–10 people)** using AI coding tools (Claude Code, Cursor, Codex, Antigravity, Open Code, Pi) to build software products.
- **Pain points:**
  - AI tools lack project context, leading to inconsistent output that doesn't match the team's product vision, design language, or technical decisions.
  - Specifications written at project kickoff quickly become stale, causing AI tools to rely on outdated or missing context.
  - Team members each carry different mental models of the product, creating alignment friction.
- **Goals and motivations:**
  - Get higher-quality, more consistent AI output without repeating context in every prompt.
  - Maintain a single source of truth for product decisions that stays current as the codebase evolves.
  - Onboard new team members (human or AI) quickly with well-structured documentation.

### Secondary Users

- **Solo developers** who want structured product thinking and better AI assistance on personal or freelance projects.
- **Product managers and designers** who contribute to specification documents (profile, features, style) without needing to write code.

### Stakeholders

- **Project leads and architects** who define technical direction and want it codified.
- **Open-source contributors** who maintain or extend gspec itself.

## 4. Value Proposition

### Core Value

gspec turns scattered product knowledge into structured, version-controlled Markdown documents that live alongside the code — giving AI coding tools persistent, accurate context that improves every interaction.

### Key Benefits

1. **Better AI output** — AI tools read gspec documents and make decisions informed by the product's actual audience, stack, design system, and standards.
2. **Specs that stay current** — The spec-sync system automatically reminds AI tools to update specifications when code changes contradict them.
3. **Structured product thinking** — Role-based commands (Business Strategist, UI Designer, Architect, etc.) guide teams through comprehensive product definition.
4. **Autonomous build** — A deterministic runtime can take an idea and drive the whole workflow — specs, plan, and code — as a resumable, self-healing run.
5. **Quality that's enforced, not assumed** — Producer ≠ checker: independent validators gate every stage, backed by a generated build-and-test script and deterministic enforcement hooks.
6. **Gets better over time** — A learning loop captures corrections and distills them back into the agents' skills, so future runs start smarter.
7. **Platform-agnostic** — Works with Claude Code, Cursor, Codex, Antigravity, Open Code, and Pi from a single source tree.
8. **Zero lock-in** — Specs are plain Markdown files in your repo. No proprietary formats, no hosted service, no account required.

### Differentiation

- **Living, not static:** Unlike traditional PRD templates or wiki pages, gspec documents are designed to evolve with the codebase through automated sync rules.
- **AI-native:** Built specifically for the AI-assisted development workflow rather than adapted from traditional documentation tools.
- **An agent team, not just prompts:** gspec ships specialized agents behind each command and a deterministic runtime that can execute the whole workflow — most SDD tools stop at producing a spec and a task list.
- **Multi-platform:** A single source tree builds for six major AI coding platforms, in each one's native format.
- **Role-based generation:** Each command adopts a specific professional perspective (Product Manager, Architect, Designer), producing documents with appropriate depth and focus.

## 5. Product Description

### What It Is

gspec is a CLI tool and AI agent framework that installs into your project. Running `npx gspec` installs platform-specific commands, skills, agents, and (where supported) enforcement hooks into your AI coding tool of choice. Each command is a thin conversation backed by specialized agents working behind a quality gate. The commands guide you through defining your product across multiple dimensions:

- **Profile** — What the product is, who it serves, and why it exists
- **Style** — Visual design system with design tokens, colors, and component patterns
- **Stack** — Technology choices, frameworks, and infrastructure
- **Practices** — Development standards, testing conventions, and workflows
- **Features** — One or more feature PRDs with prioritized capabilities
- **Architecture** — Technical blueprint with data models, APIs, and project structure
- **Research** — Competitive analysis and feature gap identification

Once generated, these Markdown documents live in a `gspec/` directory in your repository. A spec-sync mechanism instructs AI tools to read specs before making changes and update them when code diverges from the documented intent.

### What It Isn't

- **Not a project management tool** — gspec defines what to build, not who is working on what or when it ships.
- **Not a code generator** — While `gspec-implement` reads specs and builds software, gspec itself is a specification system, not a scaffolding or boilerplate tool.
- **Not a hosted platform** — There is no SaaS component, no dashboard, no account. Everything is local files in your repo.
- **Not a replacement for design tools** — The style guide captures design decisions in a format AI tools can read; it doesn't replace Figma or similar tools.

## 6. Use Cases & Scenarios

### Primary Use Cases

1. **New project kickoff** — A small team runs the four foundation commands (profile, style, stack, practices) to establish a shared product definition before writing code. AI tools immediately have full context.

2. **Feature planning** — A product manager uses `gspec-feature` to define new capabilities with prioritized requirements. The developer then runs `gspec-implement` and the AI builds against the spec.

3. **Keeping specs honest** — As a developer ships code that changes the data model, the spec-sync rules prompt the AI tool to update `architecture.md` automatically, keeping documentation current without manual effort.

4. **Competitive research** — A team uses `gspec-research` to analyze competitors based on the product profile, producing a feature matrix and identifying gaps before committing to a roadmap.

5. **Cross-platform consistency** — A team with members using different AI coding tools (one on Claude Code, another on Cursor) installs gspec on both platforms. The same spec documents drive consistent AI behavior regardless of tool.

## 7. Market & Competition

### Market Context

- The AI-assisted development market is growing rapidly, with tools like Claude Code, Cursor, GitHub Copilot, and Codex becoming standard in developer workflows.
- A key pain point emerging in this market is **context loss** — AI tools produce generic or inconsistent output because they lack product-level context.
- There is growing demand for structured ways to provide AI tools with project context beyond what's in the code itself.

### Competitive Landscape

- **Direct competitors:** No established direct competitors offering a structured, multi-platform specification system purpose-built for AI coding tools.
- **Indirect competitors / alternatives:**
  - Manual `CLAUDE.md` / `.cursorrules` files — hand-written context files that tend to be unstructured and hard to maintain.
  - Traditional documentation tools (Notion, Confluence) — not integrated into the AI coding workflow.
  - Project scaffolding tools (Yeoman, create-*-app) — generate initial structure but don't maintain living specs.
- **White space:** gspec occupies the gap between "no AI context" and "fully manual context files" by providing structured, role-guided specification generation with automated sync.

## 8. Brand & Positioning

### Brand Personality

- **Practical** — Focused on solving a real workflow problem, not hype.
- **Developer-friendly** — Minimal setup, plain Markdown, no lock-in.
- **Opinionated but flexible** — Provides structured guidance while letting teams customize.

### Positioning Statement

For small development teams using AI coding tools, gspec is the open-source specification system that keeps AI aligned with product intent because it provides structured, living documents that evolve with the codebase.

### Key Messaging

- **Elevator pitch:** "gspec gives your AI coding tools the product context they're missing — structured specs that live in your repo and stay in sync with your code."
- **Core message:** Your AI tools are only as good as the context you give them. gspec makes that context structured, comprehensive, and self-maintaining.

## 9. Public-Facing Information

### Website Copy Elements

- **Homepage headline:** "Living specs. Autonomous builds."
- **Subheadline:** "gspec gives your AI coding tools the structured product context they need — then an agent team that can take an idea all the way to working code."
- **About us summary:** gspec is an open-source CLI tool and agent-team framework that installs into AI coding tools like Claude Code, Cursor, Codex, Antigravity, Open Code, and Pi. It helps teams define their product once, keep that definition current as the codebase evolves, and — on supported harnesses — autonomously build from it with quality gates and a learning loop.

### Social Media Presence

- **Primary platform:** GitHub (community hub, issue tracker, discussions)
- **Secondary:** Twitter/X and developer communities (Reddit, Hacker News)
- **Content themes:** AI-assisted development workflows, specification-driven development, developer productivity

### Press & Media

Not applicable at this stage.

## 10. Risks & Assumptions

### Key Assumptions

- AI coding tools will continue to grow in adoption and become standard developer workflow components.
- Structured context meaningfully improves AI coding tool output quality.
- Teams are willing to invest upfront time in specification to get better long-term AI assistance.
- Plain Markdown in the repo is the right format — developers prefer files they own over hosted services.

### Risks

- **Platform risk:** AI coding tool platforms may build native specification systems that replace the need for gspec.
- **Adoption risk:** Developers may perceive specification work as overhead that slows them down rather than speeds them up.
- **Maintenance risk:** As a free open-source project, sustained development depends on contributor interest and maintainer capacity.

### Mitigation Strategies

- Stay platform-agnostic so gspec isn't dependent on any single AI tool's ecosystem.
- Keep the install and usage experience as frictionless as possible to lower the adoption barrier.
- Focus on demonstrating clear, measurable improvements in AI output quality to justify the specification investment.
- Build a healthy contributor community to distribute maintenance load.
