// Floor: profile-agnosticism (pure, I/O-free).
//
// Every spec except gspec/profile.md must be free of product/company identity.
// This module derives identity candidates from profile.md and finds any that
// leak into a guarded spec. Heuristic (it cannot know every identity string) —
// it catches the common case of the product name leaking. Entry points read
// profile.md + the file and signal the violation.

// Which paths this floor governs (every gspec spec that is NOT the profile).
export function isGuardedSpec(rel) {
  const r = String(rel).replace(/\\/g, '/');
  if (!r.startsWith('gspec/')) return false;
  if (r.startsWith('gspec/design/')) return false;
  const base = r.split('/').pop();
  if (base === 'profile.md') return false; // the profile IS product identity
  if (base.toLowerCase() === 'readme.md') return false;
  if (r.startsWith('gspec/features/') && base.endsWith('.md')) return true;
  if (r.startsWith('gspec/tasks/') && base.endsWith('.md')) return true;
  return ['stack.md', 'practices.md', 'architecture.md', 'style.md', 'style.html', 'research.md'].includes(base);
}

const STOP = new Set(['the', 'product', 'profile', 'app', 'application', 'system', 'platform', 'tool', 'service', 'our', 'and', 'for']);

// Product/company identity strings derived from profile.md.
export function identityCandidates(profile) {
  const names = new Set();
  const text = String(profile);
  const h1 = text.match(/^#\s+(.+?)\s*$/m);
  if (h1) {
    const t = h1[1].replace(/[-—:]\s*(product\s+)?profile\s*$/i, '').replace(/\bprofile\b/i, '').trim();
    if (t) names.add(t);
  }
  for (const m of text.matchAll(/product\s*name[^\S\n]*[:|*]{0,2}[^\S\n]*([A-Za-z0-9][\w .&'-]{1,60})/gi)) {
    names.add(m[1].trim());
  }
  return [...names]
    .map((n) => n.replace(/[*_`]/g, '').trim())
    .filter((n) => n.length >= 3 && !STOP.has(n.toLowerCase()));
}

// Identity candidates that actually appear (whole-word) in the spec content.
export function agnosticismHits(content, candidates) {
  const text = String(content);
  const hits = candidates.filter((name) => {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(text);
  });
  return [...new Set(hits)];
}
