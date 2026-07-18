// Pure, I/O-free core for the practices-enforcement hook. Parses the
// `## Enforcement` YAML block from practices.md and runs the built-in
// deterministic checks against a source file. No filesystem, no process — so it
// is unit-testable in isolation and safe to fail open around.
//
// Not a general YAML parser: it reads only the constrained enforcement-block
// shape (top-level `version:` scalar + a `rules:` list of flat maps whose values
// are scalars, one inline array, or one inline flow map). Anything richer is out
// of scope by design — the block is authored to this shape.

// --- Enforcement block extraction -----------------------------------------

// Return the body of the first ```yaml fence under an `## Enforcement` heading,
// or null if there is no such heading/fence.
export function extractEnforcementYaml(practicesText) {
  const lines = practicesText.split('\n');
  let i = lines.findIndex((l) => /^#{1,6}\s+.*\benforcement\b/i.test(l));
  if (i === -1) return null;
  for (i += 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) return null; // hit next heading first
    if (/^```+\s*ya?ml\s*$/i.test(lines[i])) break;
  }
  if (i >= lines.length) return null;
  const body = [];
  for (i += 1; i < lines.length; i++) {
    if (/^```+\s*$/.test(lines[i])) return body.join('\n');
    body.push(lines[i]);
  }
  return null; // unterminated fence
}

// --- Minimal YAML value parsing -------------------------------------------

