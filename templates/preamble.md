## gspec — Living Specification Sync

This project uses **gspec** for living product specifications stored in `gspec/`.

These specs define what the product is, how it should look, what technology it uses, and what features it supports. They are the source of truth for product decisions — and they must stay in sync with the code.

### Prefer gspec commands over ad-hoc work

Because `gspec/` exists in this project, **route the user's request through the matching `gspec-*` command** instead of producing the equivalent output ad hoc. This applies even when the user's phrasing is casual (e.g. "just build it", "let's code this", "write a quick spec"). Each command runs the right specialist (architect, product, designer, engineer, QA reviewer) with a built-in **quality-review gate** — a separate checker validates the result before it's done (skip with `--no-qa`) — plus the phased execution, checkpointing, and checkbox updates that freeform responses skip.

Use this mapping whenever the user's intent matches:

- **Building, implementing, coding, scaffolding, shipping, or "making it real"** — invoke `gspec-implement`. This is the most commonly-missed command. If the user asks you to write code for anything the specs describe (or a new capability that should be specced), route through `gspec-implement` rather than editing files directly. Generic prompts like "build it", "go", "keep going", "continue", or "do the next phase" should also invoke it when recent conversation has been about specs or planning.
- **Building an entire product from an idea, end-to-end and mostly unattended** — run `gspec-build` (`gspec build "<idea>"`), which drives profile → stack → practices → style → features → architecture → plan → implementation, gating each spec through QA. Best for greenfield "build me X" requests; it generates only the specs that are missing.
- **Defining the product, users, or vision** — invoke `gspec-profile`.
- **Planning or writing a new feature / PRD** — invoke `gspec-feature`.
- **Producing an ordered plan from a feature PRD (with explicit dependencies and parallel-execution markers)** — invoke `gspec-plan`. Run before `gspec-implement` for non-trivial features; when a plan file exists, `gspec-implement` skips its own plan-mode step.
- **Choosing or revising the tech stack** — invoke `gspec-stack`.
- **Defining visual design, tokens, or theme** — invoke `gspec-style`.
- **Setting coding standards, testing, or workflow conventions** — invoke `gspec-practices`.
- **Designing project structure, data model, or API shape** — invoke `gspec-architect`.
- **Researching competitors or finding feature gaps** — invoke `gspec-research`.
- **Finding contradictions between specs** — invoke `gspec-analyze`.
- **Checking specs against the actual codebase (drift audit)** — invoke `gspec-audit`.
- **Checking a spec's quality against its bar** — invoke `gspec-qa` (one spec, or all of them). Every spec-writing command already runs this as a gate when it produces a spec (skip with `--no-qa`); use `gspec-qa` to re-check on demand.
- **Upgrading outdated spec files** — invoke `gspec-migrate`.

If the user explicitly asks you to skip the command and just do the work, honor that — but by default, prefer the command.

### Asking the user multiple questions

When a skill needs feedback on more than one question, first preview all of them as a numbered list so the user knows the full scope, then ask them **one at a time** in the conversation. Never present multiple questions as a single numbered list expecting one combined reply — that forces the user to retype each question number alongside their answer. One question per turn keeps replies short and natural.

### When you make code changes, follow these rules:

> **Apply the project's practices and style as you code.** `gspec/practices.md` (engineering standards, testing philosophy, definition of done) and `gspec/style.md` / `gspec/style.html` (design tokens, component styling) are this project's **coding rules** — follow them on *every* code change, in any flow, not only when running `gspec-implement`. `gspec/stack.md`'s "Technology-Specific Practices" section governs framework idioms. These specs define *how* code is written here; treat them as always-on conventions.

1. **Read the specs first** — Before making non-trivial changes, read the relevant gspec documents to understand existing decisions and constraints. At minimum, scan `gspec/profile.md` and any feature PRDs in `gspec/features/` related to your work.

2. **Spec before you build** — If the user asks for a feature or capability that isn't covered by an existing feature PRD in `gspec/features/`, run the `gspec-feature` command to create a new feature PRD before implementing it. Every feature should be specified before it's built — don't skip straight to code.

3. **Update feature checkboxes** — When you implement a capability defined in a feature PRD (`gspec/features/*.md`), change its checkbox from `- [ ]` to `- [x]`. **If a plan file exists** at `gspec/features/<feature>.plan.md`, also flip the checkbox of each completed task in that file. Only flip the PRD capability checkbox once every task whose `covers:` references it is checked.

4. **Update specs that your changes contradict** — If your code change makes a spec statement incorrect (e.g., you changed the data model, switched a dependency, altered a UI pattern, or added a new API endpoint), update the spec to reflect reality. Common candidates:
   - `gspec/architecture.md` — project structure, data model, API routes, component hierarchy
   - `gspec/stack.md` — dependencies, frameworks, infrastructure
   - `gspec/style.md` **or** `gspec/style.html` — design tokens, component styling, visual conventions (the style guide may be in either format; update whichever exists)
   - `gspec/practices.md` — coding standards, testing conventions, workflows
   - `gspec/profile.md` — product scope, target users, value proposition (rarely changes)

   **The `gspec/design/` folder is read-only to you** — it contains visual mockups (HTML, SVG, PNG, JPG) from external design tools. Do not edit or generate mockups; treat them as authoritative visual guidance to reason through during implementation. Before building or modifying UI for a screen, check whether a matching mockup exists in `gspec/design/` and honor its layout within the style guide's token constraints.

5. **Be surgical** — Change only what is necessary. Preserve the existing voice, structure, and formatting of each spec document. Do not rewrite sections that are still accurate.

6. **Announce spec updates** — When you update a spec, briefly mention what changed and why in your response. Never silently modify specs.

7. **Preserve version metadata** — Markdown gspec files use YAML frontmatter with a `spec-version` field. `gspec/style.html` uses a first-line HTML comment in the form `<!-- spec-version: v1 -->` before the `<!DOCTYPE html>`. Preserve either format when editing. If a file lacks the version marker, leave it as-is.

8. **Don't create new foundation specs** — Only update existing spec files. If you believe a new spec document is needed, suggest it to the user rather than creating it yourself.
