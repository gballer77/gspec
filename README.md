# gspec Commands

This directory contains slash commands for generating project specification documents. Each command produces a standalone Markdown document in the `gspec/` folder.

## Commands

| Command | Role | Output | Description |
|---|---|---|---|
| `gspec.profile` | Business Strategist | `gspec/profile.md` | Product identity, audience, value proposition, and positioning |
| `gspec.feature` | Product Manager | `gspec/features/<name>.md` | Product Requirements Document (PRD) for a specific feature |
| `gspec.epic` | Senior Product Manager | `gspec/epics/<name>.md` + `gspec/features/*.md` | Break down an epic into 3-7 focused feature PRDs with a summary |
| `gspec.style` | UI/UX Designer | `gspec/style.md` | Visual style guide, design tokens, and component patterns |
| `gspec.stack` | Software Architect | `gspec/stack.md` | Technology stack, frameworks, infrastructure, and tooling |
| `gspec.practices` | Engineering Lead | `gspec/practices.md` | Development practices, code quality standards, and workflows |
| `gspec.implement` | Senior Engineer / Tech Lead | Code files | Reads gspec docs, identifies gaps, plans and builds the software |

## Recommended Order of Operations

Run the commands in this order for the best results:

1. **`gspec.profile`** — Define *what* the product is, who it's for, and why it exists
2. **`gspec.epic`** — Break down a large body of work into focused feature PRDs (optional, use instead of manual `gspec.feature` calls)
3. **`gspec.feature`** — Define individual features and requirements (run once per feature)
4. **`gspec.style`** — Define the visual design language and design system
5. **`gspec.stack`** — Define the technology choices and architecture
6. **`gspec.practices`** — Define the development standards and engineering practices
7. **`gspec.implement`** — Implement the software using all generated gspec documents

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
    │   ├── user-management.md
    │   └── ...
    └── features/
        ├── user-authentication.md
        ├── dashboard-analytics.md
        └── ...
```