// Strip a YAML trailing/line comment (`#` at line start or after whitespace,
// not inside quotes).
function stripYamlComment(line) {
  let s = false, d = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !d) s = !s;
    else if (c === '"' && !s) d = !d;
    else if (c === '#' && !s && !d && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

// Split a comma-separated list respecting quotes and nested [] {}.
function splitTopLevel(inner) {
  const out = [];
  let cur = '', s = false, d = false, depth = 0;
  for (const c of inner) {
    if (c === "'" && !d) s = !s;
    else if (c === '"' && !s) d = !d;
    else if (!s && !d && (c === '[' || c === '{')) depth++;
    else if (!s && !d && (c === ']' || c === '}')) depth--;
    if (c === ',' && !s && !d && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function parseValue(raw) {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    return splitTopLevel(s.slice(1, -1)).map(parseScalar);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    for (const pair of splitTopLevel(s.slice(1, -1))) {
      const m = pair.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (m) obj[m[1]] = parseScalar(m[2]);
    }
    return obj;
  }
  return parseScalar(s);
}

// --- Enforcement block parsing --------------------------------------------

// Parse practices.md text → { version, rules: [ {id, action, event, applies_to,
// severity, params, ...} ] }, or null when there is no enforcement block.
export function parseEnforcement(practicesText) {
  const yaml = extractEnforcementYaml(practicesText);
  if (yaml == null) return null;
  const out = { version: null, rules: [] };
  let cur = null, inRules = false;
  for (const raw of yaml.split('\n')) {
    const line = stripYamlComment(raw);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;

    const dash = line.match(/^\s*-\s+(.*)$/);
    if (dash) {
      cur = {};
      out.rules.push(cur);
      inRules = true;
      const m = dash[1].match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (m) cur[m[1]] = parseValue(m[2]);
      continue;
    }

    const kv = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (indent === 0) {
      inRules = key === 'rules';
      if (key === 'version') out.version = parseScalar(val);
      cur = null;
    } else if (inRules && cur) {
      cur[key] = parseValue(val);
    }
  }
  return out;
}

// --- Glob matching --------------------------------------------------------

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

// A path matches if any pattern matches. Patterns containing '/' match the full
// relative path; bare patterns (e.g. "*.sh") match the basename.
export function matchGlob(rel, patterns) {
  const base = rel.split('/').pop();
  return patterns.some((p) => {
    const re = globToRegExp(p);
    return p.includes('/') ? re.test(rel) : re.test(base);
  });
}

// --- Deterministic checks (shell) -----------------------------------------

function stripShellComment(line) {
  let s = false, d = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !d) s = !s;
    else if (c === '"' && !s) d = !d;
    else if (c === '#' && !s && !d && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

const NEST_OPENERS = new Set(['if', 'for', 'while', 'until', 'case', 'select']);
const NEST_CLOSERS = new Set(['fi', 'done', 'esac']);

// Peak control-flow nesting depth via an opener/closer keyword stack. Approximate
// (heredoc bodies are not tracked) and shell-only; advisory by design.
export function checkMaxNesting(source, max) {
  let depth = 0, peak = 0, peakLine = 0;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const toks = stripShellComment(lines[i]).split(/[^A-Za-z_]+/).filter(Boolean);
    for (const t of toks) {
      if (NEST_OPENERS.has(t)) { depth++; if (depth > peak) { peak = depth; peakLine = i + 1; } }
      else if (NEST_CLOSERS.has(t) && depth > 0) depth--;
    }
  }
  return peak > max ? { line: peakLine, depth: peak } : null;
}

const FN_START = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*\(\)\s*\{?\s*$/;
const FN_START_KW = /^\s*function\s+([A-Za-z_][A-Za-z0-9_-]*)\s*\{?\s*$/;

// Report shell functions whose body spans more than `max` lines. Brace-delimited,
// quote/comment-naive; shell-only.
export function checkMaxFunctionLength(source, max) {
  const lines = source.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FN_START) || lines[i].match(FN_START_KW);
    if (!m) continue;
    let depth = 0, started = false, end = -1;
    for (let j = i; j < lines.length; j++) {
      const l = stripShellComment(lines[j]);
      for (const c of l) {
        if (c === '{') { depth++; started = true; }
        else if (c === '}') depth--;
      }
      if (started && depth <= 0) { end = j; break; }
    }
    if (end === -1) continue; // never closed — skip
    const length = end - i + 1;
    if (length > max) findings.push({ line: i + 1, name: m[1], length });
    i = end;
  }
  return findings;
}

// True when the basename conforms to the naming pattern. Unknown patterns pass
// (nothing to enforce).
export function checkFileNaming(basename, pattern) {
  if (pattern === 'kebab-case') return /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)+$/.test(basename);
  return true;
}

// --- Dispatch -------------------------------------------------------------

// Run every rule whose `applies_to` matches `rel` against `source`, returning a
// flat list of findings. Only `lint`-family checks with a built-in implementation
// run here; format/block/gate/judge (handled by formatters, git hooks, CI, or
// LLM review) and unknown ids are skipped.
export function evaluateFile({ rel, source, rules }) {
  const basename = rel.split('/').pop();
  const findings = [];
  for (const rule of rules) {
    const pats = rule.applies_to || ['*'];
    if (!matchGlob(rel, pats)) continue;
    const severity = rule.severity || 'warn';
    const p = rule.params || {};
    switch (rule.id) {
      case 'max-nesting': {
        if (!basename.endsWith('.sh')) break;
        const max = p.max_depth ?? 3;
        const r = checkMaxNesting(source, max);
        if (r) findings.push({ ruleId: rule.id, severity, line: r.line, message: `nesting depth ${r.depth} exceeds max ${max}` });
        break;
      }
      case 'max-function-length': {
        if (!basename.endsWith('.sh')) break;
        const max = p.max_lines ?? 40;
        for (const f of checkMaxFunctionLength(source, max)) {
          findings.push({ ruleId: rule.id, severity, line: f.line, message: `function ${f.name}() is ${f.length} lines (max ${max})` });
        }
        break;
      }
      case 'file-naming': {
        const pattern = p.pattern || 'kebab-case';
        if (!checkFileNaming(basename, pattern)) {
          findings.push({ ruleId: rule.id, severity, message: `filename "${basename}" is not ${pattern}` });
        }
        break;
      }
      default:
        break; // not enforced by the built-in checker
    }
  }
  return findings;
}
