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

const SEVERITIES = 'blocker|major|minor|nit';
const FINDING_START = new RegExp(`^\\s*[-*]?\\s*\\**\\[(${SEVERITIES})\\]\\**\\s*(.*)$`, 'i');
// A line that ends the findings block: the next top-level contract key or a heading.
const BLOCK_END = /^(?:#{1,6}\s|(?:VERDICT|SPEC|SUMMARY|FINDINGS)\s*:)/i;
const FIELD = (key) => new RegExp(`^\\s*[-*+]?\\s*[*_\`]{0,2}${key}[*_\`]{0,2}\\s*:\\s*(.+?)\\s*$`, 'i');
const ANCHOR_FIELD = FIELD('anchor');
const LINE_FIELD = FIELD('line');
const EVIDENCE_FIELD = FIELD('evidence');

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
  for (const raw of lines) {
    const m = raw.match(FINDING_START);
    if (m) {
      cur = { severity: m[1].toLowerCase(), criterion: m[2].replace(/\*\*/g, '').split(/\s+[—–-]\s+/)[0].trim(), text: raw.trimEnd(), anchor: null, line: null, evidence: null };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (BLOCK_END.test(raw.trim()) && !/^\s/.test(raw)) { cur = null; continue; }
    if (!raw.trim()) continue;
    cur.text += `\n${raw.trimEnd()}`;
    const a = raw.match(ANCHOR_FIELD);
    if (a) {
      const v = unquote(a[1]);
      const ln = v.match(/^line\s*:?\s*(\d+)$/i);
      if (ln) cur.line = Number(ln[1]);
      else cur.anchor = v;
      continue;
    }
    const l = raw.match(LINE_FIELD);
    if (l && /^\d+$/.test(l[1].trim())) { cur.line = Number(l[1]); continue; }
    const e = raw.match(EVIDENCE_FIELD);
    if (e) cur.evidence = unquote(e[1]);
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
    if (hi < 0) return { anchor: String(a), found: false, start: 0, end: 0, text: '' };
    return { anchor: String(a), found: true, ...sectionAt(hi) };
  });
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
export function anchoredRevisionBlocks(verdictText, docText) {
  const findings = parseFindings(verdictText);
  const blocks = [];
  const unanchored = [];
  for (const f of findings) {
    const locator = f.line ? { line: f.line } : f.anchor;
    const head = `[${f.severity}] ${f.criterion || f.text.split('\n')[0]}`;
    if (!locator) {
      unanchored.push({ ...f, reason: 'no anchor: line' });
      blocks.push(`${head}\n  → no anchor given by the validator; locate this one by its evidence quote${f.evidence ? ` ("${f.evidence.slice(0, 80)}")` : ''} and edit only there.`);
      continue;
    }
    const [slice] = sliceSections(docText, [locator]);
    if (!slice.found) {
      unanchored.push({ ...f, reason: `anchor not found in the document: ${slice.anchor}` });
      blocks.push(`${head}\n  → anchor "${slice.anchor}" was not found in the document; locate this one by its evidence quote${f.evidence ? ` ("${f.evidence.slice(0, 80)}")` : ''} and edit only there.`);
      continue;
    }
    blocks.push(`${head}\n  → ${slice.anchor} (lines ${slice.start}–${slice.end}):\n\`\`\`\n${slice.text}\n\`\`\``);
  }
  return { findings, blocks, unanchored };
}
