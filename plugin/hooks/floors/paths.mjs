// Floor: the gspec path vocabulary (pure, I/O-free).
//
// Every floor used to re-derive "is this a gspec spec?" with its own regex, and
// they disagreed: spec-integrity matched a `gspec/` prefix while agnosticism
// matched a hard-coded list of BASENAMES, so `gspec/architecture/<name>.md` was
// version-checked but never agnosticism-guarded — an accident of the basename
// list, not a decision. One vocabulary, used by all of them, fixes that class of
// bug by construction.
//
// Layout this module knows (spec-version v2 →):
//
//   gspec/profile.md · stack.md · practices.md · research.md
//   gspec/style.md XOR style.html
//   gspec/architecture.md              system tier
//   gspec/architecture/<name>.md       module tier (multi-module only)
//   gspec/features/<slug>.md           feature PRD
//   gspec/tasks/<slug>.md              plan  ← relocates into the feature folder in v3.2
//
// The v3.2 feature-folder predicates below are written but not yet reachable:
// nothing produces those paths until the feature-folder release, at which point
// only the CALL SITES change, not this vocabulary.

export function norm(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
}

// The specs that live directly in gspec/ and are keyed by an exact filename.
export const ROOT_SPECS = new Set([
  'profile.md', 'stack.md', 'practices.md', 'architecture.md',
  'style.md', 'style.html', 'research.md',
]);

// The path segment after `gspec/`, or null when the path isn't under gspec/.
function tail(rel) {
  const r = norm(rel);
  return r.startsWith('gspec/') ? r.slice('gspec/'.length) : null;
}

export function isRootSpec(rel) {
  const t = tail(rel);
  return t !== null && ROOT_SPECS.has(t);
}

// The profile is the ONE spec that is supposed to carry product identity, so
// every identity-related rule needs to name it specifically.
export function isProfile(rel) {
  return tail(rel) === 'profile.md';
}

// The module tier: gspec/architecture/<name>.md. `<name>` is the Modules-table
// row name, which is also the key verify.sh prints in `FAIL: <module>:<phase>`.
export function isModuleArch(rel) {
  const t = tail(rel);
  return t !== null && /^architecture\/[^/]+\.md$/.test(t);
}

// The module name a module-tier path encodes, or null.
export function moduleName(rel) {
  const t = tail(rel);
  const m = t && t.match(/^architecture\/([^/]+)\.md$/);
  return m ? m[1] : null;
}

// A feature PRD. Flat today; the feature-folder release moves it to
// gspec/features/<slug>/prd.md and keeps the flat form readable through the
// migration window — both are accepted here so the switch is a no-op for floors.
export function isFeaturePrd(rel) {
  const t = tail(rel);
  if (t === null) return false;
  return /^features\/[^/]+\.md$/.test(t) || /^features\/[^/]+\/prd\.md$/.test(t);
}

// A plan file in the CURRENT flat location. Relocates into the feature folder in
// v3.2; kept as its own predicate so the legacy form stays recognizable.
export function isLegacyPlan(rel) {
  const t = tail(rel);
  return t !== null && /^tasks\/[^/]+\.md$/.test(t);
}

// --- feature-folder vocabulary (v3.2: written, not yet produced) -----------

// The three ENRICHED siblings of a PRD inside a feature folder. Deliberately a
// closed basename set: prd.md is NOT one of them, because the agnosticism
// boundary runs between them — the PRD stays product-agnostic while these three
// are denormalized on purpose.
const ENRICHED = new Set(['arch.md', 'design.html', 'tasks.md']);

export function isEnrichedDoc(rel) {
  const t = tail(rel);
  const m = t && t.match(/^features\/[^/]+\/([^/]+)$/);
  return Boolean(m && ENRICHED.has(m[1]));
}

export function isFeatureDesign(rel) {
  const t = tail(rel);
  return t !== null && /^features\/[^/]+\/design\.html$/.test(t);
}

export function isFeatureTasks(rel) {
  const t = tail(rel);
  return t !== null && /^features\/[^/]+\/tasks\.md$/.test(t);
}

// The feature slug a path belongs to, whichever layout it is in, or null.
export function featureSlug(rel) {
  const t = tail(rel);
  if (t === null) return null;
  const folder = t.match(/^features\/([^/]+)\/[^/]+$/);
  if (folder) return folder[1];
  const flat = t.match(/^features\/([^/]+)\.md$/);
  if (flat) return flat[1];
  const plan = t.match(/^tasks\/([^/]+)\.md$/);
  return plan ? plan[1] : null;
}

// --- the union -------------------------------------------------------------

// Is this path a gspec spec at all? README files are documentation about the
// specs rather than specs; gspec/design/** holds external mockups that gspec
// neither writes nor governs.
export function isGspecSpec(rel) {
  const t = tail(rel);
  if (t === null) return false;
  if (t.startsWith('design/')) return false;
  const base = t.split('/').pop();
  if (base.toLowerCase() === 'readme.md') return false;
  return isRootSpec(rel) || isModuleArch(rel) || isFeaturePrd(rel)
    || isLegacyPlan(rel) || isEnrichedDoc(rel);
}
