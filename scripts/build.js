#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from '../bin/emitters.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const DIST_DIR = join(ROOT, 'dist');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));

// Version placeholder — replaced before platform-specific transforms
const VERSION_RE = /<<<VERSION>>>/g;
const SPEC_VERSION = 'v1';
const SPEC_VERSION_RE = /<<<SPEC_VERSION>>>/g;

// Metadata for each command, keyed by source filename
const COMMANDS = {
  'gspec.profile.md': {
    name: 'gspec-profile',
    description: 'Generate or update the product profile (gspec/profile.md) — what the product is, who it serves, and why it exists. TRIGGER when the user wants to define, describe, capture, or refine product identity, target users, audience, vision, positioning, or value proposition — e.g. "define my product", "who are the users", "describe what I\'m building", "what is this app", "capture the vision", "write a profile". Prefer this skill over drafting a profile ad hoc.',
  },
  'gspec.feature.md': {
    name: 'gspec-feature',
    description: 'Generate product requirements documents (PRDs) for features in gspec/features/. TRIGGER when the user wants to plan, spec, propose, document, or expand a feature/capability before coding — e.g. "add a feature for X", "write a PRD", "spec out Y", "plan this feature", "what should the auth flow do", "new feature idea", "draft requirements". Prefer this skill over writing freeform feature docs.',
  },
  'gspec.plan.md': {
    name: 'gspec-plan',
    description: 'Decompose a feature PRD in gspec/features/ into an ordered, dependency-aware plan with parallel-execution markers, written to gspec/features/<feature>.plan.md. The plan is what gspec-implement consumes as its build order — when a plan file exists, gspec-implement skips its own plan-mode step. TRIGGER when the user wants to plan execution order, break a feature into tasks, identify what can run in parallel, sequence implementation work, or produce a build plan from a PRD — e.g. "plan this feature", "what order should I build this in", "plan the implementation order", "break this feature into tasks", "what can run in parallel", "decompose feature Y", "ordered build plan". Run this AFTER gspec-feature and BEFORE gspec-implement when a feature is large or has non-obvious ordering. Prefer this skill over ad-hoc task lists.',
  },
  'gspec.style.md': {
    name: 'gspec-style',
    description: 'Generate or update the visual style guide — either a renderable HTML design system (gspec/style.html) or a Markdown style guide (gspec/style.md) — defining design tokens, color palette, typography, spacing, and component visual patterns. Also aware of gspec/design/ for external mockups. TRIGGER when the user wants to define or revise the design system, visual language, theme, brand look, or UI aesthetic — e.g. "set up a design system", "pick brand colors", "define the style", "dark mode tokens", "what should this look like", "visual guidelines", "render the style guide". Prefer this skill over producing style docs ad hoc.',
  },
  'gspec.stack.md': {
    name: 'gspec-stack',
    description: 'Define or update the technology stack (gspec/stack.md) — frameworks, libraries, databases, hosting, CI/CD, and infrastructure. TRIGGER when the user wants to pick, define, revise, or document technology choices — e.g. "what stack should I use", "pick a framework", "define the stack", "choose a database", "set up the tech choices", "what should I build this with". Prefer this skill over suggesting ad-hoc tech picks.',
  },
  'gspec.practices.md': {
    name: 'gspec-practices',
    description: 'Define or update development practices (gspec/practices.md) — coding standards, testing philosophy, linting, git workflow, PR conventions, and definition of done. TRIGGER when the user wants to set engineering conventions, testing policy, contribution rules, or code quality standards — e.g. "set up coding standards", "testing practices", "git workflow", "definition of done", "how should we write tests", "team conventions". Prefer this skill over ad-hoc convention docs.',
  },
  'gspec.architect.md': {
    name: 'gspec-architect',
    description: 'Define or update the technical architecture (gspec/architecture.md) — project structure, data model, API design, component hierarchy, and environment/config. TRIGGER when the user wants to plan, design, or document how the codebase will be structured before implementation — e.g. "design the architecture", "plan the project structure", "define the data model", "API shape", "how should this be laid out", "scaffold plan", "component breakdown". Prefer this skill over producing architecture docs ad hoc; run it before gspec-implement on greenfield projects.',
  },
  'gspec.analyze.md': {
    name: 'gspec-analyze',
    description: 'Analyze gspec/ documents for discrepancies and contradictions across profile, stack, style, practices, architecture, and features. Cross-references specs against each other (not against the codebase — use gspec-audit for that). Two modes: no argument scans all specs for cross-spec conflicts; with a feature slug (e.g. `/gspec-analyze user-authentication`) it narrows to that feature and adds an ambiguity sweep — missing acceptance criteria, vague verbs, undefined nouns, implicit assumptions, unmeasurable success metrics. TRIGGER when the user wants to cross-check, validate, or reconcile specs — e.g. "check my specs", "are the specs consistent", "find conflicts between specs", "is anything contradictory". ALSO TRIGGER when scrutinizing a single feature PRD for gaps or ambiguity — e.g. "is the auth PRD clear enough", "find ambiguity in <feature>", "is this PRD ready for implement" — pass the feature slug as the argument.',
  },
  'gspec.audit.md': {
    name: 'gspec-audit',
    description: 'Audit gspec/ documents against the actual codebase to find drift between what the specs say and what the code does, then walk the user through reconciling each discrepancy — typically by updating specs to match reality. Reads package manifests, config files, source code, and tests to detect stack/architecture/style/practice/feature drift, and detects orphan capabilities (coherent features the code implements that no PRD covers) — drafting a new PRD in gspec/features/ when the user accepts. TRIGGER when the user wants to check specs against code, catch documentation drift, sync specs with reality, or find unspecced features — e.g. "audit the specs", "check if specs match the code", "find spec drift", "update specs to match the code", "find features that aren\'t spec\'d". Distinct from gspec-analyze (specs vs. specs) and from always-on spec-sync (in-session code reactions).',
  },
  'gspec.research.md': {
    name: 'gspec-research',
    description: 'Research competitors named in gspec/profile.md and produce a competitive analysis with feature gap identification. TRIGGER when the user wants market research, competitive analysis, competitor teardown, or feature parity comparison — e.g. "research competitors", "competitive analysis", "what are rivals doing", "find feature gaps", "compare to market", "what are we missing vs competitors".',
  },
  'gspec.implement.md': {
    name: 'gspec-implement',
    description: 'Implement software defined by gspec/ documents — reads profile, stack, style, practices, architecture, features, and design mockups, then builds code phase by phase with tests and checkpoints. STRONGLY TRIGGER (do not write code ad hoc) whenever the user asks to build, implement, code, scaffold, ship, create, start, bootstrap, wire up, or "make real" anything the specs describe — e.g. "build the app", "implement this feature", "scaffold the project", "ship the MVP", "wire up auth", "implement the next phase", "continue building", and generic "build it" / "go" / "keep going" when gspec/ files exist and the conversation was about planning. Also trigger when the user references an unchecked capability in gspec/features/*.md. Prefer this skill over direct coding — it enforces plan-mode, phased implementation, checkpoint commits, and checkbox updates.',
  },
  'gspec.migrate.md': {
    name: 'gspec-migrate',
    description: 'Migrate gspec/ files to the current spec format (frontmatter, schema, capability checkboxes) when upgrading the gspec version. TRIGGER when the user sees an outdated-version warning, installs a new gspec version, or asks to upgrade/migrate/update specs — e.g. "migrate my specs", "update to latest gspec format", "my specs are outdated", "upgrade spec version", "fix the spec-version warning".',
  },
};

