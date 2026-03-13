## gspec — Living Specification Sync

This project uses **gspec** for living product specifications stored in `gspec/`.

These specs define what the product is, how it should look, what technology it uses, and what features it supports. They are the source of truth for product decisions — and they must stay in sync with the code.

### When you make code changes, follow these rules:

1. **Read the specs first** — Before making non-trivial changes, read the relevant gspec documents to understand existing decisions and constraints. At minimum, scan `gspec/profile.md` and any feature PRDs in `gspec/features/` related to your work.

2. **Update feature checkboxes** — When you implement a capability defined in a feature PRD (`gspec/features/*.md`), change its checkbox from `- [ ]` to `- [x]`. When all capabilities in a feature are checked, also update the corresponding entry in any epic file (`gspec/epics/*.md`).

3. **Update specs that your changes contradict** — If your code change makes a spec statement incorrect (e.g., you changed the data model, switched a dependency, altered a UI pattern, or added a new API endpoint), update the spec to reflect reality. Common candidates:
   - `gspec/architecture.md` — project structure, data model, API routes, component hierarchy
   - `gspec/stack.md` — dependencies, frameworks, infrastructure
   - `gspec/style.md` — design tokens, component patterns, visual conventions
   - `gspec/practices.md` — coding standards, testing conventions, workflows
   - `gspec/profile.md` — product scope, target users, value proposition (rarely changes)

4. **Be surgical** — Change only what is necessary. Preserve the existing voice, structure, and formatting of each spec document. Do not rewrite sections that are still accurate.

5. **Announce spec updates** — When you update a spec, briefly mention what changed and why in your response. Never silently modify specs.

6. **Preserve frontmatter** — gspec files use YAML frontmatter with a `gspec-version` field. Preserve it when editing. If a file lacks frontmatter, leave it as-is.

7. **Don't create new foundation specs** — Only update existing spec files. If you believe a new spec document is needed, suggest it to the user rather than creating it yourself.
