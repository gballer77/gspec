The user keeps a personal library of reusable, saved specs — **templates** — under `~/.gspec`. A template is a finished spec from a past project, generalized to seed a new one. Writers preload this skill so a new spec can start from proven work instead of a blank page. It supplies the mechanic; the persona supplies the quality bar the adapted result must still meet.

## Where the library lives
`~/.gspec/` (the user's home directory — a global library, distinct from a project's own `.gspec/` runtime folder). One folder per spec type; each file is a real spec with `name` / `gspec-version` / `description` frontmatter you match on:

| Folder | Seeds | Persona |
|---|---|---|
| `~/.gspec/stacks/` | `gspec/stack.md` | `gspec-architect` |
| `~/.gspec/styles/` | `gspec/style.md` or `style.html` | `gspec-designer` |
| `~/.gspec/practices/` | `gspec/practices.md` | `gspec-practices` |
| `~/.gspec/features/` | `gspec/features/<slug>.md` | `gspec-product` |

Only these four spec types have a library. **profile.md and architecture.md do not** — they are inherently project-specific, so never seed them from a template. If a folder is absent or empty, there are simply no templates; proceed as normal.

## Matching
List the relevant folder and read each candidate's frontmatter `name` + `description`. A template is *relevant* when its description fits the project's type and intent (e.g. a "pure browser 2D game" stack template for a browser game). Prefer a close fit; never force a mismatched one — a poor template is worse than none.

**Paths.** `~` is the user's home directory; file tools may not expand it. The orchestrating command (which has a shell) resolves the library location and hands the chosen template's **absolute path** to the writer in the brief — so an isolated writer reads that absolute path, never a literal `~/…`. A writer that must discover templates itself should list the folder by its absolute path, not the `~` form.

## Two modes — offer vs. adopt
- **Interactive (a command holds the conversation).** Surface the matching template(s) by name + description and let the user choose: **start from it**, **adapt it**, or **write fresh**. Fold the choice into the brief handed to the writer (name the template file, or state "write fresh — ignore templates"). This is where the decision belongs; the isolated writer only executes it.
- **Isolated / autonomous (a writer runs headless, e.g. the build — no user to ask).** Precedence: an explicit instruction in the brief wins (use the named template, or none). Absent any template instruction, you *may* discover and adopt the **single best-fitting** template yourself; if nothing fits well, write fresh.

## Adapting a template (never blind-copy)
A template is a starting point, not the answer. When you adopt one:
- **Tailor it to this project** — reconcile every choice against the current brief and the other specs already present; change what doesn't fit. The persona's quality bar still governs the result exactly as if you wrote it from scratch.
- **Honor the boundaries** — stack/style/practices templates are already profile-agnostic (`gspec-agnosticism`); keep them so. Never carry another project's identity or unrelated tech into the new spec.
- **Bring it current** — rewrite the frontmatter to this project's `spec-version` and conform to the current `gspec-conventions` (a template may be an older `gspec-version`).
- **Record provenance** — note in your return summary which template seeded the spec and the material ways you diverged, so the choice is auditable.
