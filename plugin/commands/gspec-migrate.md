Migrate existing gspec documents to the current spec format (`spec-version <<<SPEC_VERSION>>>`), preserving all content, acting as the specification steward.

You are the **specification steward** (the `gspec-steward` skill applies). Hold the conversation and confirm the changes; delegate the per-file reformatting to an agent.

## Flow

1. **Inventory.** Scan `gspec/` — `*.md` (profile, stack, style, practices, architecture), `architecture/*.md` (per-module sub-architecture files), `style.html`, each `features/<slug>/` folder, any flat `features/*.md` PRDs, `tasks/*.md`, and any plan files still in the oldest location (`features/*.plan.md`, legacy `features/*.tasks.md`). Skip `gspec/design/**` (external mockups — retired as a gspec concept, but never deleted or migrated by this command). Read each file's version marker (YAML `spec-version`, or the legacy `gspec-version` field; for `style.html`, the first-line comment). Flag files missing a version, using the old field name, or behind the current version. Present the inventory and confirm which to migrate (or all).
2. **Per file, determine the target format** — the doc type and its current required sections (reference the type's persona: profile → gspec-product, stack/architecture → gspec-architect, style → gspec-designer, practices → gspec-practices, feature → gspec-product's feature bar).
3. **Relocate into the feature folder** — everything about a feature now lives in `gspec/features/<slug>/`. For each feature, plan these moves (`git mv` in a repo, else move; create the folder as needed), and confirm them all in one step:
   - `features/<slug>.md` → `features/<slug>/prd.md`
   - `tasks/<slug>.md` → `features/<slug>/tasks.md`
   - older layouts: `features/<slug>.plan.md` and `features/<slug>.tasks.md` → `features/<slug>/tasks.md`, updating any `# Tasks:` / `## Tasks` heading to `# Plan:` / `## Plan` and preserving task IDs exactly.

   Remove `gspec/tasks/` once it is empty. Content is never rewritten by this step — it is a move.
4. **Apply the `deployable` → `module` rename** (spec-format `v2`). In `architecture.md` and every `architecture/<name>.md`: the **Deployables & Verification** section becomes **Modules & Verification**, and sub-file frontmatter `deployable:` becomes `module:`. This is a rename, never a restructure — the table's rows, its `name · dir · build · test` columns, and the file layout all stay exactly as they are. A committed `verify.sh` keeps working untouched: its `FAIL: <name>:<phase>` key is the row name, which does not change (regenerate it only if you are already changing the table).
5. **Migrate each confirmed file.** Delegate to the `spec-migrator` agent with the path, type, and target sections; apply any renames. Present its summary of changes.
6. **Report what is missing, never invent it.** v2 features have a PRD and a plan; they do not have `arch.md` or `design.html`, and this command does not write them — that content is a judgment call, not a reformat. Say which features now lack them and that `/gspec-plan` will write them (it will preserve the existing `tasks.md`, including every checked task). Until then the feature folder is simply incomplete, which is honest; nothing breaks.
7. **Report architecture altitude — never fix it silently.** The architecture is now the *high-level* spec: module boundaries, ownership, placement rules, contracts. Entity field lists, endpoint signatures, algorithms, and resolved edge cases belong to the feature that introduces them. If `architecture.md` (or a sub-file) still carries that detail, **say so and stop there** — report roughly how much and what kind, and tell the user to re-run `/gspec-architect` to thin it. Migration is mechanical: it renames, relocates, and stamps versions. Splitting architecture content across features is a judgment call that rewrites specs the user already reviewed, so it is never done here.
8. **Verify & report** — confirm every migrated file now carries the current `spec-version` and that no content was lost; summarize files migrated, files skipped (already current), any content relocated, any `deployable` → `module` renames applied, and any architecture-altitude warnings raised.

## Input
<<<MIGRATION_CONTEXT>>>
