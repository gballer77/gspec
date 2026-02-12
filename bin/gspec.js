#!/usr/bin/env node

import { program } from 'commander';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
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
  },
  // cursor: {
  //   sourceDir: join(DIST_DIR, 'cursor'),
  //   installDir: '.cursor/skills',
  //   label: 'Cursor',
  // },
  // antigravity: {
  //   sourceDir: join(DIST_DIR, 'antigravity'),
  //   installDir: '.antigravity/skills',
  //   label: 'Antigravity',
  // },
};

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

  // Filter to skill directories (each contains SKILL.md)
  const skills = [];
  for (const entry of entries) {
    const entryPath = join(target.sourceDir, entry);
    const info = await stat(entryPath);
    if (info.isDirectory()) {
      skills.push(entry);
    }
  }

  if (skills.length === 0) {
    console.error(chalk.red(`No skills found in dist/${targetName}/`));
    process.exit(1);
  }

  console.log(chalk.bold(`\nInstalling gspec skills for ${target.label}...\n`));

  for (const skill of skills) {
    const srcPath = join(target.sourceDir, skill, 'SKILL.md');
    const destDir = join(cwd, target.installDir, skill);
    const destPath = join(destDir, 'SKILL.md');

    await mkdir(destDir, { recursive: true });
    const content = await readFile(srcPath, 'utf-8');
    await writeFile(destPath, content, 'utf-8');

    console.log(`  ${chalk.green('+')} ${skill}`);
  }

  console.log(chalk.bold(`\n${skills.length} skills installed to ${target.installDir}/\n`));
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
