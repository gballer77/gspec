// Floor: spec integrity (pure, I/O-free).
//
// Every gspec spec must carry a current spec-version marker: Markdown specs need
// YAML frontmatter with `spec-version` at the very top; the HTML style guide
// needs a first-line `<!-- spec-version: vX -->` comment. This module decides
// whether a path is subject to the check and, if so, returns any violation
// messages. Entry points read the file and signal the violation.

export const SPEC_VERSION = 'v1'; // keep in sync with SPEC_VERSION in scripts/build.js

// Which paths this floor governs. Only docs under gspec/, excluding the
// read-only design/ mockups and any README.
export function appliesToSpecIntegrity(rel) {
  const r = String(rel).replace(/\\/g, '/');
  if (!r.startsWith('gspec/')) return false;
  if (r.startsWith('gspec/design/')) return false;
  const base = r.split('/').pop();
  if (base.toLowerCase() === 'readme.md') return false;
  return base.endsWith('.md') || base.endsWith('.html');
}

// Violation messages for a spec file's content ([] = clean). Assumes the caller
// already filtered with appliesToSpecIntegrity().
export function specIntegrityViolations(rel, content) {
  const r = String(rel).replace(/\\/g, '/');
  const base = r.split('/').pop();
  const out = [];

  if (base.endsWith('.html')) {
    const first = String(content).split('\n').find((l) => l.trim() !== '') || '';
    const m = first.match(/<!--\s*spec-version:\s*(\S+)\s*-->/);
    if (!m) out.push(`${r} is missing its first-line "<!-- spec-version: ${SPEC_VERSION} -->" comment.`);
    else if (m[1] !== SPEC_VERSION) out.push(`${r} has spec-version ${m[1]}, expected ${SPEC_VERSION}. Run /gspec-migrate.`);
    return out;
  }

  // Markdown spec: YAML frontmatter with spec-version at the very top.
  const fm = String(content).match(/^﻿?\s*---\s*\n([\s\S]*?)\n---/);
  if (!fm) {
    out.push(`${r} is missing its YAML frontmatter ("---\\nspec-version: ${SPEC_VERSION}\\n---") at the top.`);
    return out;
  }
  const ver = fm[1].match(/^spec-version:\s*(\S+)\s*$/m);
  if (!ver) out.push(`${r} frontmatter has no spec-version field (expected ${SPEC_VERSION}).`);
  else if (ver[1] !== SPEC_VERSION) out.push(`${r} has spec-version ${ver[1]}, expected ${SPEC_VERSION}. Run /gspec-migrate.`);
  return out;
}
