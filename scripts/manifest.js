// v2 artifact manifest — the source of truth for gspec's skill / agent / command
// classes. Replaces build.js's flat COMMANDS map as capabilities migrate to the
// v2 architecture. Each entry names a source file (relative to the repo root),
// the emitted artifact name, and its metadata. Agents additionally declare the
// skills they preload plus tools / model, and `remembers:` — whether the agent
// records memories to `.gspec/memory/pending/` (write-capable agents only).
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
    description: 'Engineer persona — decompose a PRD into an ordered plan and implement specs into working code: traceability, follow specs exactly, never descope, plus the mechanical plan floors the build lints for. Preloaded by the plan and implementer agents.',
  },
  {
    name: 'gspec-orchestrator',
    source: 'skills/personas/gspec-orchestrator.md',
    description: 'Build-orchestrator judgment — break an implementation run into right-sized scopes, order them by dependency, and fan out only file-disjoint scopes (the build-plan wave contract). Preloaded by the build-orchestrator agent and /gspec-implement.',
  },
  {
    name: 'gspec-conventions',
    source: 'skills/conventions/gspec-conventions.md',
    description: 'Shared gspec spec formatting: frontmatter/spec-version, "Not Applicable" handling, the capability checkbox + acceptance-criteria format, and the mechanical floors (anchor grammar, screen coverage, token literals) the build lints for.',
  },
  {
    name: 'gspec-agnosticism',
    source: 'skills/conventions/gspec-agnosticism.md',
    description: 'Profile-agnosticism (every spec but profile.md) and technology-agnostic vocabulary (feature PRDs). Keeps specs portable and correctly scoped.',
  },
  {
    name: 'gspec-authoring',
    source: 'skills/conventions/gspec-authoring.md',
    description: 'Shared interaction craft: the clarification protocol (interviews ask one question per message), one-at-a-time approval, and surgical spec updates.',
  },
  {
    name: 'gspec-templates',
    source: 'skills/conventions/gspec-templates.md',
    description: "The user's ~/.gspec saved-spec library (stacks/styles/practices/features): match a relevant template, offer it interactively (or adopt the best fit headless), and adapt it. Preloaded by the four writer agents with a library.",
  },
];

// Memory skills. Recording a memory is a plain file write under
// `.gspec/memory/pending/`, so this ships to EVERY target — it used to ride on
// Claude's per-agent `memory:` silo, which left the learning loop nonexistent on
// every other engine. The build appends it to the `skills:` of each agent flagged
// `remembers: true` (the write-capable ones — see V2_AGENTS). Kept out of
// V2_SKILLS because that append is conditional. See docs §13 (T1).
export const MEMORY_SKILLS = [
  {
    name: 'gspec-memory',
    source: 'skills/conventions/gspec-memory.md',
    description: 'Memory convention: feedback-driven recording, the target+layer address tag, and one-file-per-memory writes to .gspec/memory/pending/. Preloaded by every agent that remembers.',
  },
];

