// The exact identifiers a writer must cite, computed by the driver — pure.
//
// The plan floor resolves `arch:` refs by slug, and the design floor matches
// `<section id="screen-…">` by slug, using one algorithm (slugifyAnchor in
// plan-lint.mjs). Writers were told "the slugified H3 text" and left to guess
// the algorithm: on a measured run 27 of 31 plan violations were a writer
// writing `#entity-ingredientline` for `### Entity: IngredientLine`. The
// reference was unambiguous; only the hyphenation was wrong.
//
// So the driver hands over the list. The prompt says "cite exactly these",
// the lint-fix prompt names the valid targets beside an unresolved ref, and
// nothing is left to derive.

import { slugifyAnchor } from '../plugin/hooks/floors/plan-lint.mjs';

// Every H3 anchor in an arch.md with the section it sits under:
// [{ section, heading, slug }] in file order.
export function anchorGlossary(archText) {
  const out = [];
  let section = null;
  for (const line of String(archText).split('\n')) {
    const h2 = line.match(/^##\s+(\S+)/);
    if (h2) { section = h2[1]; continue; }
    if (!/^###\s/.test(line)) continue;
    const heading = line.trim();
    out.push({ section, heading, slug: slugifyAnchor(heading) });
  }
  return out;
}

// The `<section id>` each `### Screen:` under ## UI must have: [{ id, name }].
export function screenIds(archText) {
  return anchorGlossary(archText)
    .filter((a) => a.section === 'UI' && /^###\s+Screen:/.test(a.heading))
    .map((a) => ({ id: `screen-${slugifyAnchor(a.heading.replace(/^###\s+Screen:\s*/, ''))}`, name: a.heading.replace(/^###\s+Screen:\s*/, '').trim() }));
}

// The block a plan prompt (or a lint fix) carries. '' when the arch has no anchors.
export function formatAnchorGlossary(archText, rel = 'arch.md') {
  const list = anchorGlossary(archText);
  if (!list.length) return '';
  return [
    `The anchors in ${rel}, with the exact \`arch:\` reference for each — cite these verbatim, do not derive your own slugs:`,
    ...list.map((a) => `  #${a.slug}  ←  ${a.heading}`),
  ].join('\n');
}

// The block a design prompt (or a lint fix) carries. '' when there are no screens.
export function formatScreenIds(archText, rel = 'arch.md') {
  const list = screenIds(archText);
  if (!list.length) return '';
  return [
    `The screens in ${rel}, with the exact \`<section id>\` each must have — use these verbatim:`,
    ...list.map((s) => `  id="${s.id}"  ←  ### Screen: ${s.name}`),
  ].join('\n');
}
