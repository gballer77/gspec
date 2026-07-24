// Floor: style-guide token literals (pure, I/O-free).
//
// In gspec/style.html the design-token block (custom properties on `:root` /
// theme-key selectors) is the single source of truth for color; every other
// rule must reference tokens via var(--…). A literal color anywhere else is a
// second copy of a decision that can drift from the first — the dominant QA
// failure mode in large style guides (see gspec-conventions, "Single source of
// truth"). This module decides whether a path is subject to the check and
// finds literal colors declared outside token blocks, in <style> CSS and in
// inline style="…" attributes. It does NOT scan text content — a swatch label
// that *displays* a hex code is documentation, not a declaration. Entry points
// read the file and signal the violation.

// Which paths this floor governs. Only the HTML style guide — a Markdown
// guide's token tables aren't mechanically separable from its prose.
export function appliesToTokenLiterals(rel) {
  return String(rel).replace(/\\/g, '/') === 'gspec/style.html';
}

// A selector under which literal colors are allowed: the token blocks.
// `:root`, theme-key attribute selectors ([data-theme=…]), and the common
// theme-class conventions (.dark/.light/.theme-*).
function isTokenSelector(sel) {
  const s = String(sel).trim();
  return s.includes(':root') || s.includes('[data-theme') || /(^|[\s,>])\.(dark|light|theme-[\w-]+)\b/.test(s);
}

// Literal color values. Keyword colors and sizes are deliberately out of
// scope (too noisy to guard mechanically); hex/rgb/hsl/oklch cover how a
// palette actually leaks. var()/color-mix() over tokens never match.
const COLOR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/gi;

const MAX_REPORTED = 5;

function stripCssComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

// Literal colors declared outside a token block ([] = clean). Assumes the
// caller already filtered with appliesToTokenLiterals().
export function tokenLiteralViolations(content) {
  const html = String(content);
  const offenders = []; // { literal, where }

  // <style> blocks: walk declarations with a selector stack so a :root block
  // nested in @media still counts as a token block.
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = stripCssComments(m[1]);
    const stack = [];
    let buf = '';
    for (const ch of css) {
      if (ch === '{') { stack.push(buf.trim()); buf = ''; continue; }
      if (ch === '}') { scanDecl(buf, stack, offenders); stack.pop(); buf = ''; continue; }
      if (ch === ';') { scanDecl(buf, stack, offenders); buf = ''; continue; }
      buf += ch;
    }
  }

  // Inline style attributes: never a token block, so any literal color hits.
  for (const m of html.matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const decl = m[2] ?? m[3] ?? '';
    for (const lit of decl.match(COLOR_RE) || []) offenders.push({ literal: lit, where: 'an inline style attribute' });
  }

  if (!offenders.length) return [];
  const shown = offenders.slice(0, MAX_REPORTED)
    .map((o) => `"${o.literal}" in ${o.where}`).join(', ');
  const more = offenders.length > MAX_REPORTED ? ` (and ${offenders.length - MAX_REPORTED} more)` : '';
  return [
    `gspec/style.html declares literal colors outside the design-token block: ${shown}${more}. ` +
    'The token block (:root / theme-key selectors) is the only place a literal color may appear — ' +
    'style everything else with var(--…) so values cannot drift.',
  ];
}

function scanDecl(decl, stack, offenders) {
  if (!decl.trim() || stack.length === 0) return;         // outside any rule (stray text)
  if (stack.some(isTokenSelector)) return;                // inside a token block
  for (const lit of decl.match(COLOR_RE) || []) {
    offenders.push({ literal: lit, where: `"${stack[stack.length - 1] || '(unknown selector)'}"` });
  }
}
