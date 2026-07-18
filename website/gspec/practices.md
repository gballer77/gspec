---
spec-version: v1
---

# Development Practices Guide — gspec

## 1. Overview

- **Team:** Solo developer
- **Project type:** Open-source CLI tool + AI skill system (shell scripts, Markdown skill files, Node.js packaging)
- **Stage:** Early MVP
- **Development style:** Trunk-based development — commit directly to main, short-lived branches only when experimenting

---

## 2. Core Development Practices

### Testing Standards

#### Unit Tests
- **Coverage expectation:** New or changed non-trivial logic — parsing, file generation, CLI argument handling, version detection, and platform-specific install paths — must ship with a test in the same change. Trivial wrappers and prose content are exempt (see below)
- **What to test:**
  - Functions that transform data (e.g., parsing frontmatter, generating file paths, resolving platform directories)
  - Edge cases in CLI argument parsing and validation
  - File system operations — use temp directories, not mocks, for file I/O tests
  - Version comparison and migration logic
- **What not to test:**
  - Simple pass-through functions or trivial wrappers
  - Markdown content or skill prompt text (these are prose, not logic)
  - Third-party library behavior

#### E2E Tests
- **When to use:** For critical user-facing workflows where a unit test can't catch integration failures:
  - `npx gspec` install flow across supported platforms (Claude Code, Cursor, Codex, Antigravity)
  - Skill file installation and removal
  - Spec-sync trigger behavior
- **Keep E2E tests minimal and focused** — each test should cover one complete workflow, not a matrix of variations

#### Test Organization
- Test files live alongside source files or in a `tests/` directory mirroring the source structure
- Name test files `<module>.test.sh` or `<module>.test.js` matching the source file
- Each test file tests one module or one workflow
- Test names describe the behavior, not the implementation: `"installs skills to Claude Code config directory"` not `"calls copyFiles with correct args"`

#### When to Write Tests
- Write tests when adding new logic or fixing bugs — the bug fix test proves the fix works and prevents regression
- Skip tests for exploratory or prototype code, but add them before considering the feature stable
- If a change touches install paths or platform detection, add or update an E2E test

### Code Quality Standards

- **DRY:** Extract shared logic only when it's used in 3+ places. Two similar blocks are fine — premature abstraction is worse than repetition in a small codebase
- **Nesting:** Maximum 3 levels of nesting in shell scripts. Use early returns and guard clauses to flatten logic
- **Function length:** Keep functions under 40 lines. If a function does multiple distinct things, split it
- **Complexity:** If a shell function has more than 4 conditional branches, refactor into smaller functions or use a case statement
- **Code review:** Not applicable for solo development. Rely on tests and AI-assisted review via `gspec-analyze` and diff review before committing

### Code Organization

- **File structure:** Group by function — install logic, platform detection, skill management, and spec-sync are separate modules
  - The GitHub Pages website lives in the `pages/` folder with its own `package.json`, separate from the CLI package
- **Naming conventions:**
  - Shell scripts: `kebab-case.sh`
  - Skill files: `gspec-<command-name>` matching the slash command name
  - Variables: `snake_case` in shell, `camelCase` in JavaScript
  - Constants: `UPPER_SNAKE_CASE`
- **Separation of concerns:**
  - CLI entry point handles argument parsing and dispatching only
  - Platform-specific logic is isolated in platform modules — no platform `if/else` chains in core logic
  - Skill content (Markdown prompts) is separate from skill installation logic

---

## 3. Version Control & Collaboration

### Git Practices

- **Branch strategy:** Trunk-based — work directly on `main` for routine changes. Use short-lived branches (`experiment/<name>`) only for risky experiments that might be abandoned
- **Commit messages:** Imperative mood, concise first line (≤ 72 chars). Body when the "why" isn't obvious from the diff
  ```
  Add spec-sync trigger for architecture changes

  The sync was only checking profile and style docs. Architecture
  changes now trigger a reconciliation prompt as well.
  ```
- **Commit size:** One logical change per commit. Don't mix refactoring with feature work in a single commit
- **Tags:** Use semver tags (`v1.6.0`) for npm releases

### Code Review Standards

Not Applicable — solo developer. Use tests and self-review of diffs before committing.

---

## 4. Documentation Requirements

- **Comments in code:**
  - Comment the "why," not the "what" — if the code needs a "what" comment, the code should be clearer
  - Always comment non-obvious shell idioms, platform-specific workarounds, or compatibility hacks
  - No boilerplate comment headers on files or functions
- **README:** Keep `README.md` focused on getting started — install, usage, and a brief explanation. The gspec docs site handles deeper content
- **Skill files:** Each skill's Markdown prompt is self-documenting. Keep the system prompt instructions clear enough that a developer reading them understands the expected behavior
- **Changelog:** Update for each release with user-facing changes grouped by Added/Changed/Fixed/Removed

