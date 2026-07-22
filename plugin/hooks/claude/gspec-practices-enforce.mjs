#!/usr/bin/env node
// gspec PostToolUse hook — practices enforcement (model-free, advisory).
//
// After a Write/Edit, read the `## Enforcement` block from gspec/practices.md and
// run the built-in deterministic checks (nesting, function length, file naming)
// against the file just written. Surfaces error-severity violations to Claude
// (exit 2) so it fixes them. The block is read live, so editing a rule takes
// effect on the next write — nothing is generated or regenerated. Fails OPEN:
// any error, a non-matching file, or a missing enforcement block exits 0 — a
// buggy hook must never break a session or block unrelated writes.

import { readFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { parseEnforcement, evaluateFile } from './gspec-enforce-core.mjs';

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  if (rel.startsWith('..')) process.exit(0);            // outside the project
  if (rel.startsWith('gspec/')) process.exit(0);        // don't lint the specs themselves
  if (rel.includes('node_modules/') || rel.startsWith('.git/')) process.exit(0);

  let practices;
  try { practices = readFileSync(join(projectDir, 'gspec', 'practices.md'), 'utf-8'); } catch { process.exit(0); }
  const parsed = parseEnforcement(practices);
  if (!parsed || !parsed.rules?.length) process.exit(0);

  let source;
  try { source = readFileSync(resolve(projectDir, filePath), 'utf-8'); } catch { process.exit(0); }

  const findings = evaluateFile({ rel, source, rules: parsed.rules });
  const errors = findings.filter((f) => f.severity === 'error');
  if (!errors.length) process.exit(0);

  const detail = findings
    .map((f) => `  - [${f.severity}] ${rel}${f.line ? `:${f.line}` : ''} — ${f.message} (${f.ruleId})`)
    .join('\n');
  process.stderr.write(
    `gspec practices-enforce: ${errors.length} violation(s) in ${rel} (per gspec/practices.md §Enforcement):\n${detail}\n`,
  );
  process.exit(2);
} catch {
  process.exit(0); // fail open
}
