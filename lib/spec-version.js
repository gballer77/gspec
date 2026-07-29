// The spec-format version — the single source of truth for the whole repo.
//
// Every gspec spec carries this marker (Markdown: `spec-version` frontmatter;
// gspec/style.html: a first-line `<!-- spec-version: vX -->` comment), and the
// spec-integrity floor fails a spec whose marker doesn't match. Bumping it is a
// spec-FORMAT change: it tells existing projects to run /gspec-migrate.
//
// Three consumers import this; a fourth cannot and is checked instead:
//   • bin/gspec.js      — the installer's outdated-spec warnings
//   • scripts/build.js  — substitutes <<<SPEC_VERSION>>> into every emitted artifact
//   • (tests)
//   • plugin/hooks/floors/spec-integrity.mjs keeps a LITERAL copy: floors are
//     copied standalone into .claude/hooks/floors/ and cannot import from lib/.
//     templates/preamble.md likewise states it in prose. test/spec-version.test.mjs
//     asserts all four agree — the drift this file exists to prevent.
export const SPEC_VERSION = 'v2';
