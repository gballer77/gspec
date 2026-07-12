// v2 artifact manifest — the source of truth for gspec's skill / agent / command
// classes. Replaces build.js's flat COMMANDS map as capabilities migrate to the
// v2 architecture. Each entry names a source file (relative to the repo root),
// the emitted artifact name, and its metadata. Agents additionally declare the
// skills they preload plus tools / model / memory.
//
// See docs/gspec-v2-design.md for the full design.

export const V2_SKILLS = [
  {
    name: 'gspec-architect',
    source: 'skills/personas/gspec-architect.md',
    description: 'Architect persona — how to choose a stack and design a system, plus the quality bar for stack/architecture specs. Preloaded by the stack/architecture writer and validator agents.',
  },
  {
    name: 'gspec-qa',
    source: 'skills/personas/gspec-qa.md',
    description: 'QA-reviewer persona — how to critique a spec against its quality bar and return a structured verdict. Preloaded by every validator agent and by /gspec-qa.',
  },
  {
    name: 'gspec-product',
    source: 'skills/personas/gspec-product.md',
    description: "Product-strategist persona — how to define a product's identity, audience, and value, plus the quality bar for the profile (and later feature/research) specs. Preloaded by the profile writer and validator agents.",
  },
  {
    name: 'gspec-steward',
    source: 'skills/personas/gspec-steward.md',
    description: 'Spec-steward persona — keeping specs consistent (analyze), faithful to code (audit), and current in format (migrate): find substantive conflicts, present neutrally, resolve surgically. Preloaded by the cross-referencer agent.',
  },
  {
    name: 'gspec-conventions',
    source: 'skills/conventions/gspec-conventions.md',
    description: 'Shared gspec spec formatting: frontmatter/spec-version, "Not Applicable" handling, and the capability checkbox + acceptance-criteria format.',
  },
  {
    name: 'gspec-agnosticism',
    source: 'skills/conventions/gspec-agnosticism.md',
    description: 'Profile-agnosticism (every spec but profile.md) and technology-agnostic vocabulary (feature PRDs). Keeps specs portable and correctly scoped.',
  },
  {
    name: 'gspec-authoring',
    source: 'skills/conventions/gspec-authoring.md',
    description: 'Shared interaction craft: the clarification protocol, one-at-a-time approval, and surgical spec updates.',
  },
];

export const V2_AGENTS = [
  {
    name: 'stack-writer',
    source: 'agents/stack-writer.md',
    description: 'Write gspec/stack.md from a resolved brief, acting as the architect. Delegated by /gspec-stack; runs in isolation and returns a summary.',
    skills: ['gspec-architect', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
    memory: 'project',
  },
  {
    name: 'stack-validator',
    source: 'agents/stack-validator.md',
    description: 'Validate gspec/stack.md against the architect quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-architect', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'profile-writer',
    source: 'agents/profile-writer.md',
    description: 'Write gspec/profile.md from a resolved brief, acting as the product strategist. Delegated by /gspec-profile; runs in isolation and returns a summary.',
    // Note: no gspec-agnosticism — the profile is the one spec that IS product identity.
    skills: ['gspec-product', 'gspec-conventions'],
    tools: 'Read, Write, Edit, Glob, Grep',
    memory: 'project',
  },
  {
    name: 'profile-validator',
    source: 'agents/profile-validator.md',
    description: 'Validate gspec/profile.md against the product quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-product', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'spec-cross-referencer',
    source: 'agents/spec-cross-referencer.md',
    description: 'Read gspec specs and return categorized cross-spec conflict findings (spec↔spec). Read-only; delegated by /gspec-analyze; does not edit or resolve.',
    // Singular investigator (shared substrate = the spec set), not per-type.
    skills: ['gspec-steward', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
];

export const V2_COMMANDS = [
  {
    name: 'gspec-stack',
    source: 'commands/gspec-stack.md',
    description: 'Define or update gspec/stack.md — interviews as the architect, delegates stack-writer, and gates on stack-validator (skip with --no-qa). TRIGGER when the user wants to pick, define, or revise technology choices.',
  },
  {
    name: 'gspec-qa',
    source: 'commands/gspec-qa.md',
    description: "Validate one or all gspec specs against their quality bar — read-only, on demand. TRIGGER when the user wants to QA, check, or review a spec's quality (not cross-spec conflicts, which is analyze).",
  },
  {
    name: 'gspec-profile',
    source: 'commands/gspec-profile.md',
    description: "Define or update gspec/profile.md — the product's identity, users, and value. Interviews as the strategist, delegates profile-writer, gates on profile-validator (skip with --no-qa). TRIGGER to define the product, users, or vision.",
  },
  {
    name: 'gspec-analyze',
    source: 'commands/gspec-analyze.md',
    description: 'Find and reconcile contradictions between gspec specs (spec↔spec), one at a time, updating existing specs. Delegates spec-cross-referencer. TRIGGER to cross-check or reconcile specs (not spec-vs-code, which is audit).',
  },
];

// Targets that receive the full v2 artifact split. Others keep the legacy
// single-skill build (see build.js) until their degrade path is implemented.
export const V2_TARGETS = new Set(['claude']);

// Legacy source files (in commands/) that are superseded by v2 artifacts. On a
// v2 target the legacy emit skips these — the v2 build emits their replacement;
// on non-v2 targets they still build the legacy skill, so those installs are
// unchanged.
export const MIGRATED_LEGACY = new Set(['gspec.stack.md', 'gspec.profile.md', 'gspec.analyze.md']);
