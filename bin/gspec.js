#!/usr/bin/env node

import { program } from 'commander';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));

const BANNER = `
  ${chalk.cyan('╔══════════════════════════════════════════════╗')}
  ${chalk.cyan('║')}                                              ${chalk.cyan('║')}
  ${chalk.cyan('║')}   ${chalk.bold.white(' ██████  ███████ ██████  ███████  ██████')}   ${chalk.cyan('║')}
  ${chalk.cyan('║')}   ${chalk.bold.white('██       ██      ██   ██ ██      ██      ')}  ${chalk.cyan('║')}
  ${chalk.cyan('║')}   ${chalk.bold.white('██   ███ ███████ ██████  █████   ██      ')}  ${chalk.cyan('║')}
  ${chalk.cyan('║')}   ${chalk.bold.white('██    ██      ██ ██      ██      ██      ')}  ${chalk.cyan('║')}
  ${chalk.cyan('║')}   ${chalk.bold.white(' ██████  ███████ ██      ███████  ██████')}   ${chalk.cyan('║')}
  ${chalk.cyan('║')}                                              ${chalk.cyan('║')}
  ${chalk.cyan('║')}    ${chalk.dim('AI-powered project specification tools')}    ${chalk.cyan('║')}
  ${chalk.cyan('║')}                                              ${chalk.cyan('║')}
  ${chalk.cyan('╚══════════════════════════════════════════════╝')}
  ${chalk.white('═════════════════════════════baller.software═══')}
`;

const TARGETS = {
  claude: {
    sourceDir: join(DIST_DIR, 'claude'),
    installDir: '.claude/skills',
    label: 'Claude Code',
    layout: 'directory',
  },
  cursor: {
    sourceDir: join(DIST_DIR, 'cursor'),
    installDir: '.cursor/commands',
    label: 'Cursor',
    layout: 'flat',
  },
  antigravity: {
    sourceDir: join(DIST_DIR, 'antigravity'),
    installDir: '.agent/skills',
    label: 'Antigravity',
    layout: 'directory',
  },
};

const TARGET_CHOICES = [
  { key: '1', name: 'claude', label: 'Claude Code' },
  { key: '2', name: 'cursor', label: 'Cursor' },
  { key: '3', name: 'antigravity', label: 'Antigravity' },
];

function promptTarget() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold('\nWhich application are you installing gspec for?\n'));
  for (const choice of TARGET_CHOICES) {
    console.log(`  ${chalk.cyan(choice.key)}) ${choice.label}`);
  }
  console.log();

  return new Promise((resolve) => {
    rl.question(chalk.bold('  Select [1-3]: '), (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();

      // Accept by number
      const byNumber = TARGET_CHOICES.find(c => c.key === trimmed);
      if (byNumber) return resolve(byNumber.name);

      // Accept by name
      const byName = TARGET_CHOICES.find(c => c.name === trimmed || c.label.toLowerCase() === trimmed);
      if (byName) return resolve(byName.name);

      console.error(chalk.red(`\nInvalid selection: "${answer.trim()}"`));
      console.error(`Valid options: 1, 2, 3, claude, cursor, antigravity`);
      process.exit(1);
    });
  });
}

function promptConfirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

async function findExistingFiles(target, cwd) {
  const existing = [];
  const destBase = join(cwd, target.installDir);

  try {
    await stat(destBase);
  } catch (e) {
    if (e.code === 'ENOENT') return existing;
    throw e;
  }

  if (target.layout === 'flat') {
    const srcEntries = await readdir(target.sourceDir);
    for (const file of srcEntries.filter(f => f.endsWith('.mdc'))) {
      try {
        await stat(join(destBase, file));
        existing.push(file);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  } else {
    const srcEntries = await readdir(target.sourceDir);
    for (const entry of srcEntries) {
      const info = await stat(join(target.sourceDir, entry));
      if (!info.isDirectory()) continue;
      try {
        await stat(join(destBase, entry, 'SKILL.md'));
        existing.push(`${entry}/SKILL.md`);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }

  return existing;
}

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

  const existing = await findExistingFiles(target, cwd);
  if (existing.length > 0) {
    console.log(chalk.yellow(`\nThe following files already exist and will be overwritten:\n`));
    for (const file of existing) {
      console.log(`  ${chalk.yellow('!')} ${target.installDir}/${file}`);
    }
    console.log();
    const confirmed = await promptConfirm(chalk.bold('  Continue and overwrite? [y/N]: '));
    if (!confirmed) {
      console.log(chalk.dim('\nInstallation cancelled.\n'));
      process.exit(0);
    }
  }

  console.log(chalk.bold(`\nInstalling gspec skills for ${target.label}...\n`));

  const count = target.layout === 'flat'
    ? await installFlat(target, cwd)
    : await installDirectory(target, cwd);

  console.log(chalk.bold(`\n${count} skills installed to ${target.installDir}/\n`));
}

const MIGRATE_COMMANDS = {
  claude: '/gspec-migrate',
  cursor: '/gspec-migrate',
  antigravity: '/gspec-migrate',
};

function parseGspecVersion(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const versionMatch = match[1].match(/^gspec-version:\s*(.+)$/m);
  return versionMatch ? versionMatch[1].trim() : null;
}

async function collectGspecFiles(gspecDir) {
  const files = [];

  const topEntries = await readdir(gspecDir);
  for (const entry of topEntries) {
    if (entry.endsWith('.md')) {
      files.push({ path: join(gspecDir, entry), label: `gspec/${entry}` });
    }
  }

  for (const subdir of ['features', 'epics']) {
    try {
      const entries = await readdir(join(gspecDir, subdir));
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          files.push({ path: join(gspecDir, subdir, entry), label: `gspec/${subdir}/${entry}` });
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  return files;
}

async function checkGspecFiles(cwd, targetName) {
  const gspecDir = join(cwd, 'gspec');

  try {
    await stat(gspecDir);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }

  const files = await collectGspecFiles(gspecDir);
  if (files.length === 0) return;

  const outdated = [];
  for (const file of files) {
    const content = await readFile(file.path, 'utf-8');
    const version = parseGspecVersion(content);
    if (version === pkg.version) continue;
    outdated.push({
      label: file.label,
      version,
    });
  }

  if (outdated.length === 0) return;

  console.log(chalk.yellow(`  Found existing gspec files that may need updating:\n`));
  for (const file of outdated) {
    const status = file.version
      ? `version ${file.version} (current: ${pkg.version})`
      : `no version (pre-${pkg.version})`;
    console.log(`    ${chalk.yellow('!')} ${file.label} — ${status}`);
  }
  console.log();

  const confirmed = await promptConfirm(chalk.bold('  Update existing gspec files to the current format? [y/N]: '));
  if (!confirmed) return;

  const cmd = MIGRATE_COMMANDS[targetName] || '/gspec-migrate';
  console.log(chalk.bold(`\n  To update your files, run the following command in ${TARGETS[targetName].label}:\n`));
  console.log(`    ${chalk.cyan(cmd)}\n`);
}

program
  .name('gspec')
  .description('Install gspec specification commands')
  .version(pkg.version)
  .option('-t, --target <target>', 'target platform (claude, cursor, antigravity)')
  .action(async (opts) => {
    console.log(BANNER);

    let targetName = opts.target;

    if (!targetName) {
      targetName = await promptTarget();
    }

    await install(targetName, process.cwd());
    await checkGspecFiles(process.cwd(), targetName);
  });

program.parse();
