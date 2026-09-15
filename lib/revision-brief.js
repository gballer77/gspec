// Anchored findings → lean revisions. Pure.
//
// A writer revision cost 194–243% of a first draft on a measured build. The
// revision prompt said "read the existing document and make ONLY the edits the
// findings name", then appended every prior verdict in full. With no anchor to
// jump to, the writer re-read everything; and the prompt grew each round.
//
// The QA contract now asks each finding to carry an `anchor:` line — the
// exact heading it is about (or `line: N` for HTML). This module parses the
// findings out of a verdict, slices the named sections out of the document,
// and summarizes earlier rounds to one line each, so the revision prompt can
// inline what the writer must edit and nothing else.

import { slugifyAnchor } from '../plugin/hooks/floors/plan-lint.mjs';

// The contract's four, plus the words validators reach for anyway.
const SEVERITIES = 'blocker|major|minor|nit|critical|moderate|medium|low|trivial|info';
const SEVERITY_OF = { critical: 'blocker', moderate: 'major', medium: 'major', low: 'minor', trivial: 'nit', info: 'nit' };
const normalizeSeverity = (s) => SEVERITY_OF[s.toLowerCase()] || s.toLowerCase();
// A finding opens with its severity tag — as a list item (the contract), or
// as a numbered heading (`### 1. [MAJOR] …`), which a validator was observed
// writing and which the parser then read as zero findings, sending the
// revision down the whole-document path at 133% of an initial run.
const FINDING_START = new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:\\d+[.)]\\s*)?[-*]?\\s*\\**\\[(${SEVERITIES})\\]\\**\\s*(.*)$`, 'i');
// A line that ends the findings block: the next top-level contract key or a heading.
const BLOCK_END = /^(?:#{1,6}\s|(?:VERDICT|SPEC|SUMMARY|FINDINGS)\s*:)/i;
// A field line, with the colon inside or outside the emphasis (`**Evidence:**`
// and `evidence:` alike) and a possibly empty value (a fenced block follows).
const FIELD = (key) => new RegExp(`^\\s*[-*+]?\\s*[*_\`]{0,2}${key}\\s*(?::[*_\`]{0,2}|[*_\`]{0,2}\\s*:)\\s*(.*?)\\s*$`, 'i');
const ANCHOR_FIELD = FIELD('anchor');
const LINE_FIELD = FIELD('line');
const EVIDENCE_FIELD = FIELD('evidence');
// `Location: Lines 960–962` — the first number is a usable line locator.
const LOCATION_FIELD = new RegExp(`^\\s*[-*+]?\\s*[*_\`]{0,2}location\\s*(?::[*_\`]{0,2}|[*_\`]{0,2}\\s*:)\\s*(?:lines?\\s*)?(\\d+)`, 'i');
// `gspec/architecture/api.md → ### Entity: PantryItem` — an anchor in another file.
const FILE_ANCHOR = /^([^\s→:#]+\.(?:md|html))\s*(?:→|->|:|#|\s)\s*(.+)$/;

const unquote = (s) => String(s).trim().replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '').trim();

/**
 * The findings in a verdict: `[{ severity, criterion, text, anchor, line, evidence }]`.
 * `text` is the whole finding block (its line plus the indented fields) so a
 * prompt can reproduce it verbatim; `anchor` is the heading text with any
 * leading `#`s kept as written (null when absent); `line` is the number from
 * a `line:` field (null when absent).
 */
export function parseFindings(verdictText) {
  const lines = String(verdictText).split('\n');
  const out = [];
  let cur = null;
  let pendingEvidence = false; // an `evidence:` line with no value — the quote follows, often fenced
  for (const raw of lines) {
    const m = raw.match(FINDING_START);
    if (m) {
      cur = { severity: normalizeSeverity(m[1]), criterion: m[2].replace(/\*\*/g, '').replace(/^[:\s]+/, '').split(/\s+[—–-]\s+/)[0].trim(), text: raw.trimEnd(), anchor: null, line: null, evidence: null };
      // `**[major] Line 262: Literal motion duration**` — a validator puts the
      // locator in the title. It is a usable line unless a field says otherwise.
      const inTitle = m[2].match(/\b(?:line|L)\s*:?\s*(\d+)\b/i);
      if (inTitle) { cur.line = Number(inTitle[1]); cur.lineFromTitle = true; }
      out.push(cur);
      pendingEvidence = false;
      continue;
    }
    if (!cur) continue;
    if (!raw.trim()) continue;
    // The quote after a bare `evidence:` comes first: it is often a fenced
    // copy of the offending block, whose first line may itself be a heading.
    if (pendingEvidence) {
      cur.text += `\n${raw.trimEnd()}`;
      if (/^\s*(\`{3}|~{3})/.test(raw)) continue;           // the fence, not the quote
      cur.evidence = unquote(raw.replace(/^\s*>\s?/, ''));
      pendingEvidence = false;
      continue;
    }
    if (BLOCK_END.test(raw.trim()) && !/^\s/.test(raw)) { cur = null; continue; }
    cur.text += `\n${raw.trimEnd()}`;
    const a = raw.match(ANCHOR_FIELD);
    if (a) {
      const v = unquote(a[1]);
      if (!v) continue;
      // `line: 427` — or, as a validator wrote it, `line: 427, 563, 710, 842`
      // for one rule class in four places: every number is a locator.
      const ln = v.match(/^lines?\s*:?\s*(\d+(?:\s*[,&]\s*(?:and\s*)?\d+)*)\s*$/i);
      if (ln) { cur.lines = ln[1].match(/\d+/g).map(Number); cur.line = cur.lines[0]; }
      else cur.anchor = v;
      continue;
    }
    const l = raw.match(LINE_FIELD);
    if (l && /^\d+$/.test(l[1].trim())) { cur.line = Number(l[1]); continue; }
    const loc = raw.match(LOCATION_FIELD);
    if (loc && !cur.line && !cur.anchor) { cur.line = Number(loc[1]); continue; }
    const e = raw.match(EVIDENCE_FIELD);
    if (e) {
      const v = unquote(e[1]);
      if (v) cur.evidence = v; else pendingEvidence = true;
    }
  }
  return out;
}

const normHeading = (h) => String(h).replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The named sections of a document. `anchors` is a list of heading strings
 * (`### Entity: Order`, `Data`, `## Data`) and/or `{ line: N }` locators.
 * Returns one entry per anchor: `{ anchor, found, text }` — a markdown
 * heading's section runs to the next heading of the same or higher level; a
 * line locator yields ±`radius` lines. Matching is exact on the heading text
 * first, then by slug, then by containment — a validator that writes
 * `Entity: Order` for `### Entity: Order` still lands.
 */
export function sliceSections(docText, anchors = [], { radius = 12 } = {}) {
  const lines = String(docText).split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) headings.push({ at: i, level: m[1].length, text: m[2].trim() });
  }
  const sectionAt = (hi) => {
    const h = headings[hi];
    let end = lines.length;
    for (let j = hi + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) { end = headings[j].at; break; }
    }
    return { start: h.at + 1, end, text: lines.slice(h.at, end).join('\n').trimEnd() };
  };
  const findHeading = (anchor) => {
    // A path anchor — `## Logic / Rule: No Derived Copy`, `Data > Entity: Order`
    // — names its target LAST. Resolve that segment first; matching the whole
    // string fell through to containment on "Logic" and inlined the entire
    // section, twice, for a 7,600-word brief on a 4,800-word file.
    const parts = String(anchor).split(/\s+(?:\/|>|→|»)\s+/);
    if (parts.length > 1) {
      const hi = findHeading(parts[parts.length - 1]);
      if (hi >= 0) return hi;
    }
    const want = normHeading(anchor);
    if (!want) return -1;
    let hi = headings.findIndex((h) => normHeading(h.text) === want);
    if (hi >= 0) return hi;
    const slug = slugifyAnchor(anchor);
    if (slug) {
      hi = headings.findIndex((h) => slugifyAnchor(h.text) === slug);
      if (hi >= 0) return hi;
    }
    // A `Kind: Name` reference without its `###`, or a heading quoted with a
    // trailing aside — containment either way, longest heading match first is
    // not needed: the first heading that contains the whole reference wins.
    return headings.findIndex((h) => normHeading(h.text).includes(want) || want.includes(normHeading(h.text)) && normHeading(h.text).length > 3);
  };

  return anchors.map((a) => {
    if (a && typeof a === 'object' && Number.isInteger(a.line)) {
      const at = Math.min(Math.max(a.line - 1, 0), Math.max(lines.length - 1, 0));
      const start = Math.max(0, at - radius);
      const end = Math.min(lines.length, at + radius + 1);
      return { anchor: `line ${a.line}`, found: lines.length > 0 && a.line >= 1 && a.line <= lines.length, start: start + 1, end, text: lines.slice(start, end).join('\n').trimEnd() };
    }
    // An HTML id, for a design or style guide: the element and what follows.
    const idRef = String(a).match(/id="([^"]+)"|^#([a-z0-9-]+)$/i);
    if (idRef && !/^#{1,6}\s/.test(String(a))) {
      const id = idRef[1] || idRef[2];
      const at = lines.findIndex((l) => l.includes(`id="${id}"`));
      if (at >= 0) {
        const end = Math.min(lines.length, at + radius * 2 + 1);
        return { anchor: String(a), found: true, start: at + 1, end, text: lines.slice(at, end).join('\n').trimEnd() };
      }
    }
    const hi = findHeading(a);
    if (hi >= 0) return { anchor: String(a), found: true, ...sectionAt(hi) };
    // Not a heading: a CSS selector, a quoted state name, an attribute — the
    // kind of anchor a design or style validator writes. Search the document
    // for the anchor's most specific token (backticked or quoted first, then
    // the longest word run) and take a window around the first hit.
    const at = findText(lines, String(a));
    if (at >= 0) {
      const start = Math.max(0, at - radius);
      const end = Math.min(lines.length, at + radius + 1);
      return { anchor: String(a), found: true, start: start + 1, end, text: lines.slice(start, end).join('\n').trimEnd() };
    }
    return { anchor: String(a), found: false, start: 0, end: 0, text: '' };
  });
}

// The line index of the first occurrence of an anchor's most specific token,
// or -1. Tokens tried in order: each backticked or quoted span, then the
// whole anchor with its dressing stripped, then its longest 3+ character word
// run — never a single short word, which would land anywhere.
function findText(lines, anchor) {
  const candidates = [];
  for (const m of anchor.matchAll(/\`([^\`]+)\`|"([^"]+)"|'([^']+)'/g)) candidates.push((m[1] ?? m[2] ?? m[3]).trim());
  const bare = anchor.replace(/[\`"'*_]/g, '').replace(/\b(rule|block|section|element|state description|description|selector|declaration)\b/gi, '').trim();
  if (bare.length >= 4) candidates.push(bare);
  for (const c of candidates) {
    if (c.length < 3) continue;
    const at = lines.findIndex((l) => l.includes(c));
    if (at >= 0) return at;
  }
  return -1;
}

// Does an earlier finding still stand in the latest set? Same anchor, or the
// same criterion, or the same evidence quote — any one is the finding again.
function reappears(prior, latest) {
  const key = (f) => ({
    anchor: f.anchor ? normHeading(f.anchor) : null,
    crit: f.criterion ? f.criterion.toLowerCase().slice(0, 40) : null,
    ev: f.evidence ? f.evidence.toLowerCase().slice(0, 40) : null,
  });
  const p = key(prior);
  return latest.some((f) => {
    const l = key(f);
    return (p.anchor && l.anchor && p.anchor === l.anchor)
      || (p.crit && l.crit && p.crit.length > 8 && p.crit === l.crit)
      || (p.ev && l.ev && p.ev.length > 8 && p.ev === l.ev);
  });
}

/**
 * One line per earlier round: what it asked for, and whether each finding
 * reappeared in the latest verdict or is gone. `rounds` is the list of prior
 * verdict texts (oldest first); `latestFindings` the parsed current ones.
 */
export function summarizeRounds(rounds = [], latestFindings = []) {
  return rounds.map((text, i) => {
    const findings = parseFindings(text);
    if (!findings.length) {
      // A prose verdict with no parsable findings: its first meaningful line.
      const line = String(text).split('\n').map((l) => l.trim()).filter((l) => l && !/^VERDICT:/i.test(l) && !/^SPEC:/i.test(l))[0] || '(no findings recorded)';
      return `Round ${i + 1} asked for: ${line.replace(/^SUMMARY:\s*/i, '').slice(0, 160)} — see the current verdict for what still stands.`;
    }
    const items = findings.map((f) => `[${f.severity}] ${f.criterion || f.text.split('\n')[0].slice(0, 60)}${f.anchor ? ` @ ${f.anchor}` : ''} (${reappears(f, latestFindings) ? 'reappeared' : 'resolved'})`);
    return `Round ${i + 1} asked for: ${items.join('; ')}.`;
  });
}

/**
 * The material a revision prompt inlines for the latest verdict: each finding
 * with the section it names sliced from `docText`. Returns
 * `{ findings, blocks, unanchored }` where `blocks` are ready-to-paste strings
 * and `unanchored` lists findings that carried no usable anchor (so the
 * caller can log which validator briefs forget them).
 */
// The file an anchor names, when it names one: `{ file, anchor }` or null.
export function fileAnchor(anchor) {
  const m = String(anchor || '').match(FILE_ANCHOR);
  return m ? { file: m[1], anchor: m[2].trim() } : null;
}

/**
 * `docs` maps other files' paths to their text, for anchors of the form
 * `gspec/architecture/api.md → ### Entity: PantryItem` — an architecture is
 * a SET of files and its validator anchors into the module tier.
 */
export function anchoredRevisionBlocks(verdictText, docText, { docs = {} } = {}) {
  const findings = parseFindings(verdictText);
  const blocks = [];
  const unanchored = [];
  const carried = []; // { file, start, end, anchor } — slices already in the prompt
  for (const f of findings) {
    const head = `[${f.severity}] ${f.criterion || f.text.split('\n')[0]}`;
    const fa = f.anchor ? fileAnchor(f.anchor) : null;
    // Several line locators → one window each, in one block.
    if (f.lines && f.lines.length > 1) {
      const slices = sliceSections(docText, f.lines.map((line) => ({ line })));
      if (slices.every((x) => x.found)) {
        blocks.push(`${head}\n${slices.map((x) => `  → ${x.anchor} (lines ${x.start}–${x.end}):\n\`\`\`\n${x.text}\n\`\`\``).join('\n')}`);
        continue;
      }
    }
    // A field anchor outranks a line the title happened to carry; the line
    // is the fallback when the anchor resolves nowhere.
    const locator = (f.line && !f.lineFromTitle) ? { line: f.line } : fa ? fa.anchor : (f.anchor || (f.line ? { line: f.line } : null));
    if (!locator) {
      unanchored.push({ ...f, reason: 'no anchor: line' });
      blocks.push(`${head}\n  → no anchor given by the validator; locate this one by its evidence quote${f.evidence ? ` ("${f.evidence.slice(0, 80)}")` : ''} and edit only there.`);
      continue;
    }
    const source = fa ? (docs[fa.file] ?? null) : docText;
    if (fa && source === null) {
      unanchored.push({ ...f, reason: `anchor names a file that was not read: ${fa.file}` });
      blocks.push(`${head}\n  → anchor "${f.anchor}" is in ${fa.file}, which is not included here; open that file and locate it by its evidence quote${f.evidence ? ` ("${f.evidence.slice(0, 80)}")` : ''}.`);
      continue;
    }
    let [slice] = sliceSections(source, [locator]);
    let foundIn = fa ? fa.file : null;
    // Not in the target: an unprefixed anchor may live in a sibling of the
    // deliverable set (an architecture validator anchoring into a module
    // file without saying so). First sibling that has it wins.
    if (!slice.found && !fa && !f.line) {
      for (const [rel, text] of Object.entries(docs)) {
        const [s2] = sliceSections(text, [locator]);
        if (s2.found) { slice = s2; foundIn = rel; break; }
      }
    }
    if (!slice.found && f.lineFromTitle && f.line && !fa) {
      const [byLine] = sliceSections(docText, [{ line: f.line }]);
      if (byLine.found) { slice = byLine; foundIn = null; }
    }
    if (!slice.found) {
      unanchored.push({ ...f, reason: `anchor not found in the document: ${f.anchor || slice.anchor}` });
      blocks.push(`${head}\n  → anchor "${f.anchor || slice.anchor}" was not found in the document; locate this one by its evidence quote${f.evidence ? ` ("${f.evidence.slice(0, 80)}")` : ''} and edit only there.`);
      continue;
    }
    const where = foundIn ? `${foundIn} → ${slice.anchor}` : slice.anchor;
    // A section the prompt already carries (the same anchor twice, or a block
    // inside a section another finding pulled in) is referenced, not repeated.
    const key = `${foundIn || ''}:${slice.start}-${slice.end}`;
    const covered = carried.find((c) => c.file === (foundIn || '') && c.start <= slice.start && c.end >= slice.end);
    if (covered) {
      blocks.push(`${head}\n  → ${where} (lines ${slice.start}–${slice.end}) — inside the ${covered.anchor} block above.`);
      continue;
    }
    carried.push({ file: foundIn || '', start: slice.start, end: slice.end, anchor: slice.anchor, key });
    blocks.push(`${head}\n  → ${where} (lines ${slice.start}–${slice.end}):\n\`\`\`\n${slice.text}\n\`\`\``);
  }
  return { findings, blocks, unanchored };
}

/**
 * Why a FAIL verdict cannot drive a lean revision, or null when it can:
 * no readable finding at all, or findings none of which carry an anchor.
 * A partially anchored verdict is usable as it is.
 */
export function verdictContractGaps(verdictText) {
  const findings = parseFindings(verdictText);
  const anchored = findings.filter((f) => f.anchor || f.line).length;
  if (!findings.length) return { findings: 0, anchored: 0, reason: 'carried no finding in the contract shape (a `- [severity] criterion — problem` item)' };
  if (!anchored) return { findings: findings.length, anchored: 0, reason: `carried ${findings.length === 1 ? 'one finding' : `${findings.length} findings`} without an \`anchor:\` line` };
  return { findings: findings.length, anchored, reason: null };
}
