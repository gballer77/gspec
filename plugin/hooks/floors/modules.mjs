// Floor: the Modules & Verification table (pure, I/O-free).
//
// The table in gspec/architecture.md is the single authority for what the system
// is built from: verify.sh's steps and FAIL keys come from it, the audit checks
// it against the real toolchain, and — since the two-tier layout — it decides
// which gspec/architecture/<name>.md files must exist.
//
// This module takes TEXT and returns data; every caller does its own I/O. That
// keeps it usable from the hook floors (which are pure by contract), the build
// driver, and the installer alike.

// One row of the table.
// | name | dir | build | test |
/** @typedef {{ name: string, dir: string, build: string, test: string }} ModuleRow */

const SECTION = /^#{1,6}\s+Modules\s*(?:&|and)\s*Verification\b/i;
// Legacy heading — pre-v2 specs say "Deployables". Recognized so a project that
// has not run /gspec-migrate yet still parses rather than silently yielding [].
const LEGACY_SECTION = /^#{1,6}\s+Deployables\s*(?:&|and)\s*Verification\b/i;
const HEADING = /^#{1,6}\s+/;
const SEPARATOR = /^\|[\s|:-]+\|$/;

function cells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// Strip markdown emphasis/code/links so `**web**` and `` `web` `` both yield web.
function plain(cell) {
  return String(cell)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [web](architecture/web.md) → web
    .replace(/[*_`]/g, '')
    .trim();
}

// Parse the Modules & Verification table out of an architecture spec.
// Returns [] when the section is absent, marked Not Applicable, or malformed —
// "no modules declared" and "no table" are the same answer to every caller.
export function parseModulesTable(architectureMdText) {
  const lines = String(architectureMdText).split('\n');
  let i = lines.findIndex((l) => SECTION.test(l) || LEGACY_SECTION.test(l));
  if (i === -1) return [];

  const rows = [];
  let sawHeader = false;
  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (HEADING.test(line)) break;             // next section ends the search
    const c = cells(line);
    if (!c) continue;
    if (SEPARATOR.test(line.trim())) { sawHeader = true; continue; }
    if (!sawHeader) continue;                  // the header row itself
    if (c.length < 4) continue;
    const [name, dir, build, test] = c.map(plain);
    if (!name) continue;
    rows.push({ name, dir, build, test });
  }
  return rows;
}

// The module-tier spec paths this table implies.
//
// The layout gate: ONE module is described entirely by the root architecture.md
// (a second file for a single module is pure ceremony), so a one-row table
// implies no sub-files at all. More than one row → exactly one file per row,
// keyed by the row name.
export function moduleSpecPaths(modules = []) {
  if (modules.length < 2) return [];
  return modules.map((m) => `gspec/architecture/${m.name}.md`);
}

// Referential integrity between the table and what is actually on disk.
// `presentPaths` is whatever the caller found under gspec/architecture/.
//   missing — a row whose file was never written
//   orphans — a file no row claims (a half-finished rename leaves one of each)
export function moduleSpecDrift(modules = [], presentPaths = []) {
  const expected = new Set(moduleSpecPaths(modules));
  const present = new Set(presentPaths.map((p) => String(p).replace(/\\/g, '/')));
  return {
    missing: [...expected].filter((p) => !present.has(p)),
    orphans: [...present].filter((p) => !expected.has(p)),
  };
}
