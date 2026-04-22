#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const DIST_DIR = join(ROOT, 'dist');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));

// Version placeholder — replaced before platform-specific transforms
const VERSION_RE = /<<<VERSION>>>/g;
const SPEC_VERSION = 'v1';
const SPEC_VERSION_RE = /<<<SPEC_VERSION>>>/g;

// Placeholder pattern used in generic command files
const PLACEHOLDER_RE = /<<<\w+>>>/g;

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
  'gspec.style.md': {
    name: 'gspec-style',
    description: 'Generate or update the visual style guide (gspec/style.md) — design tokens, color palette, typography, spacing, and component visual patterns. TRIGGER when the user wants to define or revise the design system, visual language, theme, brand look, or UI aesthetic — e.g. "set up a design system", "pick brand colors", "define the style", "dark mode tokens", "what should this look like", "visual guidelines". Prefer this skill over producing style docs ad hoc.',
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
    description: 'Analyze gspec/ documents for discrepancies, contradictions, or drift and reconcile conflicts across profile, stack, style, practices, architecture, and features. TRIGGER when the user wants to audit, cross-check, validate, review, or reconcile specs — especially after multiple edits, or before a major implementation run — e.g. "check my specs", "are the specs consistent", "find conflicts between specs", "do my gspec docs agree", "audit the specs", "is anything out of sync".',
  },
  'gspec.research.md': {
    name: 'gspec-research',
    description: 'Research competitors named in gspec/profile.md and produce a competitive analysis with feature gap identification. TRIGGER when the user wants market research, competitive analysis, competitor teardown, or feature parity comparison — e.g. "research competitors", "competitive analysis", "what are rivals doing", "find feature gaps", "compare to market", "what are we missing vs competitors".',
  },
  'gspec.implement.md': {
    name: 'gspec-implement',
    description: 'Implement the software defined by gspec/ documents — reads profile, stack, style, practices, architecture, and features, then builds code phase by phase with tests and checkpoints. **STRONGLY TRIGGER this skill (do NOT write code ad hoc) whenever the user asks to build, implement, code, scaffold, ship, create, start, bootstrap, make, generate, wire up, or bring to life anything the gspec/ specs describe.** Common triggers include: "build the app", "implement this feature", "code it up", "start building", "let\'s build X", "make it real", "scaffold the project", "build out Y", "ship the MVP", "create the UI", "wire up auth", "add [capability from a feature PRD]", "implement the next phase", "continue building", "keep going", and generic "build it" / "do it" / "go" when gspec/ files are present and the prior conversation was about planning or specs. Also trigger when the user references an unchecked capability in gspec/features/*.md. Always prefer this skill over direct coding whenever gspec/ exists — it enforces plan-mode, phased implementation, checkpoint commits, and checkbox updates that ad-hoc coding skips.',
  },
  'gspec.migrate.md': {
    name: 'gspec-migrate',
    description: 'Migrate gspec/ files to the current spec format (frontmatter, schema, capability checkboxes) when upgrading the gspec version. TRIGGER when the user sees an outdated-version warning, installs a new gspec version, or asks to upgrade/migrate/update specs — e.g. "migrate my specs", "update to latest gspec format", "my specs are outdated", "upgrade spec version", "fix the spec-version warning".',
  },
};

function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// Each target defines how to emit files and transform content
const targets = {
  claude: {
    outDir: join(DIST_DIR, 'claude'),
    // .claude/skills/<name>/SKILL.md
    async emit(outDir, content, meta) {
      const frontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      const body = content.replace(PLACEHOLDER_RE, '$ARGUMENTS');
      const skillDir = join(outDir, meta.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
  cursor: {
    outDir: join(DIST_DIR, 'cursor'),
    // .cursor/commands/<name>.mdc (flat file)
    async emit(outDir, content, meta) {
      const frontmatter = buildFrontmatter({
        description: meta.description,
      });
      // Cursor has no $ARGUMENTS convention; strip the placeholder lines
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, `${meta.name}.mdc`), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
  antigravity: {
    outDir: join(DIST_DIR, 'antigravity'),
    // .agent/skills/<name>/SKILL.md
    async emit(outDir, content, meta) {
      const frontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      // Antigravity uses natural language invocation; strip the placeholder lines
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const skillDir = join(outDir, meta.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
  codex: {
    outDir: join(DIST_DIR, 'codex'),
    // .agents/skills/<name>/SKILL.md
    async emit(outDir, content, meta) {
      const frontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      // Codex uses natural language invocation; strip the placeholder lines
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const skillDir = join(outDir, meta.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
  opencode: {
    outDir: join(DIST_DIR, 'opencode'),
    // .opencode/skills/<name>/SKILL.md
    async emit(outDir, content, meta) {
      const frontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      // OpenCode uses natural language invocation; strip the placeholder lines
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const skillDir = join(outDir, meta.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
};

async function build(targetNames) {
  const files = (await readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));

  for (const targetName of targetNames) {
    const target = targets[targetName];
    if (!target) {
      console.error(`Unknown target: ${targetName}`);
      process.exit(1);
    }

    let count = 0;
    for (const file of files) {
      const meta = COMMANDS[file];
      if (!meta) {
        console.warn(`No metadata for ${file}, skipping`);
        continue;
      }

      const raw = await readFile(join(COMMANDS_DIR, file), 'utf-8');
      const content = raw.replace(VERSION_RE, pkg.version).replace(SPEC_VERSION_RE, SPEC_VERSION);
      await target.emit(target.outDir, content, meta);
      count++;
    }

    console.log(`Built ${count} skills → dist/${targetName}/`);
  }
}

// Build all targets by default, or specific ones via CLI args
const requested = process.argv.slice(2);
const targetNames = requested.length > 0 ? requested : Object.keys(targets);

build(targetNames).catch(err => {
  console.error(err);
  process.exit(1);
});
