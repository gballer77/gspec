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
    description: 'Generate or update gspec/profile.md — what the product is, who it serves, and why. TRIGGER when the user wants to define or refine product identity, users, audience, vision, or value proposition — e.g. "define my product", "what is this app".',
  },
  'gspec.feature.md': {
    name: 'gspec-feature',
    description: 'Generate PRDs for features in gspec/features/. TRIGGER when the user wants to plan, spec, propose, or document a feature before coding — e.g. "add a feature for X", "write a PRD", "spec out Y", "plan this feature", "draft requirements".',
  },
  'gspec.plan.md': {
    name: 'gspec-plan',
    description: 'Decompose a feature PRD into an ordered, dependency-aware plan with parallel-execution markers, written to <feature>.plan.md. Runs between gspec-feature and gspec-implement. TRIGGER when the user wants to sequence work or build a plan from a PRD.',
  },
  'gspec.style.md': {
    name: 'gspec-style',
    description: 'Generate or update the visual style guide (gspec/style.html or gspec/style.md) — tokens, palette, typography, spacing, components. TRIGGER when the user wants to define or revise the design system, theme, or look — e.g. "pick brand colors".',
  },
  'gspec.stack.md': {
    name: 'gspec-stack',
    description: 'Define or update gspec/stack.md — frameworks, libraries, databases, hosting, CI/CD, and infrastructure. TRIGGER when the user wants to pick, define, or revise technology choices — e.g. "what stack should I use", "pick a framework".',
  },
  'gspec.practices.md': {
    name: 'gspec-practices',
    description: 'Define or update gspec/practices.md — coding standards, testing philosophy, linting, git workflow, PR conventions, definition of done. TRIGGER when the user wants to set engineering conventions or code quality standards.',
  },
  'gspec.architect.md': {
    name: 'gspec-architect',
    description: 'Define or update gspec/architecture.md — project structure, data model, API design, component hierarchy, and environment/config. TRIGGER when the user wants to design or document codebase structure before implementation.',
  },
  'gspec.analyze.md': {
    name: 'gspec-analyze',
    description: 'Analyze gspec/ for cross-spec contradictions across profile, stack, style, practices, architecture, features. With a feature slug, narrows to that PRD plus an ambiguity sweep. TRIGGER to cross-check or reconcile specs, or find gaps in a PRD.',
  },
  'gspec.audit.md': {
    name: 'gspec-audit',
    description: 'Audit gspec/ against the codebase to find drift, then reconcile each discrepancy. Detects orphan capabilities (features the code implements with no PRD). TRIGGER to check specs against code, sync with reality, or find unspecced features.',
  },
  'gspec.research.md': {
    name: 'gspec-research',
    description: 'Research competitors from gspec/profile.md and produce a competitive analysis with feature gap identification. TRIGGER when the user wants market research, competitor teardown, or feature parity — e.g. "research competitors", "find feature gaps".',
  },
  'gspec.implement.md': {
    name: 'gspec-implement',
    description: 'Implement software defined by gspec/ specs — phased build with tests and checkpoints. STRONGLY TRIGGER when the user asks to build, implement, code, scaffold, or ship specced work, or references an unchecked capability in gspec/features/*.md.',
  },
  'gspec.migrate.md': {
    name: 'gspec-migrate',
    description: 'Migrate gspec/ files to the current spec format when upgrading gspec. TRIGGER when the user sees an outdated-version warning or asks to upgrade specs — e.g. "migrate my specs", "my specs are outdated", "fix the spec-version warning".',
  },
};

// Frontmatter description cap.
//
// Claude Code is the tightest constraint we ship to: descriptions are
// truncated to 250 characters when injected into the system prompt for
// skill selection (anything past char 250 is silently dropped when Claude
// decides whether to invoke a skill). The documented hard caps for
// Claude Code and OpenCode are both 1024, but 250 is the *effective* limit
// for trigger matching, so we enforce it as the hard cap to keep all our
// skill descriptions within the window where Claude actually reads them.
const DESCRIPTION_MAX = 250;

function validateCommands(commands) {
  const errors = [];
  for (const [file, meta] of Object.entries(commands)) {
    if (!meta.name) errors.push(`${file}: missing name`);
    if (!meta.description) {
      errors.push(`${file}: missing description`);
      continue;
    }
    const len = meta.description.length;
    if (len > DESCRIPTION_MAX) {
      errors.push(`${file}: description is ${len} chars, exceeds cap of ${DESCRIPTION_MAX} (Claude Code truncates to ${DESCRIPTION_MAX} for skill selection — content past that is dropped when Claude decides whether to invoke the skill)`);
    }
  }
  return errors;
}

async function build(targetNames) {
  const errors = validateCommands(COMMANDS);
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