---

## 5. Error Handling & Logging

- **Fail fast:** If a required directory, file, or tool isn't found, exit immediately with a clear error message. Don't attempt partial installs
- **Error messages:** Include what went wrong, what was expected, and what the user can do about it
  ```
  Error: Claude Code config directory not found at ~/.claude/
  Expected: ~/.claude/ to exist. Run Claude Code at least once before installing gspec.
  ```
- **Exit codes:** Use non-zero exit codes for all error paths. Use distinct codes for different failure categories if helpful for scripting
- **Logging levels:**
  - Default: Only output that the user needs to see (install progress, success/failure)
  - Verbose (`--verbose` or `-v`): Include file paths being written, platform detection results, and skip reasons
  - No debug logging in released code — use verbose mode instead
- **Never swallow errors silently** — no error branch may `exit 0` or return without emitting a message. If a file copy fails, report it and exit non-zero; don't continue as if it succeeded

---

## 6. Performance & Optimization

- **Install speed:** The `npx gspec` flow should complete in under 5 seconds on a warm npm cache. Minimize dependencies in `package.json` to keep install fast
- **No premature optimization:** The CLI runs once per install, not in a hot loop. Optimize for clarity and correctness, not speed
- **Dependency weight:** Every npm dependency adds install time and supply chain risk. Prefer built-in Node.js APIs and shell utilities over adding packages for trivial operations
- **Website:** Target perfect Lighthouse scores (the Astro static site should achieve this by default — don't regress it)

---

## 7. Security Practices

- **Input validation:** Validate all user-provided paths and arguments before using them in file operations or shell commands. Never interpolate raw user input into shell commands without sanitization
- **No secrets in the repo:** The project has no secrets, API keys, or credentials. Keep it that way. If secrets are ever needed, use environment variables and document them
- **File permissions:** Don't change file permissions unless necessary. Skill files should be readable, not executable
- **Supply chain:** Keep npm dependencies minimal. Pin exact versions in `package-lock.json`. Review dependency updates before merging
- **Common vulnerabilities to avoid:**
  - Command injection via unsanitized path interpolation in shell scripts
  - Path traversal — validate that generated file paths stay within expected directories
  - Symlink attacks — don't follow symlinks when writing to config directories

---

## 8. Refactoring Guidelines

- **When to refactor:** When you're about to add a feature and the existing code makes it awkward. Refactor first in a separate commit, then add the feature
- **When to rewrite:** Only when the current approach is fundamentally wrong (e.g., a platform detection strategy that can't support a new platform). This should be rare at MVP stage
- **Safe refactoring:** Always have passing tests before refactoring. If there are no tests for the code you're about to refactor, add them first
- **Technical debt:** At MVP stage, accept some debt intentionally. Track significant debt with `TODO:` comments that include context:
  ```bash
  # TODO: This copies skills one-by-one. Batch copy would be cleaner
  # but isn't worth the complexity until we have more than 12 skills.
  ```
- **Boy Scout Rule:** Apply lightly — clean up what you touch, but don't refactor unrelated code in the same commit

---

## 9. Definition of Done

A change is done when:

- [ ] The code works correctly for the intended use case
- [ ] Unit tests cover new or changed logic
- [ ] E2E test added or updated if the change affects install flows or platform integration
- [ ] Error paths produce clear, actionable messages
- [ ] `--verbose` output is helpful for debugging
- [ ] No regressions in existing tests
- [ ] Commit message explains the "why"
- [ ] Version bumped in `package.json` if this is a release
- [ ] Changelog updated if this is a user-facing change

---

## 10. When to Use `/gspec-plan`

`/gspec-plan` decomposes a feature PRD into an ordered, dependency-aware plan at `gspec/features/<feature>.plan.md`. Use it as a planning step between `/gspec-feature` and `/gspec-implement` when:

- The feature has more than ~3-4 capabilities and the build order is non-obvious
- Capabilities have cross-dependencies that would benefit from being declared explicitly (`deps:` lines)
- Some work is parallel-safe and you want that surfaced (`[P]` markers) so `/gspec-implement` can fan it out
- You want a reviewable execution plan in writing before any code lands

When a plan file exists for every in-scope feature, `/gspec-implement` skips its own plan-mode step — the plan was already approved during `/gspec-plan`.

---

## 11. Enforcement

This section declares how the practices above are enforced, so they run as hooks
rather than living only as advisory context. It is a structured, machine-readable
companion to the prose — the prose remains the "why," this block is the "what runs."

The block is read live by the `gspec-practices-enforce` PostToolUse hook
(installed with gspec on Claude Code). After each file write it runs the built-in
deterministic checks whose `applies_to` matches the edited file and surfaces
`error`-severity violations back to the editor. Because the hook reads this block
at runtime, editing a rule takes effect on the next write — there is nothing to
generate or regenerate. Rules are keyed by `id`.

Currently enforced by the hook: `max-nesting`, `max-function-length`, and
`file-naming` (shell files). `format`, `block`, `gate`, and `judge` actions are
declared here for their tooling (formatters, git hooks, CI, and LLM review) and
are not run by the PostToolUse hook.

`action` taxonomy:

- `format` — auto-fix and rewrite the edited file (formatter config is the source of truth; do not restate values here)
- `lint` — inspect the edited file and report findings
- `block` — reject the change before it lands (PreToolUse `exit 2`, or a git hook)
- `gate` — end-of-turn / CI check (Stop hook or CI job)
- `judge` — delegate to an LLM `reviewer` subagent; not text-decidable

```yaml
version: 1
rules:
  # --- format: auto-fix on write; formatter config is the source of truth ---
  - id: code-format
    source: "§2 Code Quality"
    action: format
    event: PostToolUse
    applies_to: ["*.sh", "*.js", "*.md"]
    config: .editorconfig          # indent/tabs/quotes/line-length live here, not in this block
    # tool resolved from stack.md (e.g. prettier + shfmt)

  # --- lint: report on the edited file ---
  - id: max-nesting
    source: "§2 Code Quality"
    action: lint
    event: PostToolUse
    applies_to: ["*.sh"]
    severity: error
    params: { max_depth: 3 }
  - id: max-function-length
    source: "§2 Code Quality"
    action: lint
    event: PostToolUse
    applies_to: ["*.sh", "*.js"]
    severity: error
    params: { max_lines: 40 }
  - id: max-branches
    source: "§2 Code Quality"
    action: lint
    event: PostToolUse
    applies_to: ["*.sh"]
    severity: warn
    params: { max_conditional_branches: 4 }
  - id: file-naming
    source: "§2 Code Organization"
    action: lint
    event: PostToolUse
    applies_to: ["*.sh"]
    severity: error
    params: { pattern: kebab-case }
  - id: test-file-naming
    source: "§2 Test Organization"
    action: lint
    event: PostToolUse
    applies_to: ["*.test.sh", "*.test.js"]
    severity: warn
    params: { pattern: "<module>.test.<ext>" }
  - id: error-branch-nonzero-exit
    source: "§5 Error Handling"
    action: lint
    event: PostToolUse
    applies_to: ["*.sh"]
    severity: error
  - id: skill-files-not-executable
    source: "§7 Security"
    action: lint
    event: PostToolUse
    applies_to: ["skills/**"]
    severity: error
    params: { mode: non-executable }

  # --- block: reject before the change lands ---
  - id: no-secrets
    source: "§7 Security"
    action: block
    event: PreToolUse
    applies_to: ["*"]
    severity: error
    # tool resolved from stack.md (e.g. gitleaks)
  - id: no-raw-path-interpolation
    source: "§7 Security"
    action: block
    event: PreToolUse
    applies_to: ["*.sh"]
    severity: error
  - id: commit-message-format
    source: "§3 Git Practices"
    action: block
    event: git:commit-msg          # git hook, not a Claude Code hook
    severity: error
    params: { imperative: true, max_subject: 72 }
  - id: semver-tags
    source: "§3 Git Practices"
    action: block
    event: git:pre-push
    severity: error
    params: { pattern: "v<major>.<minor>.<patch>" }

  # --- gate: end-of-turn / CI checks ---
  - id: definition-of-done
    source: "§9 Definition of Done"
    action: gate
    event: Stop
    severity: error
  - id: tests-for-new-logic
    source: "§2 When to Write Tests"
    action: gate
    event: Stop
    severity: error
  - id: install-under-5s
    source: "§6 Performance"
    action: gate
    event: ci
    severity: warn
    params: { max_seconds: 5 }
  - id: lighthouse-perfect
    source: "§6 Performance"
    action: gate
    event: ci
    applies_to: ["pages/**"]
    severity: warn

  # --- judge: LLM reviewer subagent; not text-decidable ---
  - id: comment-the-why
    source: "§4 Documentation"
    action: judge
    event: Stop
    severity: warn
  - id: one-logical-change-per-commit
    source: "§3 Git Practices"
    action: judge
    event: Stop
    severity: warn
  - id: error-message-quality
    source: "§5 Error Handling"
    action: judge
    event: Stop
    severity: warn
```

Skip it for trivial features — `/gspec-implement`'s checkbox-driven planning is sufficient when the order doesn't matter and there's nothing to parallelize.
