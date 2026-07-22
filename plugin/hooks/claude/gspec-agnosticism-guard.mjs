#!/usr/bin/env node
// gspec PostToolUse hook — profile-agnosticism guard (model-free, advisory).
//
// Every spec except gspec/profile.md must be free of product/company identity.
// After a Write/Edit to a non-profile gspec spec, this derives the product name
// from gspec/profile.md and flags any occurrence in the just-written spec,
// surfacing it to Claude (exit 2) so it genericizes the text. This is a
// heuristic guard (it can't know every identity string) — it catches the common
// case (the product name leaking into stack/architecture/etc.). Fails OPEN.

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

function isGuardedSpec(rel) {
  if (!rel.startsWith('gspec/')) return false;
  if (rel.startsWith('gspec/design/')) return false;
  const base = rel.split('/').pop();
  if (base === 'profile.md') return false; // the profile IS product identity
  if (base.toLowerCase() === 'readme.md') return false;
  if (rel.startsWith('gspec/features/') && base.endsWith('.md')) return true;
  if (rel.startsWith('gspec/tasks/') && base.endsWith('.md')) return true;
  return ['stack.md', 'practices.md', 'architecture.md', 'style.md', 'style.html', 'research.md'].includes(base);
}

const STOP = new Set(['the', 'product', 'profile', 'app', 'application', 'system', 'platform', 'tool', 'service', 'our', 'and', 'for']);

function identityCandidates(profile) {
  const names = new Set();
  const h1 = profile.match(/^#\s+(.+?)\s*$/m);
  if (h1) {
    const t = h1[1].replace(/[-—:]\s*(product\s+)?profile\s*$/i, '').replace(/\bprofile\b/i, '').trim();
    if (t) names.add(t);
  }
  for (const m of profile.matchAll(/product\s*name[^\S\n]*[:|*]{0,2}[^\S\n]*([A-Za-z0-9][\w .&'-]{1,60})/gi)) {
    names.add(m[1].trim());
  }
  return [...names]
    .map((n) => n.replace(/[*_`]/g, '').trim())
    .filter((n) => n.length >= 3 && !STOP.has(n.toLowerCase()));
}

function flag(rel, hits) {
  process.stderr.write(
    `gspec profile-agnosticism: ${rel} appears to reference product/company identity ` +
    `(${hits.join(', ')}). Every spec except gspec/profile.md must be identity-free — use ` +
    `generic terms like "the application"/"the system". Product identity lives only in profile.md.\n`,
  );
  process.exit(2);
}

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }
  const filePath = evt?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const rel = relative(projectDir, resolve(projectDir, filePath)).replace(/\\/g, '/');
  if (!isGuardedSpec(rel)) process.exit(0);

  let profile;
  try { profile = readFileSync(resolve(projectDir, 'gspec/profile.md'), 'utf-8'); } catch { process.exit(0); } // no profile → can't check

  const candidates = identityCandidates(profile);
  if (candidates.length === 0) process.exit(0);

  let content;
  try { content = readFileSync(resolve(projectDir, filePath), 'utf-8'); } catch { process.exit(0); }

  const hits = candidates.filter((name) => {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(content);
  });
  if (hits.length) flag(rel, [...new Set(hits)]);
  process.exit(0);
} catch {
  process.exit(0); // fail open
}
