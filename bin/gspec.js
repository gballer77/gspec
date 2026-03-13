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
  codex: {
    sourceDir: join(DIST_DIR, 'codex'),
    installDir: '.agents/skills',
    label: 'Codex',
    layout: 'directory',
  },
};

const TARGET_CHOICES = [
  { key: '1', name: 'claude', label: 'Claude Code' },
  { key: '2', name: 'cursor', label: 'Cursor' },
  { key: '3', name: 'antigravity', label: 'Antigravity' },
  { key: '4', name: 'codex', label: 'Codex' },
];

function promptTarget() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold('\nWhich application are you installing gspec for?\n'));
  for (const choice of TARGET_CHOICES) {
    console.log(`  ${chalk.cyan(choice.key)}) ${choice.label}`);
  }
  console.log();

  return new Promise((resolve) => {
    rl.question(chalk.bold('  Select [1-4]: '), (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();

      // Accept by number
      const byNumber = TARGET_CHOICES.find(c => c.key === trimmed);
      if (byNumber) return resolve(byNumber.name);

      // Accept by name
      const byName = TARGET_CHOICES.find(c => c.name === trimmed || c.label.toLowerCase() === trimmed);
      if (byName) return resolve(byName.name);

      console.error(chalk.red(`\nInvalid selection: "${answer.trim()}"`));
      console.error(`Valid options: 1, 2, 3, 4, claude, cursor, antigravity, codex`);
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

function promptConfirmNo(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith('n'));
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

  // Create gspec/ directory and install README
  const gspecDir = join(cwd, 'gspec');
  await mkdir(gspecDir, { recursive: true });
  const readmeContent = await readFile(join(__dirname, '..', 'README.md'), 'utf-8');
  await writeFile(join(gspecDir, 'README.md'), readmeContent, 'utf-8');
  console.log(chalk.bold(`  Created gspec/ directory with README.md\n`));
}

// Spec-sync instructions: platform-specific config for "always-on" agent rules
const SPEC_SYNC = {
  claude: {
    file: 'CLAUDE.md',
    mode: 'append', // append to existing file or create new
    wrap: (content) => content,
  },
  cursor: {
    file: '.cursor/rules/gspec.mdc',
    mode: 'create', // dedicated rule file, safe to overwrite
    wrap: (content) => `---\ndescription: gspec specification sync — keeps living specs in sync with code changes\nalwaysApply: true\n---\n\n${content}`,
  },
  antigravity: {
    file: '.agent/rules/gspec.mdc',
    mode: 'create',
    wrap: (content) => `---\ndescription: gspec specification sync — keeps living specs in sync with code changes\nalwaysApply: true\n---\n\n${content}`,
  },
  codex: {
    file: 'AGENTS.md',
    mode: 'append',
    wrap: (content) => content,
  },
};

const GSPEC_SECTION_MARKER = '<!-- gspec:spec-sync -->';

async function installSpecSync(targetName, cwd) {
  const config = SPEC_SYNC[targetName];
  if (!config) return;

  const templatePath = join(__dirname, '..', 'templates', 'spec-sync.md');
  const template = await readFile(templatePath, 'utf-8');
  const wrapped = config.wrap(template);
  const destPath = join(cwd, config.file);

  if (config.mode === 'append') {
    // For CLAUDE.md / AGENTS.md: append with a marker so we can detect and replace on re-install
    let existing = '';
    try {
      existing = await readFile(destPath, 'utf-8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    const markedContent = `${GSPEC_SECTION_MARKER}\n${wrapped}\n${GSPEC_SECTION_MARKER}`;

    if (existing.includes(GSPEC_SECTION_MARKER)) {
      // Replace existing gspec section
      const updated = existing.replace(
        new RegExp(`${GSPEC_SECTION_MARKER}[\\s\\S]*?${GSPEC_SECTION_MARKER}`),
        markedContent,
      );
      await writeFile(destPath, updated, 'utf-8');
      console.log(`  ${chalk.green('~')} Updated gspec section in ${config.file}`);
    } else if (existing.length > 0) {
      // Append to existing file
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      await writeFile(destPath, existing + separator + markedContent + '\n', 'utf-8');
      console.log(`  ${chalk.green('+')} Appended gspec section to ${config.file}`);
    } else {
      // New file
      await writeFile(destPath, markedContent + '\n', 'utf-8');
      console.log(`  ${chalk.green('+')} Created ${config.file}`);
    }
  } else {
    // For .mdc rule files: create/overwrite the dedicated file
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, wrapped, 'utf-8');
    console.log(`  ${chalk.green('+')} Created ${config.file}`);
  }
}

const MIGRATE_COMMANDS = {
  claude: '/gspec-migrate',
  cursor: '/gspec-migrate',
  antigravity: '/gspec-migrate',
  codex: '/gspec-migrate',
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
  .option('-t, --target <target>', 'target platform (claude, cursor, antigravity, codex)')
  .action(async (opts) => {
    console.log(BANNER);

    let targetName = opts.target;

    if (!targetName) {
      targetName = await promptTarget();
    }

    await install(targetName, process.cwd());

    const skipSync = await promptConfirmNo(chalk.bold('  Enable automatic spec sync? (keeps gspec specs up to date as code changes) [Y/n]: '));
    if (!skipSync) {
      await installSpecSync(targetName, process.cwd());
    }

    await checkGspecFiles(process.cwd(), targetName);
  });

program.parse();
