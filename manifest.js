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
    name: 'gspec-designer',
    source: 'skills/personas/gspec-designer.md',
    description: 'Designer persona — how to build a token-driven, accessible, profile-agnostic visual system, plus the quality bar for the style guide (markdown or renderable HTML). Preloaded by the style writer and validator agents.',
  },
  {
    name: 'gspec-practices',
    source: 'skills/personas/gspec-practices.md',
    description: 'Practice-lead persona — actionable engineering standards (testing philosophy, code quality, git, CI/CD structure, DoD) and the practices quality bar; bounded vs the stack. Preloaded by the practices writer and validator agents.',
  },
  {
    name: 'gspec-engineer',
    source: 'skills/personas/gspec-engineer.md',
    description: 'Engineer persona — decompose a PRD into an ordered plan and implement specs into working code: capability↔task↔code traceability, follow specs exactly, never descope. Preloaded by the plan-decomposer, plan-validator, and implementer agents.',
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
  {
    name: 'style-writer',
    source: 'agents/style-writer.md',
    description: 'Write the visual style guide (gspec/style.html or style.md, in the format the brief specifies) from a resolved brief, acting as the designer. Delegated by /gspec-style; returns a summary.',
    skills: ['gspec-designer', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
    memory: 'project',
  },
  {
    name: 'style-validator',
    source: 'agents/style-validator.md',
    description: 'Validate the style guide (gspec/style.html or style.md) against the designer quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-designer', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'practices-writer',
    source: 'agents/practices-writer.md',
    description: 'Write gspec/practices.md from a resolved brief, acting as the practice lead. Delegated by /gspec-practices; runs in isolation and returns a summary.',
    skills: ['gspec-practices', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
    memory: 'project',
  },
  {
    name: 'practices-validator',
    source: 'agents/practices-validator.md',
    description: 'Validate gspec/practices.md against the practices quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-practices', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'feature-writer',
    source: 'agents/feature-writer.md',
    description: 'Write one gspec/features/<slug>.md PRD from a resolved brief, acting as the product manager (technology- and profile-agnostic). Delegated by /gspec-feature (also research, audit); returns a summary.',
    skills: ['gspec-product', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
    memory: 'project',
  },
  {
    name: 'feature-validator',
    source: 'agents/feature-validator.md',
    description: 'Validate a feature PRD against the product quality bar, including the single-PRD ambiguity sweep (moved here from analyze). Read-only; returns a structured verdict.',
    skills: ['gspec-qa', 'gspec-product', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'architecture-writer',
    source: 'agents/architecture-writer.md',
    description: 'Read the foundation + feature specs and write gspec/architecture.md (technology-aware, Mermaid diagrams, gap analysis) from resolved gap decisions. Delegated by /gspec-architect; returns a summary.',
    skills: ['gspec-architect', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'architecture-validator',
    source: 'agents/architecture-validator.md',
    description: 'Validate gspec/architecture.md against the architecture quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-architect', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'plan-decomposer',
    source: 'agents/plan-decomposer.md',
    description: 'Decompose a feature PRD into an ordered, dependency-aware plan draft ([P] markers, deps, covers), acting as the engineer. Read-only, returns the draft; delegated by /gspec-plan.',
    skills: ['gspec-engineer', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'plan-validator',
    source: 'agents/plan-validator.md',
    description: 'Validate a feature plan against the engineer plan quality bar (coverage, acyclic deps, safe [P], stable IDs). Read-only; returns a structured verdict.',
    skills: ['gspec-qa', 'gspec-engineer', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'implementer',
    source: 'agents/implementer.md',
    description: 'Implement an assigned scope (one PRD / a phase / all) into working code, acting as the engineer: follow the specs, write and run tests, flip checkboxes. Delegated by /gspec-implement and the pipeline; returns a summary.',
    // One agent, scope is a runtime parameter (not split per-type). The only agent with Bash.
    skills: ['gspec-engineer', 'gspec-practices', 'gspec-conventions'],
    tools: 'Read, Write, Edit, Glob, Grep, Bash',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'codebase-inspector',
    source: 'agents/codebase-inspector.md',
    description: 'Inspect the codebase for drift vs the specs (spec↔code) and orphan capabilities, acting as the steward. Read-only (never modifies code or specs); returns impact-ordered findings. Delegated by /gspec-audit.',
    // Singular investigator (substrate = the code). Reads code, so it needs Bash.
    skills: ['gspec-steward', 'gspec-conventions'],
    tools: 'Read, Grep, Glob, Bash',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'spec-migrator',
    source: 'agents/spec-migrator.md',
    description: 'Reformat one gspec document to the current spec-version, preserving all content, acting as the steward. Delegated by /gspec-migrate; returns a summary of changes.',
    skills: ['gspec-steward', 'gspec-conventions'],
    tools: 'Read, Write, Edit',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'competitor-researcher',
    source: 'agents/competitor-researcher.md',
    description: 'Research one competitor via public web sources and return a structured teardown (features, UX, strengths, weaknesses), acting as the product strategist. Read-only; fanned out by /gspec-research.',
    // Singular investigator, fanned out one-per-competitor. The only agent with web tools.
    skills: ['gspec-product'],
    tools: 'WebSearch, WebFetch, Read',
    model: 'opus',
    memory: 'project',
  },
  {
    name: 'research-writer',
    source: 'agents/research-writer.md',
    description: 'Write gspec/research.md (competitive matrix, categorized findings, gap analysis) from synthesized research, acting as the product strategist. Delegated by /gspec-research; returns a summary.',
    skills: ['gspec-product', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
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
  {
    name: 'gspec-style',
    source: 'commands/gspec-style.md',
    description: 'Define or update the visual style guide (style.html or style.md) — tokens, color, type, components. Interviews as the designer, delegates style-writer, gates on style-validator (--no-qa skips). TRIGGER to define or revise the design system or theme.',
  },
  {
    name: 'gspec-practices',
    source: 'commands/gspec-practices.md',
    description: 'Define or update gspec/practices.md — coding standards, testing philosophy, git workflow, CI/CD structure, definition of done. Delegates practices-writer, gates on practices-validator (--no-qa skips). TRIGGER to set engineering conventions.',
  },
  {
    name: 'gspec-feature',
    source: 'commands/gspec-feature.md',
    description: 'Plan and write feature PRDs in gspec/features/ (what & why, tech-agnostic, portable). Assesses scope, may decompose, delegates feature-writer, gates on feature-validator (--no-qa skips). TRIGGER to plan, spec, or draft a feature/PRD.',
  },
  {
    name: 'gspec-architect',
    source: 'commands/gspec-architect.md',
    description: 'Define or update gspec/architecture.md — structure, data model, API, components. Resolves technical gaps, delegates architecture-writer, gates on architecture-validator (--no-qa skips). TRIGGER to design codebase structure before building.',
  },
  {
    name: 'gspec-plan',
    source: 'commands/gspec-plan.md',
    description: 'Decompose a feature PRD into an ordered plan (features/<slug>.plan.md) with parallel markers. Delegates plan-decomposer, plan-mode approval, gates on plan-validator (--no-qa skips). TRIGGER to sequence work or build a plan from a PRD.',
  },
  {
    name: 'gspec-implement',
    source: 'commands/gspec-implement.md',
    description: 'Implement software defined by gspec specs — phased, tested, checkpointed. Assesses progress, plans build order (or reuses plan files), delegates implementer per phase. STRONGLY TRIGGER to build, implement, code, scaffold, or ship specced work.',
  },
  {
    name: 'gspec-audit',
    source: 'commands/gspec-audit.md',
    description: 'Audit gspec specs against the codebase for drift (spec↔code) and unspecced features, one at a time; updates specs, drafts orphan PRDs, never code. Delegates codebase-inspector. TRIGGER to check specs vs code or find drift.',
  },
  {
    name: 'gspec-migrate',
    source: 'commands/gspec-migrate.md',
    description: 'Migrate gspec documents to the current spec format, preserving all content. Inventories versions, delegates spec-migrator per file, renames legacy plan files. TRIGGER on an outdated-version warning or to upgrade specs.',
  },
  {
    name: 'gspec-research',
    source: 'commands/gspec-research.md',
    description: 'Research competitors from gspec/profile.md and produce a competitive analysis (gspec/research.md) with gap identification; fans out competitor-researcher, optionally drafts feature PRDs. TRIGGER for market/competitor research or feature gaps.',
  },
];

// Targets that receive the full v2 artifact split. Others keep the legacy
// single-skill build (see build.js) until their degrade path is implemented.
export const V2_TARGETS = new Set(['claude']);

// Legacy source files (in commands/) that are superseded by v2 artifacts. On a
// v2 target the legacy emit skips these — the v2 build emits their replacement;
// on non-v2 targets they still build the legacy skill, so those installs are
// unchanged.
export const MIGRATED_LEGACY = new Set([
  'gspec.stack.md',
  'gspec.profile.md',
  'gspec.analyze.md',
  'gspec.style.md',
  'gspec.practices.md',
  'gspec.feature.md',
  'gspec.architect.md',
  'gspec.plan.md',
  'gspec.implement.md',
  'gspec.audit.md',
  'gspec.migrate.md',
  'gspec.research.md',
]);
