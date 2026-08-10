// Floor: profile-agnosticism (pure, I/O-free).
//
// Every spec except gspec/profile.md must be free of product/company identity.
// This module derives identity candidates from profile.md and finds any that
// leak into a guarded spec. Heuristic (it cannot know every identity string) —
// it catches the common case of the product name leaking. Entry points read
// profile.md + the file and signal the violation.

import { isGspecSpec, isProfile, isEnrichedDoc } from './paths.mjs';

// Which paths this floor governs: every gspec spec except the two kinds that are
// SUPPOSED to carry product identity.
//
// Order matters and is load-bearing (both exemptions must be tested before the
// general case, or the file falls through to guarded):
//   • the profile IS product identity — guarding it would be incoherent;
//   • a feature folder's enriched siblings are deliberately denormalized, so an
//     implementer can work from that folder alone. Nagging them toward
//     agnosticism would defeat the reason they exist.
// The PRD sitting beside those siblings is NOT exempt — the boundary runs
// between basenames inside one folder, which is exactly why it lives in one
// shared predicate rather than being re-derived per floor.
//
// This replaced a hard-coded basename allowlist that silently failed to guard
// gspec/architecture/<name>.md: sub-files matched none of its listed names.
export function isGuardedSpec(rel) {
  if (!isGspecSpec(rel)) return false;
  if (isProfile(rel)) return false;
  if (isEnrichedDoc(rel)) return false;
  return true;
}

const STOP = new Set(['the', 'product', 'profile', 'app', 'application', 'system', 'platform', 'tool', 'service', 'our', 'and', 'for']);

// H1 parts that are the DOCUMENT's name, never the product's — dropped whichever
// side of the separator they land on.
const BOILERPLATE = /^(the\s+)?(product|project|company)?\s*(profile|overview|brief|spec(ification)?)?$/i;

// Product/company identity strings derived from profile.md.
export function identityCandidates(profile) {
  const names = new Set();
  const text = String(profile);
  const h1 = text.match(/^#\s+(.+?)\s*$/m);
  if (h1) {
    // Split the title into parts and drop the boilerplate ones, rather than
    // stripping "Profile" off the END. The old shape only understood name-first
    // ("# Acme Rocket - Product Profile"); a writer that emitted name-LAST
    // ("# Product Profile — Shelfkeeper") left "Product  — Shelfkeeper" as a
    // single candidate, which matches nothing, so the guard failed OPEN and the
    // product name shipped in stack.md and practices.md. Nothing pins the order
    // — so the leak was nondeterministic across builds, the worst failure mode
    // available to a guard.
    //
    // Separators need surrounding space so a hyphenated name ("Foo-Bar") stays
    // whole; a colon is allowed to hug the left, as titles are usually written.
    for (const part of h1[1].split(/\s+[-—–|]\s+|\s*:\s+/)) {
      const t = part.replace(/\bprofile\b/i, '').trim();
      if (t && !BOILERPLATE.test(t)) names.add(t);
    }
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
