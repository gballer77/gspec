#!/usr/bin/env node

import { program } from 'commander';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

const TARGETS = {
  claude: {
    sourceDir: join(DIST_DIR, 'claude'),
    installDir: '.claude/commands',
    label: 'Claude Code',
  },
  // cursor: {
  //   sourceDir: join(DIST_DIR, 'cursor'),
  //   installDir: '.cursor/commands',
  //   label: 'Cursor',
  // },
  // antigravity: {
  //   sourceDir: join(DIST_DIR, 'antigravity'),
  //   installDir: '.antigravity/commands',
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

  const destDir = join(cwd, target.installDir);
  await mkdir(destDir, { recursive: true });

  let files;
  try {
    files = (await readdir(target.sourceDir)).filter(f => f.endsWith('.md'));
  } catch {
    console.error(chalk.red(`No built files found for target "${targetName}".`));
    console.error('Run the build first: npm run build');
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(chalk.red(`No command files found in dist/${targetName}/`));
    process.exit(1);
  }

  console.log(chalk.bold(`\nInstalling gspec commands for ${target.label}...\n`));

  for (const file of files) {
    const content = await readFile(join(target.sourceDir, file), 'utf-8');
    const destPath = join(destDir, file);
    await writeFile(destPath, content, 'utf-8');

    const commandName = file.replace(/\.md$/, '');
    console.log(`  ${chalk.green('+')} ${commandName}`);
  }

  console.log(chalk.bold(`\n${files.length} commands installed to ${target.installDir}/\n`));
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
