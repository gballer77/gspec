#!/usr/bin/env node
// gspec postToolUse hook (Cursor, matcher: Write) — the advisory write floors.
//
// After a write, re-read the file from disk and run every floor that applies
// to it, the same checks the Claude PostToolUse hooks run one per process:
//   • spec-integrity      — spec-version marker present and current
//   • profile-agnosticism — no product/company identity outside profile.md
//   • token-literals      — style.html colors go through var(--…) tokens
//   • practices           — gspec/practices.md §Enforcement on source files
// Findings go back to the agent as additional_context so it fixes what it just
// wrote. It also records the write for the spec-reconcile nudge (gspec-stop).
//
// Reads the file from disk rather than the tool input, so it does not depend
// on the undocumented shape of Cursor's Write input. Fails OPEN.
//
// NOTE: ./floors/ resolves at the INSTALLED location (.cursor/hooks/floors/);
// this file is never executed from the source tree.

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { appliesToSpecIntegrity, specIntegrityViolations } from './floors/spec-integrity.mjs';
import { isGuardedSpec, identityCandidates, agnosticismHits } from './floors/agnosticism.mjs';
import { appliesToTokenLiterals, tokenLiteralViolations } from './floors/token-literals.mjs';
import { parseEnforcement, evaluateFile } from './floors/practices.mjs';
import { recordWrite } from './floors/reconcile.mjs';
import { readEvent, projectDir, sessionId, filePathOf, relPath, context, none } from './event.mjs';

const read = (path) => { try { return readFileSync(path, 'utf-8'); } catch { return null; } };

function specIntegrity(rel, content) {
  if (!appliesToSpecIntegrity(rel)) return null;
  const problems = specIntegrityViolations(rel, content);
  return problems.length ? `gspec spec-integrity: ${problems.join(' ')}` : null;
}

function agnosticism(dir, rel, content) {
  if (!isGuardedSpec(rel)) return null;
  const profile = read(join(dir, 'gspec', 'profile.md'));
  if (!profile) return null;
  const candidates = identityCandidates(profile);
  if (!candidates.length) return null;
  const hits = agnosticismHits(content, candidates);
  if (!hits.length) return null;
  return `gspec profile-agnosticism: ${rel} appears to reference product/company identity ` +
    `(${hits.join(', ')}). Every spec except gspec/profile.md must be identity-free — use ` +
    `generic terms like "the application"/"the system". Product identity lives only in profile.md.`;
}

function tokenLiterals(rel, content) {
  if (!appliesToTokenLiterals(rel)) return null;
  const violations = tokenLiteralViolations(content, rel);
  return violations.length ? `gspec token-literals: ${violations.join('\n')}` : null;
}

function practices(dir, rel, content) {
  if (rel.startsWith('gspec/')) return null; // don't lint the specs themselves
  if (rel.includes('node_modules/') || rel.startsWith('.git/')) return null;
  const practicesMd = read(join(dir, 'gspec', 'practices.md'));
  if (!practicesMd) return null;
  const parsed = parseEnforcement(practicesMd);
  if (!parsed || !parsed.rules?.length) return null;
  const findings = evaluateFile({ rel, source: content, rules: parsed.rules });
  const errors = findings.filter((f) => f.severity === 'error');
  if (!errors.length) return null;
  const detail = findings
    .map((f) => `  - [${f.severity}] ${rel}${f.line ? `:${f.line}` : ''} — ${f.message} (${f.ruleId})`)
    .join('\n');
  return `gspec practices-enforce: ${errors.length} violation(s) in ${rel} (per gspec/practices.md §Enforcement):\n${detail}`;
}

try {
  const evt = readEvent();
  const filePath = filePathOf(evt);
  if (!filePath) none();

  const dir = projectDir(evt);
  const rel = relPath(dir, filePath);
  if (rel.startsWith('..')) none(); // outside the project

  try { recordWrite(dir, sessionId(evt), rel); } catch { /* the nudge is best-effort */ }

  const content = read(resolve(dir, filePath));
  if (content == null) none();

  const findings = [
    specIntegrity(rel, content),
    agnosticism(dir, rel, content),
    tokenLiterals(rel, content),
    practices(dir, rel, content),
  ].filter(Boolean);

  context(findings.length ? `${findings.join('\n\n')}\n\nFix ${rel} before moving on.` : null);
} catch {
  none(); // fail open
}
