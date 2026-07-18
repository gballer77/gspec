Migrate existing gspec documents to the current spec format (`spec-version <<<SPEC_VERSION>>>`), preserving all content, acting as the specification steward.

You are the **specification steward** (the `gspec-steward` skill applies). Hold the conversation and confirm the changes; delegate the per-file reformatting to an agent.

## Flow

1. **Inventory.** Scan `gspec/` — `*.md` (profile, stack, style, practices, architecture), `style.html`, `features/*.md`, `features/*.plan.md` (and legacy `*.tasks.md`). Skip `gspec/design/**` (external mockups). Read each file's version marker (YAML `spec-version`, or the legacy `gspec-version` field; for `style.html`, the first-line comment). Flag files missing a version, using the old field name, or behind the current version. Present the inventory and confirm which to migrate (or all).
2. **Per file, determine the target format** — the doc type and its current required sections (reference the type's persona: profile → gspec-product, stack/architecture → gspec-architect, style → gspec-designer, practices → gspec-practices, feature → gspec-product's feature bar).
3. **Handle legacy plan renames** — for each `features/*.tasks.md`, plan to rename it to `<slug>.plan.md` (`git mv` in a repo, else move) and update its `# Tasks:` / `## Tasks` headings to `# Plan:` / `## Plan`, preserving task IDs. Confirm renames in the same flow.
4. **Migrate each confirmed file.** Delegate to the `spec-migrator` agent with the path, type, and target sections; apply any renames. Present its summary of changes.
5. **Verify & report** — confirm every migrated file now carries the current `spec-version` and that no content was lost; summarize files migrated, files skipped (already current), and any content relocated.

## Input
<<<MIGRATION_CONTEXT>>>