// Frontmatter description limits across emit targets:
//   - Claude Code: 1024 chars hard cap (rejected above), but only the first
//     250 chars are kept when descriptions are injected into the system prompt
//     for skill selection. Anything past 250 is silently dropped.
//   - OpenCode: 1024 chars hard cap.
//   - Codex / Antigravity / Cursor: no documented per-description cap.
// We fail the build above 1024 and warn above 250 so authors front-load the
// trigger signal where Claude Code can actually see it.
const DESCRIPTION_HARD_MAX = 1024;
const DESCRIPTION_SOFT_MAX = 250;

function validateCommands(commands) {
  const errors = [];
  const warnings = [];
  for (const [file, meta] of Object.entries(commands)) {
    if (!meta.name) errors.push(`${file}: missing name`);
    if (!meta.description) {
      errors.push(`${file}: missing description`);
      continue;
    }
    const len = meta.description.length;
    if (len > DESCRIPTION_HARD_MAX) {
      errors.push(`${file}: description is ${len} chars, exceeds hard cap of ${DESCRIPTION_HARD_MAX} (Claude Code / OpenCode reject above this)`);
    } else if (len > DESCRIPTION_SOFT_MAX) {
      warnings.push(`${file}: description is ${len} chars, exceeds Claude Code's ${DESCRIPTION_SOFT_MAX}-char selection window — content past char ${DESCRIPTION_SOFT_MAX} is dropped when Claude decides whether to invoke the skill`);
    }
  }
  return { errors, warnings };
}

async function build(targetNames) {
  const { errors, warnings } = validateCommands(COMMANDS);
  for (const w of warnings) console.warn(`WARN  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`);
    process.exit(1);
  }

  const files = (await readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));

  for (const targetName of targetNames) {
    const target = TARGETS[targetName];
    if (!target) {
      console.error(`Unknown target: ${targetName}`);
      process.exit(1);
    }

    const outDir = join(DIST_DIR, target.distSubdir);

    let count = 0;
    for (const file of files) {
      const meta = COMMANDS[file];
      if (!meta) {
        console.warn(`No metadata for ${file}, skipping`);
        continue;
      }

      const raw = await readFile(join(COMMANDS_DIR, file), 'utf-8');
      const content = raw.replace(VERSION_RE, pkg.version).replace(SPEC_VERSION_RE, SPEC_VERSION);
      await target.emit(outDir, content, meta);
      count++;
    }

    console.log(`Built ${count} skills → dist/${targetName}/`);
  }
}

// Build all targets by default, or specific ones via CLI args
const requested = process.argv.slice(2);
const targetNames = requested.length > 0 ? requested : Object.keys(TARGETS);

build(targetNames).catch(err => {
  console.error(err);
  process.exit(1);
});
