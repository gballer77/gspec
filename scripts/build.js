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
};

function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

const targets = {
  claude: {
    outDir: join(DIST_DIR, 'claude'),
    transform(content, meta) {
      const frontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      const body = content.replace(PLACEHOLDER_RE, '$ARGUMENTS');
      return frontmatter + '\n\n' + body;
    },
  },
  // Future targets:
  // cursor: { outDir: join(DIST_DIR, 'cursor'), transform(content, meta) { ... } },
  // antigravity: { outDir: join(DIST_DIR, 'antigravity'), transform(content, meta) { ... } },
};

async function build(targetNames) {
  const files = (await readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));

  for (const targetName of targetNames) {
    const target = targets[targetName];
    if (!target) {
      console.error(`Unknown target: ${targetName}`);
      process.exit(1);
    }

    for (const file of files) {
      const meta = COMMANDS[file];
      if (!meta) {
        console.warn(`No metadata for ${file}, skipping`);
        continue;
      }

      // Claude skills live in <skill-name>/SKILL.md
      const skillDir = join(target.outDir, meta.name);
      await mkdir(skillDir, { recursive: true });

      const content = await readFile(join(COMMANDS_DIR, file), 'utf-8');
      const transformed = target.transform(content, meta);
      await writeFile(join(skillDir, 'SKILL.md'), transformed, 'utf-8');
    }

    console.log(`Built ${files.length} skills → dist/${targetName}/`);
  }
}

// Build all targets by default, or specific ones via CLI args
const requested = process.argv.slice(2);
const targetNames = requested.length > 0 ? requested : Object.keys(targets);

build(targetNames).catch(err => {
  console.error(err);
  process.exit(1);
});
