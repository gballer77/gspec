# gspec Commands

This directory contains slash commands for generating project specification documents. Each command produces a standalone Markdown document in the `gspec/` folder.

## Installation

Run from your project root:

```bash
npx gspec
```

The CLI will ask which platform you're installing for:

| Platform | Install path |
|---|---|
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/commands/` |
| Antigravity | `.agent/skills/` |

You can also skip the prompt by passing a target directly:

```bash
npx gspec --target cursor
```

## Commands

| Command | Role | Output | Description |
|---|---|---|---|
| `gspec.profile` | Business Strategist | `gspec/profile.md` | Product identity, audience, value proposition, and positioning |
| `gspec.feature` | Product Manager | `gspec/features/<name>.md` | Product Requirements Document (PRD) for a specific feature |
| `gspec.epic` | Product Manager | `gspec/epics/<name>.md` + `gspec/features/*.md` | Breaks down a large epic into multiple focused feature PRDs with dependency mapping and phasing |
| `gspec.style` | UI/UX Designer | `gspec/style.md` | Visual style guide, design tokens, and component patterns |
| `gspec.stack` | Software Architect | `gspec/stack.md` | Technology stack, frameworks, infrastructure, and tooling |
| `gspec.practices` | Engineering Lead | `gspec/practices.md` | Development practices, code quality standards, and workflows |
| `gspec.implement` | Senior Engineer / Tech Lead | Code files | Reads gspec docs, identifies gaps, plans and builds the software |
| `gspec.dor` | Engineer + Doc Lead | Code files + `gspec/*.md` | Makes code changes and updates gspec specs to keep documentation in sync |
| `gspec.record` | Doc Lead | `gspec/*.md` | Updates gspec specs to reflect changes, decisions, or context — no code changes |

## Workflow

### 1. Fundamentals

Define the foundation that drives how your entire application is built.

- **`gspec.profile`** — Define *what* the product is, who it's for, and why it exists
- **`gspec.style`** — Define the visual design language and design system
- **`gspec.stack`** — Define the technology choices and architecture
- **`gspec.practices`** — Define the development standards and engineering practices

### 2. Pre-Build

Define *what* to build.

- **`gspec.epic`** — Break down a large body of work into multiple feature PRDs with dependencies and phasing
- **`gspec.feature`** — Define individual features and requirements (run once per feature)

### 3. Build

- **`gspec.implement`** — Implement the software using all generated gspec documents

### 4. Iterate

- **`gspec.dor`** — Make code changes and update gspec specs to keep documentation in sync
- **`gspec.record`** — Record decisions, changes, or context to gspec specs without touching code

> Each command is self-contained and will ask clarifying questions when essential information is missing.

## Output Structure

```
project-root/
└── gspec/
    ├── profile.md
    ├── style.md
    ├── stack.md
    ├── practices.md
    ├── epics/
    │   └── onboarding-flow.md
    └── features/
        ├── user-authentication.md
        ├── dashboard-analytics.md
        └── ...
```
