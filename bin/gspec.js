#!/usr/bin/env node

import { program } from 'commander';
import { readdir, readFile, writeFile, mkdir, stat, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

const TARGETS = {
  claude: {
    sourceDir: join(DIST_DIR, 'claude'),
    installDir: '.claude/skills',
    label: 'Claude Code',
    // Skills are directories containing SKILL.md
    layout: 'directory',
  },
  cursor: {
    sourceDir: join(DIST_DIR, 'cursor'),
    installDir: '.cursor/commands',
    label: 'Cursor',
    // Commands are flat .mdc files
    layout: 'flat',
  },
  antigravity: {
    sourceDir: join(DIST_DIR, 'antigravity'),
    installDir: '.agent/skills',
    label: 'Antigravity',
    // Skills are directories containing SKILL.md
    layout: 'directory',
  },
};

async function installDirectory(target, cwd) {
  const entries = await readdir(target.sourceDir);
  const skills = [];
  for (const entry of entries) {
    const info = await stat(join(target.sourceDir, entry));
    if (info.isDirectory()) skills.push(entry);
  }

  for (const skill of skills) {
    const srcPath = join(target.sourceDir, skill, 'SKILL.md');
    const destDir = join(cwd, target.installDir, skill);
    await mkdir(destDir, { recursive: true });
    const content = await readFile(srcPath, 'utf-8');
    await writeFile(join(destDir, 'SKILL.md'), content, 'utf-8');
    console.log(`  ${chalk.green('+')} ${skill}`);
  }

  return skills.length;
}

async function installFlat(target, cwd) {
  const entries = await readdir(target.sourceDir);
  const files = entries.filter(f => f.endsWith('.mdc'));
  const destDir = join(cwd, target.installDir);
  await mkdir(destDir, { recursive: true });

  for (const file of files) {
    const content = await readFile(join(target.sourceDir, file), 'utf-8');
    await writeFile(join(destDir, file), content, 'utf-8');
    const name = file.replace(/\.mdc$/, '');
    console.log(`  ${chalk.green('+')} ${name}`);
  }

  return files.length;
}

async function install(targetName, cwd) {
  const target = TARGETS[targetName];
  if (!target) {
    console.error(chalk.red(`Unknown target: ${targetName}`));
    console.error(`Available targets: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  let entries;
  try {
    entries = await readdir(target.sourceDir);
  } catch {
    console.error(chalk.red(`No built files found for target "${targetName}".`));
    console.error('Run the build first: npm run build');
    process.exit(1);
  }

  if (entries.length === 0) {
    console.error(chalk.red(`No skills found in dist/${targetName}/`));
    process.exit(1);
  }

  console.log(chalk.bold(`\nInstalling gspec skills for ${target.label}...\n`));

  const count = target.layout === 'flat'
    ? await installFlat(target, cwd)
    : await installDirectory(target, cwd);

  console.log(chalk.bold(`\n${count} skills installed to ${target.installDir}/\n`));
}

program
  .name('gspec')
  .description('Install gspec specification commands')
  .version('1.0.0')
  .option('-t, --target <target>', 'target platform (claude, cursor, antigravity)', 'claude')
  .action(async (opts) => {
    await install(opts.target, process.cwd());
  });

program.parse();
