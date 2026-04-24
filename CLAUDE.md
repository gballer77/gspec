<!-- gspec:spec-sync -->
## gspec — Living Specification Sync

This project uses **gspec** for living product specifications stored in `gspec/`.

These specs define what the product is, how it should look, what technology it uses, and what features it supports. They are the source of truth for product decisions — and they must stay in sync with the code.

### Prefer gspec skills over ad-hoc work

Because `gspec/` exists in this project, **route the user's request through the matching gspec skill** instead of producing the equivalent output ad hoc. This applies even when the user's phrasing is casual (e.g. "just build it", "let's code this", "write a quick spec"). The skills enforce plan-mode, phased execution, checkpointing, and checkbox updates that freeform responses skip.

Use this mapping whenever the user's intent matches:

- **Building, implementing, coding, scaffolding, shipping, or "making it real"** — invoke `gspec-implement`. This is the most commonly-missed skill. If the user asks you to write code for anything the specs describe (or a new capability that should be specced), route through `gspec-implement` rather than editing files directly. Generic prompts like "build it", "go", "keep going", "continue", or "do the next phase" should also invoke it when recent conversation has been about specs or planning.
- **Defining the product, users, or vision** — invoke `gspec-profile`.
- **Planning or writing a new feature / PRD** — invoke `gspec-feature`.
- **Choosing or revising the tech stack** — invoke `gspec-stack`.
- **Defining visual design, tokens, or theme** — invoke `gspec-style`.
- **Setting coding standards, testing, or workflow conventions** — invoke `gspec-practices`.
- **Designing project structure, data model, or API shape** — invoke `gspec-architect`.
- **Researching competitors or finding feature gaps** — invoke `gspec-research`.
- **Auditing specs for contradictions or drift** — invoke `gspec-analyze`.
- **Upgrading outdated spec files** — invoke `gspec-migrate`.

If the user explicitly asks you to skip the skill and just do the work, honor that — but by default, prefer the skill.

### When you make code changes, follow these rules:

1. **Read the specs first** — Before making non-trivial changes, read the relevant gspec documents to understand existing decisions and constraints. At minimum, scan `gspec/profile.md` and any feature PRDs in `gspec/features/` related to your work.

2. **Spec before you build** — If the user asks for a feature or capability that isn't covered by an existing feature PRD in `gspec/features/`, run the `gspec-feature` command to create a new feature PRD before implementing it. Every feature should be specified before it's built — don't skip straight to code.

3. **Update feature checkboxes** — When you implement a capability defined in a feature PRD (`gspec/features/*.md`), change its checkbox from `- [ ]` to `- [x]`.

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

<!-- gspec:spec-sync -->