export const V2_AGENTS = [
  {
    name: 'stack-writer',
    source: 'agents/stack-writer.md',
    description: 'Write gspec/stack.md from a resolved brief, acting as the architect. Delegated by /gspec-stack; runs in isolation and returns a summary.',
    skills: ['gspec-architect', 'gspec-conventions', 'gspec-agnosticism', 'gspec-templates'],
    tools: 'Read, Write, Edit, Glob, Grep',
    remembers: true,
  },
  {
    name: 'stack-validator',
    source: 'agents/stack-validator.md',
    description: 'Validate gspec/stack.md against the architect quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-architect', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'profile-writer',
    source: 'agents/profile-writer.md',
    description: 'Write gspec/profile.md from a resolved brief, acting as the product strategist. Delegated by /gspec-profile; runs in isolation and returns a summary.',
    // Note: no gspec-agnosticism — the profile is the one spec that IS product identity.
    skills: ['gspec-product', 'gspec-conventions'],
    tools: 'Read, Write, Edit, Glob, Grep',
    remembers: true,
  },
  {
    name: 'profile-validator',
    source: 'agents/profile-validator.md',
    description: 'Validate gspec/profile.md against the product quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-product', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'spec-cross-referencer',
    source: 'agents/spec-cross-referencer.md',
    description: 'Read gspec specs and return categorized cross-spec conflict findings (spec↔spec). Read-only; delegated by /gspec-analyze; does not edit or resolve.',
    // Singular investigator (shared substrate = the spec set), not per-type.
    skills: ['gspec-steward', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'style-writer',
    source: 'agents/style-writer.md',
    description: 'Write the visual style guide (gspec/style.html or style.md, in the format the brief specifies) from a resolved brief, acting as the designer. Delegated by /gspec-style; returns a summary.',
    skills: ['gspec-designer', 'gspec-conventions', 'gspec-agnosticism', 'gspec-templates'],
    tools: 'Read, Write, Edit, Glob, Grep',
    remembers: true,
  },
  {
    name: 'style-validator',
    source: 'agents/style-validator.md',
    description: 'Validate the style guide (gspec/style.html or style.md) against the designer quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-designer', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'practices-writer',
    source: 'agents/practices-writer.md',
    description: 'Write gspec/practices.md from a resolved brief, acting as the practice lead. Delegated by /gspec-practices; runs in isolation and returns a summary.',
    skills: ['gspec-practices', 'gspec-conventions', 'gspec-agnosticism', 'gspec-templates'],
    tools: 'Read, Write, Edit, Glob, Grep',
    remembers: true,
  },
  {
    name: 'practices-validator',
    source: 'agents/practices-validator.md',
    description: 'Validate gspec/practices.md against the practices quality bar and return a structured verdict. Read-only.',
    skills: ['gspec-qa', 'gspec-practices', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'feature-planner',
    source: 'agents/feature-planner.md',
    description: 'Turn the resolved build brief (+ research.md) into a right-sized feature breakdown (slugs, briefs, priorities, dependencies) as fenced JSON, acting as the product strategist. Read-only — plans, never writes PRDs. Delegated by the build features stage.',
    // Read-only planner, the features counterpart of research-planner/build-orchestrator.
    skills: ['gspec-product'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'feature-writer',
    source: 'agents/feature-writer.md',
    description: 'Write one gspec/features/<slug>/prd.md PRD from a resolved brief, acting as the product manager (technology- and profile-agnostic). Delegated by /gspec-feature (also research, audit); returns a summary.',
    skills: ['gspec-product', 'gspec-conventions', 'gspec-agnosticism', 'gspec-templates'],
    tools: 'Read, Write, Edit, Glob, Grep',
    remembers: true,
  },
  {
    name: 'feature-validator',
    source: 'agents/feature-validator.md',
    description: 'Validate a feature PRD against the product quality bar, including the single-PRD ambiguity sweep (moved here from analyze). Read-only; returns a structured verdict.',
    skills: ['gspec-qa', 'gspec-product', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'architecture-writer',
    source: 'agents/architecture-writer.md',
    description: 'Read the foundation + feature specs and write gspec/architecture.md (technology-aware, Mermaid diagrams, gap analysis) — plus per-module gspec/architecture/<name>.md sub-files for a multi-module system — from resolved gap decisions. Amends an architecture that already exists rather than rewriting it, never renaming or dropping a Modules-table row. Delegated by /gspec-architect; returns a summary.',
    skills: ['gspec-architect', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
    model: 'opus',
    remembers: true,
  },
  {
    name: 'architecture-validator',
    source: 'agents/architecture-validator.md',
    description: 'Validate the architecture spec set (gspec/architecture.md + any architecture/*.md sub-files) against the architecture quality bar, including the layout gate and tier boundary. Read-only; returns a structured verdict.',
    skills: ['gspec-qa', 'gspec-architect', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'feature-architect',
    source: 'agents/feature-architect.md',
    description: "Write one feature's own architecture (gspec/features/<slug>/arch.md — Data, API, UI, Logic) enriched so an implementer needs nothing else, acting as the architect. Delegated by /gspec-plan.",
    skills: ['gspec-architect', 'gspec-conventions'],
    tools: 'Read, Write, Edit, Glob, Grep',
    model: 'opus',
    remembers: true,
  },
  {
    name: 'feature-architecture-validator',
    source: 'agents/feature-architecture-validator.md',
    description: "QA a feature's architecture against the anchor grammar, origin/delta discipline, tier boundary, and the enrichment bar. Read-only; returns a verdict.",
    skills: ['gspec-qa', 'gspec-architect', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'feature-designer',
    source: 'agents/feature-designer.md',
    description: "Write one feature's renderable design mockup (gspec/features/<slug>/design.html) from its UI section and the style guide's tokens, acting as the designer. Delegated by /gspec-plan.",
    skills: ['gspec-designer', 'gspec-conventions'],
    tools: 'Read, Write, Edit, Glob, Grep',
    model: 'opus',
    remembers: true,
  },
  {
    name: 'feature-design-validator',
    source: 'agents/feature-design-validator.md',
    description: "QA a feature's design.html: renders standalone, screens match the architecture both ways, tokens referenced not redefined. Read-only; returns a verdict.",
    skills: ['gspec-qa', 'gspec-designer', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'plan-decomposer',
    source: 'agents/plan-decomposer.md',
    description: 'Decompose a feature PRD into an ordered, dependency-aware plan ([P] markers, deps, covers, arch anchors), acting as the engineer. Writes gspec/features/<slug>/tasks.md; delegated by /gspec-plan.',
    skills: ['gspec-engineer', 'gspec-conventions'],
    tools: 'Read, Write, Edit, Glob, Grep',
    model: 'opus',
    remembers: true,
  },
  {
    name: 'plan-validator',
    source: 'agents/plan-validator.md',
    description: 'Validate a feature plan against the engineer plan quality bar (coverage, acyclic deps, safe [P], stable IDs). Read-only; returns a structured verdict.',
    skills: ['gspec-qa', 'gspec-engineer', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'implementer',
    source: 'agents/implementer.md',
    description: 'Implement an assigned scope (one PRD / a phase / all) into working code, acting as the engineer: follow the specs, write and run tests, flip checkboxes. Delegated by /gspec-implement and the build; returns a summary.',
    // One agent, scope is a runtime parameter (not split per-type). The only agent with Bash.
    skills: ['gspec-engineer', 'gspec-practices', 'gspec-conventions'],
    tools: 'Read, Write, Edit, Glob, Grep, Bash',
    // Sonnet, not opus. Implementation is the highest-volume agent in a build —
    // it runs per scope, per wave, and again on every continuation — and it is
    // the one job whose output is checked by something DETERMINISTIC: the gate
    // runs verify.sh (build + test), so a weak result fails rather than ships.
    // By the time it runs the design is settled and what is left is following
    // it. `implementation-validator` keeps `opus` here (its interactive default)
    // because grading acceptance criteria and the DoD is the judgment half of
    // that gate; on the build path the recommended tier drops it to the qa tier,
    // where verify.sh carries the hard signal (see RECOMMENDED_MODELS).
    model: 'sonnet',
    remembers: true,
  },
  {
    name: 'implementation-validator',
    source: 'agents/implementation-validator.md',
    description: 'The producer≠checker gate for code: run verify.sh (build+test) and judge in-scope acceptance criteria + Definition of Done, returning a structured verdict. Read-only; delegated by /gspec-implement and the build implement gate.',
    // Reads code + runs verify.sh, so it needs Bash — but never Write/Edit (it judges, doesn't fix).
    skills: ['gspec-qa', 'gspec-engineer', 'gspec-practices'],
    tools: 'Read, Grep, Glob, Bash',
    model: 'opus',
  },
  {
    name: 'build-orchestrator',
    source: 'agents/build-orchestrator.md',
    description: 'Turn the in-scope features/plans into an ordered, fan-out-aware build plan (waves of file-disjoint implementer scopes), acting with the orchestrator judgment. Read-only — plans, never builds. Delegated by the build implement stage.',
    // Read-only, so it records no memory of its own; its scope/fan-out judgment
    // stays trainable through the FAIL verdicts the feedback log records for it.
    skills: ['gspec-orchestrator', 'gspec-engineer', 'gspec-conventions'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'codebase-inspector',
    source: 'agents/codebase-inspector.md',
    description: 'Inspect the codebase for drift vs the specs (spec↔code) and orphan capabilities, acting as the steward. Read-only (never modifies code or specs); returns impact-ordered findings. Delegated by /gspec-audit.',
    // Singular investigator (substrate = the code). Reads code, so it needs Bash.
    skills: ['gspec-steward', 'gspec-conventions'],
    tools: 'Read, Grep, Glob, Bash',
    model: 'opus',
  },
  {
    name: 'spec-migrator',
    source: 'agents/spec-migrator.md',
    description: 'Reformat one gspec document to the current spec-version, preserving all content, acting as the steward. Delegated by /gspec-migrate; returns a summary of changes.',
    skills: ['gspec-steward', 'gspec-conventions'],
    tools: 'Read, Write, Edit',
    model: 'opus',
    remembers: true,
  },
  {
    name: 'research-planner',
    source: 'agents/research-planner.md',
    description: 'Turn the product profile + build brief into a research plan (competitor list + focus) as fenced JSON, acting as the product strategist. Read-only — plans, never researches. Delegated by the build research stage (--research).',
    // Read-only planner, the research counterpart of build-orchestrator.
    skills: ['gspec-product'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
  },
  {
    name: 'competitor-researcher',
    source: 'agents/competitor-researcher.md',
    description: 'Research one competitor via public web sources and return a structured teardown (features, UX, strengths, weaknesses), acting as the product strategist. Read-only; fanned out by /gspec-research.',
    // Singular investigator, fanned out one-per-competitor. The only agent with web tools.
    skills: ['gspec-product'],
    tools: 'WebSearch, WebFetch, Read',
    model: 'opus',
  },
  {
    name: 'research-writer',
    source: 'agents/research-writer.md',
    description: 'Write gspec/research.md (competitive matrix, categorized findings, gap analysis) from synthesized research, acting as the product strategist. Delegated by /gspec-research; returns a summary.',
    skills: ['gspec-product', 'gspec-conventions', 'gspec-agnosticism'],
    tools: 'Read, Write, Edit, Glob, Grep',
    remembers: true,
  },
  {
    name: 'memorizer',
    source: 'agents/memorizer.md',
    description: "Read the pending memories agents recorded and propose reviewed skill improvements (surgical diffs with provenance), acting as the steward. Read-only — proposes, never applies. Delegated by /gspec-memorize (learning loop).",
    // Reads pending memories but never writes one, so it carries no `remembers:`
    // flag — gspec-memory is preloaded explicitly, for the format it has to parse.
    skills: ['gspec-steward', 'gspec-qa', 'gspec-memory'],
    tools: 'Read, Grep, Glob',
    model: 'opus',
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
    description: 'Decompose a feature PRD into an ordered plan (gspec/features/<slug>/tasks.md) with parallel markers. Delegates plan-decomposer, plan-mode approval, gates on plan-validator (--no-qa skips). TRIGGER to sequence work or build a plan from a PRD.',
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
  {
    name: 'gspec-memorize',
    source: 'commands/gspec-memorize.md',
    description: 'Review the memories agents recorded to .gspec/memory/pending/ and commit worthy ones to their skills — one at a time, with approval. Delegates the memorizer. TRIGGER to review pending agent memories or improve skills from them.',
  },
  {
    name: 'gspec-teach',
    source: 'commands/gspec-teach.md',
    description: "Teach an agent a correction directly, without waiting for it to fail: you state it, the memorizer drafts the minimal edit, you approve before anything changes. TRIGGER to correct how an agent works, or when output was wrong in a way no gate catches.",
  },
  {
    name: 'gspec-build',
    source: 'commands/gspec-build.md',
    description: 'Run the autonomous "idea → built" build: holds the one-time intake here, then runs `gspec build` over every stage (profile → … → implement) unattended, on Claude Code, Codex, or Pi (--engine). TRIGGER to autonomously build an idea.',
  },
];

// Targets that receive the full v2 artifact split (skills + agents + commands),
// each in its native format. Claude preloads skills into agents; OpenCode, Pi,
// and the rest can't (their `skills:` field selects scopes, not a named subset),
// so their agents inline the persona (see build.js). Pi's sub-agents come from
// the pi-subagents extension, a documented install prerequisite. Every other
// target gets the DEGRADE build: one self-contained composed file per capability
// (see DEGRADE_CAPABILITIES + composeDegraded in build.js).
export const V2_TARGETS = new Set(['claude', 'opencode', 'codex', 'cursor', 'pi']);

// Degrade map: for targets without sub-agents, each capability is emitted as ONE
// self-contained file composed from the v2 sources — the command flow + its
// persona/convention skills + the primary agent's task + the validator as a
// self-review. `produce` = the agent that does the work; `check` = its validator
// (folded in as self-review); `also` = an extra agent body to include; `skills`
// overrides the inlined skill set when there is no `produce` agent.
export const DEGRADE_CAPABILITIES = [
  { command: 'gspec-profile',   produce: 'profile-writer',      check: 'profile-validator' },
  { command: 'gspec-stack',     produce: 'stack-writer',        check: 'stack-validator' },
  { command: 'gspec-practices', produce: 'practices-writer',    check: 'practices-validator' },
  { command: 'gspec-style',     produce: 'style-writer',        check: 'style-validator' },
  { command: 'gspec-feature',   produce: 'feature-writer',      check: 'feature-validator' },
  { command: 'gspec-architect', produce: 'architecture-writer', check: 'architecture-validator' },
  // The whole feature folder is one capability here: on a target without
  // sub-agents there is nowhere to fan out to, so all three writers and all
  // three checkers compose into the single /gspec-plan document.
  { command: 'gspec-plan',      produce: 'feature-architect',   check: ['feature-architecture-validator', 'feature-design-validator', 'plan-validator'], also: ['feature-designer', 'plan-decomposer'] },
  { command: 'gspec-implement', produce: 'implementer', check: 'implementation-validator', alsoSkills: ['gspec-orchestrator'] },
  { command: 'gspec-analyze',   produce: 'spec-cross-referencer' },
  { command: 'gspec-audit',     produce: 'codebase-inspector' },
  { command: 'gspec-migrate',   produce: 'spec-migrator' },
  { command: 'gspec-research',  produce: 'competitor-researcher', also: 'research-writer' },
  { command: 'gspec-memorize',  produce: 'memorizer' },
  { command: 'gspec-teach',     produce: 'memorizer' },
  { command: 'gspec-qa',        skills: ['gspec-qa'] },
];

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
