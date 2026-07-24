# gspec — repo working rules

`gspec` is a meta-system that installs spec-driven-development commands/agents/skills into other
projects and provides an autonomous `gspec build` runtime. The source of truth lives in `plugin/`
(agents, commands, skills, hooks), `lib/` (the build runtime + engine adapters), `bin/` (the CLI),
and `scripts/` (the build/emit that produces `dist/`). The public docs site is under `website/`.

## Documentation stays in sync with code — do not skip this

**Any change that a user could notice must be reflected in the docs in the same change.** This repo
has drifted before (releases shipped without changelog entries); treat docs as part of "done", not a
follow-up. When you change behavior, before you consider the work finished, update every surface below
that the change touches:

- **`website/src/pages/releases.astro`** — the public changelog. **Every user-facing change gets an
  entry** (newest-first) whose `version` matches `package.json`, with `added`/`changed`/`fixed`/`removed`
  items and a `migration` note. A version bump with no changelog entry is a bug.
- **`package.json` + `package-lock.json`** — bump the version (patch/minor/major) for any shipped change,
  and keep both files in lockstep.
- **`README.md`** — when install steps, flags, commands, or the top-level feature set change.
- **`docs/gspec-v2-design.md`** — when the stage graph, agent roster, or an architectural contract
  changes (e.g. adding an agent or a build stage).
- **`plugin/` prose** — the agent/command/skill Markdown *is* user-facing behavior docs; keep the
  `.md` you change consistent with what the code now does, and update `scripts/manifest.js` when adding
  or renaming an agent/command/skill.
- **`website/` content pages and `website/gspec/` specs** — when a described behavior (build flow,
  platform support, getting-started steps) changes.

Judgment applies to *scope*, not to *whether*: a pure internal refactor with zero user-visible effect
may not need a changelog entry, but say so explicitly rather than silently skipping. When in doubt, add
the entry.

## Release flow

Releases are tag-driven. Ship = merge to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`
(pushing commits alone does not publish). The changelog entry and version bump must land **before** the
tag, so the published artifact and the site agree.

## Tests

`npm test` runs `scripts/build.js` first (regenerates `dist/`, which is gitignored) then the suite. Run
it before committing behavior changes. Build-runtime tests live in `test/build-*.test.mjs`; hook tests in
`plugin/hooks/*/*.test.mjs`.
