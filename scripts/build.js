#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const DIST_DIR = join(ROOT, 'dist');

// Placeholder pattern used in generic command files
const PLACEHOLDER_RE = /<<<\w+>>>/g;

// Metadata for each command, keyed by source filename
const COMMANDS = {
  'gspec.profile.md': {
    name: 'gspec-profile',
    description: 'Generate a product profile defining what the product is, who it serves, and why it exists',
  },
  'gspec.feature.md': {
    name: 'gspec-feature',
    description: 'Generate a product requirements document (PRD) for an individual feature',
  },
  'gspec.epic.md': {
    name: 'gspec-epic',
    description: 'Break down a large epic into multiple focused feature PRDs with dependency mapping',
  },
  'gspec.style.md': {
    name: 'gspec-style',
    description: 'Generate a visual style guide with design tokens, color palette, and component patterns',
  },
  'gspec.stack.md': {
    name: 'gspec-stack',
    description: 'Define the technology stack, frameworks, infrastructure, and architectural patterns',
  },
  'gspec.practices.md': {
    name: 'gspec-practices',
    description: 'Define development practices, code quality standards, and engineering workflows',
  },
  'gspec.implement.md': {
    name: 'gspec-implement',
    description: 'Read gspec documents, research competitors, identify gaps, and implement the software',
  },
  'gspec.dor.md': {
    name: 'gspec-dor',
    description: 'Make code changes and update gspec specification documents to reflect what changed',
  },
  'gspec.record.md': {
    name: 'gspec-record',
    description: 'Update gspec specification documents to reflect changes, decisions, or context from the conversation',
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

      const content = await readFile(join(COMMANDS_DIR, file), 'utf-8');
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
