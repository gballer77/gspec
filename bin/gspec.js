#!/usr/bin/env node

import { program } from 'commander';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
const SPEC_VERSION = 'v1';

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
  opencode: {
    sourceDir: join(DIST_DIR, 'opencode'),
    installDir: '.opencode/skills',
    label: 'Open Code',
    layout: 'directory',
  },
};

const TARGET_CHOICES = [
  { key: '1', name: 'claude', label: 'Claude Code' },
  { key: '2', name: 'cursor', label: 'Cursor' },
  { key: '3', name: 'antigravity', label: 'Antigravity' },
  { key: '4', name: 'codex', label: 'Codex' },
  { key: '5', name: 'opencode', label: 'Open Code' },
];

function promptTarget() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold('\nWhich application are you installing gspec for?\n'));
  for (const choice of TARGET_CHOICES) {
    console.log(`  ${chalk.cyan(choice.key)}) ${choice.label}`);
  }
  console.log();

  return new Promise((resolve) => {
    rl.question(chalk.bold('  Select [1-5]: '), (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();

      // Accept by number
      const byNumber = TARGET_CHOICES.find(c => c.key === trimmed);
      if (byNumber) return resolve(byNumber.name);

      // Accept by name
      const byName = TARGET_CHOICES.find(c => c.name === trimmed || c.label.toLowerCase() === trimmed);
      if (byName) return resolve(byName.name);

      console.error(chalk.red(`\nInvalid selection: "${answer.trim()}"`));
      console.error(`Valid options: 1, 2, 3, 4, 5, claude, cursor, antigravity, codex, opencode`);
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

function promptConfirmYes(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed.startsWith('y'));
    });
  });
}

function formatStarterName(slug) {
  if (slug === '_none') return 'None';
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function promptSelect(message, choices) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.bold(`\n${message}\n`));
  for (let i = 0; i < choices.length; i++) {
    const label = formatStarterName(choices[i].slug);
    const desc = choices[i].description ? ` — ${choices[i].description}` : '';
    console.log(`  ${chalk.cyan(String(i + 1))}) ${label}${desc}`);
  }
  console.log();

  return new Promise((resolve) => {
    rl.question(chalk.bold(`  Select [1-${choices.length}]: `), (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (num >= 1 && num <= choices.length) return resolve(choices[num - 1].slug);
      console.error(chalk.red(`\nInvalid selection: "${answer.trim()}"`));
      process.exit(1);
    });
  });
}

function promptMultiSelect(message, choices) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.bold(`\n${message}\n`));
  for (let i = 0; i < choices.length; i++) {
    const label = formatStarterName(choices[i].slug);
    const desc = choices[i].description ? ` — ${choices[i].description}` : '';
    console.log(`  ${chalk.cyan(String(i + 1))}) ${label}${desc}`);
  }
  console.log();

  return new Promise((resolve) => {
    rl.question(chalk.bold('  Enter numbers (comma-separated), "all", or press Enter to skip: '), (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') return resolve([]);
      if (trimmed === 'all') return resolve(choices.map((c) => c.slug));

      const nums = trimmed.split(',').map((s) => parseInt(s.trim(), 10));
      const invalid = nums.find((n) => isNaN(n) || n < 1 || n > choices.length);
      if (invalid !== undefined) {
        console.error(chalk.red(`\nInvalid selection: "${answer.trim()}"`));
        process.exit(1);
      }
      resolve(nums.map((n) => choices[n - 1].slug));
    });
  });
}

async function seedFromSavedSpecs(cwd) {
  // Skip if gspec specs already exist in the project
  try {
    const existingFiles = await collectGspecFiles(join(cwd, 'gspec'));
    if (existingFiles.length > 0) {
      return;
    }
  } catch {}

  // Check if ~/.gspec/ has any saved specs or playbooks
  const gspecHome = join(homedir(), '.gspec');
  let hasPlaybooks = false;
  let playbooks = [];
  try {
    const pbEntries = await readdir(join(gspecHome, 'playbooks'));
    playbooks = pbEntries.filter((f) => f.endsWith('.md'));
    hasPlaybooks = playbooks.length > 0;
  } catch {}

  let savedTypes = [];
  try {
    const entries = await readdir(gspecHome);
    for (const entry of entries) {
      if (entry === 'playbooks') continue;
      try {
        const info = await stat(join(gspecHome, entry));
        if (info.isDirectory()) {
          const files = await readdir(join(gspecHome, entry));
          if (files.filter((f) => f.endsWith('.md')).length > 0) {
            savedTypes.push(entry);
          }
        }
      } catch {}
    }
  } catch {}

  // Nothing saved — skip silently
  if (!hasPlaybooks && savedTypes.length === 0) return;

  const wantSaved = await promptConfirm(chalk.bold('  Would you like to start from saved specs in ~/.gspec/? [y/N]: '));
  if (!wantSaved) {
    console.log(chalk.dim('\n  Skipped saved specs.\n'));
    return;
  }

  // If playbooks exist, offer them first
  if (hasPlaybooks) {
    const playbookChoices = [];
    for (const f of playbooks) {
      const slug = f.replace(/\.md$/, '');
      const content = await readFile(join(gspecHome, 'playbooks', f), 'utf-8');
      const { fields } = parseFrontmatter(content);
      playbookChoices.push({ slug, description: fields.description || '' });
    }

    const INDIVIDUAL_OPTION = { slug: '_individual', description: 'Pick individual specs instead' };
    const selected = await promptSelect('Select a playbook', [...playbookChoices, INDIVIDUAL_OPTION]);

    if (selected !== '_individual') {
      await restorePlaybook(selected, cwd);
      return;
    }
  }

  // Individual spec selection from ~/.gspec/
  const NONE_OPTION = { slug: '_none', description: 'Skip' };
  const gspecDir = join(cwd, 'gspec');
  const filesToWrite = [];

  // `dest` is null for types whose destination filename depends on the saved file's extension
  // (currently `styles`, which may be .md or .html).
  const CATEGORY_ORDER = [
    { type: 'profiles', label: 'Select a profile', dest: 'profile.md', mode: 'single' },
    { type: 'practices', label: 'Select practices', dest: 'practices.md', mode: 'single' },
    { type: 'stacks', label: 'Select a stack', dest: 'stack.md', mode: 'single' },
    { type: 'styles', label: 'Select a style', dest: null, mode: 'single' },
    { type: 'features', label: 'Select features (optional)', dest: null, mode: 'multi' },
  ];

  for (const cat of CATEGORY_ORDER) {
    if (!savedTypes.includes(cat.type)) continue;

    const specs = await listSavedSpecs(cat.type);
    if (specs.length === 0) continue;

    if (cat.mode === 'single') {
      const selected = specs.length === 1
        ? (console.log(chalk.dim(`\n  Using ${cat.type}: ${formatStarterName(specs[0].slug)}`)), specs[0].slug)
        : await promptSelect(cat.label, [...specs, NONE_OPTION]);

      if (selected !== '_none') {
        const savedFilename = await resolveSavedSpecFilename(cat.type, selected);
        if (!savedFilename) continue;
        const destFilename = cat.dest || destFilenameForRestoredSpec(cat.type, savedFilename);
        filesToWrite.push({
          src: join(gspecHome, cat.type, savedFilename),
          dest: join(gspecDir, destFilename),
          label: `gspec/${destFilename}`,
        });
      }
    } else {
      let selectedSlugs = await promptMultiSelect(cat.label, specs);
      for (const slug of selectedSlugs) {
        const savedFilename = await resolveSavedSpecFilename(cat.type, slug);
        if (!savedFilename) continue;
        filesToWrite.push({
          src: join(gspecHome, cat.type, savedFilename),
          dest: join(gspecDir, 'features', savedFilename),
          label: `gspec/features/${savedFilename}`,
        });
      }
    }
  }

  if (filesToWrite.length === 0) {
    console.log(chalk.dim('\n  No specs selected. You can define specs using gspec commands.\n'));
    return;
  }

  // Check for existing files
  const existingFiles = [];
  for (const f of filesToWrite) {
    try {
      await stat(f.dest);
      existingFiles.push(f.label);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  if (existingFiles.length > 0) {
    console.log(chalk.yellow(`\n  The following files already exist and will be overwritten:\n`));
    for (const label of existingFiles) {
      console.log(`    ${chalk.yellow('!')} ${label}`);
    }
    console.log();
    const confirmed = await promptConfirm(chalk.bold('  Continue and overwrite? [y/N]: '));
    if (!confirmed) {
      console.log(chalk.dim('\n  Skipped saved specs.\n'));
      return;
    }
  }

  // Copy files
  console.log(chalk.bold('\n  Restoring saved specs...\n'));
  const outdated = [];
  for (const f of filesToWrite) {
    await mkdir(dirname(f.dest), { recursive: true });
    const content = await readFile(f.src, 'utf-8');
    await writeFile(f.dest, content, 'utf-8');
    console.log(`  ${chalk.green('+')} ${f.label}`);

    const version = parseSpecVersion(content);
    if (version && version !== SPEC_VERSION) {
      outdated.push({ label: f.label, version });
    }
  }

  console.log(chalk.green(`\n  ✓ Restored ${filesToWrite.length} spec${filesToWrite.length === 1 ? '' : 's'} into gspec/\n`));

  if (outdated.length > 0) {
    console.log(chalk.yellow('  ⚠ The following restored specs are outdated:\n'));
    for (const o of outdated) {
      console.log(`    ${chalk.yellow('!')} ${o.label} — version ${o.version} (current: ${SPEC_VERSION})`);
    }
    console.log();
    console.log(chalk.yellow(`  Run ${chalk.bold('/gspec-migrate')} to update them to the current format.\n`));
  }
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
  opencode: {
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
  opencode: '/gspec-migrate',
};

function parseSpecVersion(content) {
  // HTML spec files store the version as a first-line comment:
  //   <!-- spec-version: v1 -->
  const htmlMatch = content.match(/^\s*<!--\s*spec-version:\s*([^\s-][^-]*?)\s*-->/);
  if (htmlMatch) return htmlMatch[1].trim();

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const newMatch = match[1].match(/^spec-version:\s*(.+)$/m);
  if (newMatch) return newMatch[1].trim();
  const oldMatch = match[1].match(/^gspec-version:\s*(.+)$/m);
  if (oldMatch) return oldMatch[1].trim();
  return null;
}

async function collectGspecFiles(gspecDir) {
  const files = [];

  const topEntries = await readdir(gspecDir);
  for (const entry of topEntries) {
    if (entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md') {
      files.push({ path: join(gspecDir, entry), label: `gspec/${entry}` });
    }
    // Pick up style.html (the HTML-format style guide) alongside Markdown specs.
    // Other .html files under gspec/ are not gspec-owned and are skipped.
    if (entry === 'style.html') {
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
    const version = parseSpecVersion(content);
    if (version === SPEC_VERSION) continue;
    outdated.push({
      label: file.label,
      version,
    });
  }

  if (outdated.length === 0) return;

  console.log(chalk.yellow(`  Found existing gspec files that may need updating:\n`));
  for (const file of outdated) {
    const status = file.version
      ? `version ${file.version} (current: ${SPEC_VERSION})`
      : `no version (pre-${SPEC_VERSION})`;
    console.log(`    ${chalk.yellow('!')} ${file.label} — ${status}`);
  }
  console.log();

  const confirmed = await promptConfirm(chalk.bold('  Update existing gspec files to the current format? [y/N]: '));
  if (!confirmed) return;

  const cmd = MIGRATE_COMMANDS[targetName] || '/gspec-migrate';
  console.log(chalk.bold(`\n  To update your files, run the following command in ${TARGETS[targetName].label}:\n`));
  console.log(`    ${chalk.cyan(cmd)}\n`);
}

// --- Save / Restore ---

const GSPEC_HOME = join(homedir(), '.gspec');

// Map gspec/ file paths to save/restore type folders
const GSPEC_TYPE_MAP = {
  'profile.md': 'profiles',
  'stack.md': 'stacks',
  'style.md': 'styles',
  'style.html': 'styles',
  'practices.md': 'practices',
};

// Reverse: restore type folder → gspec/ destination filename
// The `styles` entry is a function because the destination depends on the saved file's extension.
const RESTORE_DEST_MAP = {
  profiles: 'profile.md',
  stacks: 'stack.md',
  styles: 'style.md', // default when the saved extension is .md
  practices: 'practices.md',
  features: null, // features keep their own filename
};

// Given a save-type folder and a saved slug, resolve the actual filename in ~/.gspec/<type>/.
// Styles can be stored as .md or .html; all others are .md.
async function resolveSavedSpecFilename(type, slug) {
  const dir = join(GSPEC_HOME, type);
  const candidates = type === 'styles'
    ? [`${slug}.md`, `${slug}.html`]
    : [`${slug}.md`];
  for (const candidate of candidates) {
    try {
      await stat(join(dir, candidate));
      return candidate;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return null;
}

// Destination filename in a project's gspec/ directory for a restored saved spec.
// For styles, preserve the saved file's extension so a .html style guide restores as style.html.
function destFilenameForRestoredSpec(type, savedFilename) {
  if (type === 'features') return savedFilename;
  if (type === 'styles') {
    return savedFilename.endsWith('.html') ? 'style.html' : 'style.md';
  }
  return RESTORE_DEST_MAP[type];
}

function isHtmlSpec(content) {
  const head = content.slice(0, 500).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return true;
  // Leading HTML comments before <!DOCTYPE> (where we store HTML spec metadata)
  if (head.startsWith('<!--')) {
    // Peek further to see if a <!DOCTYPE> / <html> follows the comments
    const scan = content.slice(0, 2000).toLowerCase();
    return /<!doctype|<html/.test(scan);
  }
  return false;
}

function parseHtmlMetadata(content) {
  // Consume consecutive `<!-- key: value -->` comments at the top of the file,
  // stopping at the first non-comment, non-blank line.
  const fields = {};
  const lines = content.split('\n');
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') {
      bodyStart = i + 1;
      continue;
    }
    const match = trimmed.match(/^<!--\s*([\w-]+):\s*(.+?)\s*-->$/);
    if (!match) break;
    fields[match[1]] = match[2];
    bodyStart = i + 1;
  }
  return { fields, body: lines.slice(bodyStart).join('\n') };
}

function parseFrontmatter(content) {
  if (isHtmlSpec(content)) return parseHtmlMetadata(content);
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { fields: {}, body: content };
  const fields = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { fields, body: content.slice(match[0].length) };
}

function setHtmlMetadataField(content, key, value) {
  const lines = content.split('\n');
  let lastCommentIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
      lastCommentIndex = i;
      const m = trimmed.match(/^<!--\s*([\w-]+):\s*(.+?)\s*-->$/);
      if (m && m[1] === key) {
        lines[i] = `<!-- ${key}: ${value} -->`;
        return lines.join('\n');
      }
      continue;
    }
    break;
  }
  const newComment = `<!-- ${key}: ${value} -->`;
  if (lastCommentIndex >= 0) {
    lines.splice(lastCommentIndex + 1, 0, newComment);
  } else {
    lines.unshift(newComment);
  }
  return lines.join('\n');
}

function setFrontmatterField(content, key, value) {
  if (isHtmlSpec(content)) return setHtmlMetadataField(content, key, value);
  const match = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
  if (!match) {
    // No frontmatter — create one
    return `---\n${key}: ${value}\n---\n${content}`;
  }
  const lines = match[2].split('\n');
  const existing = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (existing >= 0) {
    lines[existing] = `${key}: ${value}`;
  } else {
    // Insert name as first field
    lines.unshift(`${key}: ${value}`);
  }
  return `${match[1]}${lines.join('\n')}${match[3]}${content.slice(match[0].length)}`;
}

function promptInput(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function collectSavableFiles(cwd) {
  const gspecDir = join(cwd, 'gspec');
  const files = [];

  try {
    await stat(gspecDir);
  } catch (e) {
    if (e.code === 'ENOENT') return files;
    throw e;
  }

  // Top-level spec files. Accept the Markdown specs plus the HTML style guide.
  const topEntries = await readdir(gspecDir);
  for (const entry of topEntries) {
    if (entry.toLowerCase() === 'readme.md') continue;
    if (!entry.endsWith('.md') && entry !== 'style.html') continue;
    const type = GSPEC_TYPE_MAP[entry];
    if (!type) continue;
    files.push({
      path: join(gspecDir, entry),
      type,
      label: `gspec/${entry}`,
    });
  }

  // Feature files
  try {
    const featureEntries = await readdir(join(gspecDir, 'features'));
    for (const entry of featureEntries) {
      if (!entry.endsWith('.md')) continue;
      files.push({
        path: join(gspecDir, 'features', entry),
        type: 'features',
        label: `gspec/features/${entry}`,
      });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  return files;
}

async function saveSpec(cwd) {
  console.log(BANNER);

  const files = await collectSavableFiles(cwd);
  if (files.length === 0) {
    console.error(chalk.red('\n  No gspec files found in gspec/ directory.\n'));
    process.exit(1);
  }

  // Let user select which file to save
  console.log(chalk.bold('\n  Which spec would you like to save?\n'));
  for (let i = 0; i < files.length; i++) {
    const content = await readFile(files[i].path, 'utf-8');
    const { fields } = parseFrontmatter(content);
    const desc = fields.description ? ` — ${fields.description}` : '';
    console.log(`  ${chalk.cyan(String(i + 1))}) ${files[i].label}${chalk.dim(desc)}`);
  }
  console.log();

  const answer = await promptInput(chalk.bold(`  Select [1-${files.length}]: `));
  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 1 || num > files.length) {
    console.error(chalk.red(`\n  Invalid selection: "${answer}"`));
    process.exit(1);
  }

  const selected = files[num - 1];
  // Preserve the source file's extension when saving (.md for most specs, .html for style.html).
  const ext = selected.path.endsWith('.html') ? '.html' : '.md';

  // Read source content and look for an existing name in frontmatter
  let content = await readFile(selected.path, 'utf-8');
  const { fields: sourceFields } = parseFrontmatter(content);
  const existingName = sourceFields.name;

  let name;
  let overwriteConfirmed = false;

  if (existingName) {
    const existingPath = join(GSPEC_HOME, selected.type, `${existingName}${ext}`);
    let savedExists = false;
    try {
      await stat(existingPath);
      savedExists = true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    if (savedExists) {
      const overwrite = await promptConfirmYes(
        chalk.bold(`\n  Overwrite existing ~/.gspec/${selected.type}/${existingName}${ext}? [Y/n]: `)
      );
      if (overwrite) {
        name = existingName;
        overwriteConfirmed = true;
      }
    } else {
      name = existingName;
    }
  }

  if (!name) {
    const answered = await promptInput(chalk.bold('\n  Save name (no spaces, e.g. my-saas-stack): '));
    if (!answered) {
      console.error(chalk.red('\n  Name is required.'));
      process.exit(1);
    }
    if (/\s/.test(answered)) {
      console.error(chalk.red('\n  Name cannot contain spaces. Use hyphens instead (e.g. my-saas-stack).'));
      process.exit(1);
    }
    name = answered;
  }

  content = setFrontmatterField(content, 'name', name);

  // Ensure description exists
  const { fields } = parseFrontmatter(content);
  if (!fields.description) {
    const desc = await promptInput(chalk.bold('  Description (short summary): '));
    if (desc) {
      content = setFrontmatterField(content, 'description', desc);
    }
  }

  // Write to ~/.gspec/{type}/{name}{ext}
  const destDir = join(GSPEC_HOME, selected.type);
  const destPath = join(destDir, `${name}${ext}`);
  await mkdir(destDir, { recursive: true });

  // Check for conflict unless overwrite was already confirmed above
  if (!overwriteConfirmed) {
    try {
      await stat(destPath);
      const overwrite = await promptConfirm(chalk.yellow(`\n  ${selected.type}/${name}${ext} already exists. Overwrite? [y/N]: `));
      if (!overwrite) {
        console.log(chalk.dim('\n  Save cancelled.\n'));
        return;
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  // Uncheck all implementation checkboxes so saved specs start fresh
  content = content.replace(/- \[x\]/g, '- [ ]');

  await writeFile(destPath, content, 'utf-8');
  console.log(chalk.green(`\n  ✓ Saved to ~/.gspec/${selected.type}/${name}${ext}\n`));
}

function isSavedSpecFile(type, filename) {
  if (filename.endsWith('.md')) return true;
  if (type === 'styles' && filename.endsWith('.html')) return true;
  return false;
}

async function listSavedTypes() {
  const types = [];
  try {
    const entries = await readdir(GSPEC_HOME);
    for (const entry of entries) {
      try {
        const info = await stat(join(GSPEC_HOME, entry));
        if (info.isDirectory()) {
          const files = await readdir(join(GSPEC_HOME, entry));
          if (files.some((f) => isSavedSpecFile(entry, f))) types.push(entry);
        }
      } catch { /* skip */ }
    }
  } catch (e) {
    if (e.code === 'ENOENT') return types;
    throw e;
  }
  return types;
}

async function listSavedSpecs(type) {
  const dir = join(GSPEC_HOME, type);
  const entries = await readdir(dir);
  const specs = [];
  for (const entry of entries) {
    if (!isSavedSpecFile(type, entry)) continue;
    const content = await readFile(join(dir, entry), 'utf-8');
    const { fields } = parseFrontmatter(content);
    specs.push({
      slug: entry.replace(/\.(md|html)$/, ''),
      description: fields.description || '',
    });
  }
  return specs;
}

async function restoreSpec(specPath, cwd) {
  console.log(BANNER);

  if (specPath) {
    // Direct restore: e.g. "stacks/web", "features/auth-flow", or "playbook/my-starter"
    const parts = specPath.split('/');
    if (parts.length !== 2) {
      console.error(chalk.red(`\n  Invalid format. Use: type/name (e.g. stacks/my-stack, playbook/my-starter)\n`));
      process.exit(1);
    }
    const [type, name] = parts;
    if (type === 'playbook' || type === 'playbooks') {
      await restorePlaybook(name, cwd);
    } else {
      await restoreFile(type, name, cwd);
    }
    return;
  }

  // Interactive: pick type, then file
  const types = await listSavedTypes();
  if (types.length === 0) {
    console.error(chalk.red('\n  No saved specs found in ~/.gspec/'));
    console.error(chalk.dim('  Use "gspec save" to save specs first.\n'));
    process.exit(1);
  }

  console.log(chalk.bold('\n  Select a spec type:\n'));
  for (let i = 0; i < types.length; i++) {
    console.log(`  ${chalk.cyan(String(i + 1))}) ${types[i]}`);
  }
  console.log();

  const typeAnswer = await promptInput(chalk.bold(`  Select [1-${types.length}]: `));
  const typeNum = parseInt(typeAnswer, 10);
  if (isNaN(typeNum) || typeNum < 1 || typeNum > types.length) {
    console.error(chalk.red(`\n  Invalid selection: "${typeAnswer}"`));
    process.exit(1);
  }

  const selectedType = types[typeNum - 1];
  const specs = await listSavedSpecs(selectedType);

  if (specs.length === 0) {
    console.error(chalk.red(`\n  No specs found in ~/.gspec/${selectedType}/\n`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n  Select a spec from ${selectedType}:\n`));
  for (let i = 0; i < specs.length; i++) {
    const desc = specs[i].description ? ` — ${specs[i].description}` : '';
    console.log(`  ${chalk.cyan(String(i + 1))}) ${specs[i].slug}${chalk.dim(desc)}`);
  }
  console.log();

  const specAnswer = await promptInput(chalk.bold(`  Select [1-${specs.length}]: `));
  const specNum = parseInt(specAnswer, 10);
  if (isNaN(specNum) || specNum < 1 || specNum > specs.length) {
    console.error(chalk.red(`\n  Invalid selection: "${specAnswer}"`));
    process.exit(1);
  }

  await restoreFile(selectedType, specs[specNum - 1].slug, cwd);
}

async function restoreFile(type, name, cwd) {
  const savedFilename = await resolveSavedSpecFilename(type, name);
  if (!savedFilename) {
    console.error(chalk.red(`\n  Not found: ~/.gspec/${type}/${name}.md\n`));
    process.exit(1);
  }
  const srcPath = join(GSPEC_HOME, type, savedFilename);

  const gspecDir = join(cwd, 'gspec');
  let destPath;

  if (type === 'features') {
    destPath = join(gspecDir, 'features', savedFilename);
  } else {
    const destFile = destFilenameForRestoredSpec(type, savedFilename);
    if (!destFile) {
      console.error(chalk.red(`\n  Unknown spec type: ${type}\n`));
      process.exit(1);
    }
    destPath = join(gspecDir, destFile);
  }

  // Check for existing file
  try {
    await stat(destPath);
    const relPath = destPath.slice(cwd.length + 1);
    const overwrite = await promptConfirm(chalk.yellow(`\n  ${relPath} already exists. Overwrite? [y/N]: `));
    if (!overwrite) {
      console.log(chalk.dim('\n  Restore cancelled.\n'));
      return;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  await mkdir(dirname(destPath), { recursive: true });
  const content = await readFile(srcPath, 'utf-8');
  await writeFile(destPath, content, 'utf-8');

  const relDest = destPath.slice(cwd.length + 1);
  console.log(chalk.green(`\n  ✓ Restored ${type}/${name} → ${relDest}\n`));

  const version = parseSpecVersion(content);
  if (version && version !== SPEC_VERSION) {
    console.log(chalk.yellow(`  ⚠ ${relDest} is version ${version} (current: ${SPEC_VERSION})`));
    console.log(chalk.yellow(`    Run ${chalk.bold('/gspec-migrate')} to update it to the current format.\n`));
  }
}

// --- Playbooks ---

async function listSavedSpecsSafe(type) {
  try {
    return await listSavedSpecs(type);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function createPlaybook() {
  console.log(BANNER);
  console.log(chalk.bold('\n  Create a playbook\n'));
  console.log(chalk.dim('  A playbook bundles saved specs so you can restore them all at once.\n'));

  const NONE_OPTION = { slug: '_none', description: 'Skip' };

  // --- Profile (0 or 1) ---
  const profiles = await listSavedSpecsSafe('profiles');
  let profile = null;
  if (profiles.length > 0) {
    profile = await promptSelect('Select a profile (or skip)', [...profiles, NONE_OPTION]);
    if (profile === '_none') profile = null;
  } else {
    console.log(chalk.dim('  No saved profiles found — skipping.\n'));
  }

  // --- Stack (0 or 1) ---
  const stacks = await listSavedSpecsSafe('stacks');
  let stack = null;
  if (stacks.length > 0) {
    stack = await promptSelect('Select a stack (or skip)', [...stacks, NONE_OPTION]);
    if (stack === '_none') stack = null;
  } else {
    console.log(chalk.dim('  No saved stacks found — skipping.\n'));
  }

  // --- Practices (0 or 1) ---
  const practices = await listSavedSpecsSafe('practices');
  let practice = null;
  if (practices.length > 0) {
    practice = await promptSelect('Select practices (or skip)', [...practices, NONE_OPTION]);
    if (practice === '_none') practice = null;
  } else {
    console.log(chalk.dim('  No saved practices found — skipping.\n'));
  }

  // --- Style (0 or 1) ---
  const styles = await listSavedSpecsSafe('styles');
  let style = null;
  if (styles.length > 0) {
    style = await promptSelect('Select a style (or skip)', [...styles, NONE_OPTION]);
    if (style === '_none') style = null;
  } else {
    console.log(chalk.dim('  No saved styles found — skipping.\n'));
  }

  // --- Features (0 to many) ---
  const features = await listSavedSpecsSafe('features');
  let selectedFeatures = [];
  if (features.length > 0) {
    selectedFeatures = await promptMultiSelect('Select features (optional)', features);
  } else {
    console.log(chalk.dim('  No saved features found — skipping.\n'));
  }

  // Check that at least one spec was selected
  if (!profile && !stack && !practice && !style && selectedFeatures.length === 0) {
    console.error(chalk.red('\n  No specs selected. Playbook not created.\n'));
    process.exit(1);
  }

  // Prompt for playbook name
  const name = await promptInput(chalk.bold('\n  Playbook name (no spaces, e.g. my-saas-starter): '));
  if (!name) {
    console.error(chalk.red('\n  Name is required.'));
    process.exit(1);
  }
  if (/\s/.test(name)) {
    console.error(chalk.red('\n  Name cannot contain spaces. Use hyphens instead (e.g. my-saas-starter).'));
    process.exit(1);
  }

  // Prompt for description
  const description = await promptInput(chalk.bold('  Description (short summary): '));

  // Build playbook content
  const lines = ['---'];
  lines.push(`name: ${name}`);
  if (description) lines.push(`description: ${description}`);
  lines.push('---', '');
  if (profile) lines.push(`profile: ${profile}`);
  if (stack) lines.push(`stack: ${stack}`);
  if (practice) lines.push(`practices: ${practice}`);
  if (style) lines.push(`style: ${style}`);
  if (selectedFeatures.length > 0) {
    lines.push('features:');
    for (const f of selectedFeatures) {
      lines.push(`  - ${f}`);
    }
  }
  lines.push('');

  // Write playbook
  const destDir = join(GSPEC_HOME, 'playbooks');
  const destPath = join(destDir, `${name}.md`);
  await mkdir(destDir, { recursive: true });

  try {
    await stat(destPath);
    const overwrite = await promptConfirm(chalk.yellow(`\n  Playbook "${name}" already exists. Overwrite? [y/N]: `));
    if (!overwrite) {
      console.log(chalk.dim('\n  Cancelled.\n'));
      return;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  await writeFile(destPath, lines.join('\n'), 'utf-8');

  // Summary
  console.log(chalk.green(`\n  ✓ Playbook saved to ~/.gspec/playbooks/${name}.md\n`));
  console.log(chalk.bold('  Contents:'));
  if (profile) console.log(`    Profile:   ${formatStarterName(profile)}`);
  if (stack) console.log(`    Stack:     ${formatStarterName(stack)}`);
  if (practice) console.log(`    Practices: ${formatStarterName(practice)}`);
  if (style) console.log(`    Style:     ${formatStarterName(style)}`);
  if (selectedFeatures.length > 0) {
    console.log(`    Features:  ${selectedFeatures.map(formatStarterName).join(', ')}`);
  }
  console.log();
  console.log(chalk.dim(`  Restore with: gspec restore playbook/${name}\n`));
}

function parsePlaybook(content) {
  const { fields } = parseFrontmatter(content);
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
  const result = { name: fields.name || '', description: fields.description || '' };

  for (const line of body.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (key !== 'features') result[key] = value.trim();
    }
  }

  // Parse features list
  const featuresMatch = body.match(/^features:\s*\n((?:\s+-\s+.+\n?)+)/m);
  if (featuresMatch) {
    result.features = featuresMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s+-\s+/, '').trim())
      .filter(Boolean);
  } else {
    result.features = [];
  }

  return result;
}

async function restorePlaybook(name, cwd) {
  const srcPath = join(GSPEC_HOME, 'playbooks', `${name}.md`);

  try {
    await stat(srcPath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(chalk.red(`\n  Not found: ~/.gspec/playbooks/${name}.md\n`));
      process.exit(1);
    }
    throw e;
  }

  const content = await readFile(srcPath, 'utf-8');
  const playbook = parsePlaybook(content);

  console.log(chalk.bold(`\n  Restoring playbook: ${playbook.name || name}\n`));
  if (playbook.description) console.log(chalk.dim(`  ${playbook.description}\n`));

  const gspecDir = join(cwd, 'gspec');
  await mkdir(gspecDir, { recursive: true });

  const restorations = [];
  if (playbook.profile) restorations.push({ type: 'profiles', slug: playbook.profile });
  if (playbook.stack) restorations.push({ type: 'stacks', slug: playbook.stack });
  if (playbook.practices) restorations.push({ type: 'practices', slug: playbook.practices });
  if (playbook.style) restorations.push({ type: 'styles', slug: playbook.style });
  for (const f of playbook.features) {
    restorations.push({ type: 'features', slug: f });
  }

  // Resolve each restoration to its actual saved filename (styles may be .md or .html)
  for (const r of restorations) {
    r.savedFilename = await resolveSavedSpecFilename(r.type, r.slug);
  }

  // Check for existing files
  const existing = [];
  for (const r of restorations) {
    if (!r.savedFilename) continue;
    const destFile = r.type === 'features'
      ? join('features', r.savedFilename)
      : destFilenameForRestoredSpec(r.type, r.savedFilename);
    const destPath = join(gspecDir, destFile);
    try {
      await stat(destPath);
      existing.push(`gspec/${destFile}`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  if (existing.length > 0) {
    console.log(chalk.yellow('  The following files already exist and will be overwritten:\n'));
    for (const label of existing) {
      console.log(`    ${chalk.yellow('!')} ${label}`);
    }
    console.log();
    const confirmed = await promptConfirm(chalk.bold('  Continue and overwrite? [y/N]: '));
    if (!confirmed) {
      console.log(chalk.dim('\n  Restore cancelled.\n'));
      return;
    }
  }

  // Restore all specs
  const outdated = [];
  for (const r of restorations) {
    if (!r.savedFilename) {
      console.log(`  ${chalk.yellow('!')} Skipped ${r.type}/${r.slug} — not found in ~/.gspec/`);
      continue;
    }
    const srcFile = join(GSPEC_HOME, r.type, r.savedFilename);

    const destFile = r.type === 'features'
      ? join('features', r.savedFilename)
      : destFilenameForRestoredSpec(r.type, r.savedFilename);
    const destPath = join(gspecDir, destFile);
    await mkdir(dirname(destPath), { recursive: true });
    const specContent = await readFile(srcFile, 'utf-8');
    await writeFile(destPath, specContent, 'utf-8');
    console.log(`  ${chalk.green('+')} gspec/${destFile}`);

    const version = parseSpecVersion(specContent);
    if (version && version !== SPEC_VERSION) {
      outdated.push({ label: `gspec/${destFile}`, version });
    }
  }

  console.log(chalk.green(`\n  ✓ Playbook "${playbook.name || name}" restored.\n`));

  if (outdated.length > 0) {
    console.log(chalk.yellow('  ⚠ The following restored specs are outdated:\n'));
    for (const o of outdated) {
      console.log(`    ${chalk.yellow('!')} ${o.label} — version ${o.version} (current: ${SPEC_VERSION})`);
    }
    console.log();
    console.log(chalk.yellow(`  Run ${chalk.bold('/gspec-migrate')} to update them to the current format.\n`));
  }
}

program
  .name('gspec')
  .description('Install gspec specification commands')
  .version(pkg.version)
  .option('-t, --target <target>', 'target platform (claude, cursor, antigravity, codex, opencode)')
  .action(async (opts) => {
    console.log(BANNER);

    let targetName = opts.target;

    if (!targetName) {
      targetName = await promptTarget();
    }

    await install(targetName, process.cwd());

    await seedFromSavedSpecs(process.cwd());

    await installSpecSync(targetName, process.cwd());

    await checkGspecFiles(process.cwd(), targetName);

    // Post-install: instruct user to generate profile.md (only if it doesn't already exist)
    const profilePath = join(process.cwd(), 'gspec', 'profile.md');
    let profileExists = false;
    try { await stat(profilePath); profileExists = true; } catch {}

    const targetLabel = TARGETS[targetName].label;
    if (!profileExists) {
      console.log();
      console.log(chalk.bold.cyan('  ═══ Next Step ═══════════════════════════════════════════════'));
      console.log();
      console.log(chalk.bold.white('  Generate your product profile before continuing.'));
      console.log();
      console.log(`  Run ${chalk.bold.yellow('/gspec-profile')} in ${targetLabel} to create gspec/profile.md`);
      console.log(`  — it defines what your product is, who it serves, and why it`);
      console.log(`  exists. All other gspec commands use the profile as their foundation.`);
      console.log();
      console.log(chalk.bold.cyan('  ═════════════════════════════════════════════════════════════'));
      console.log();
    }
  });

program
  .command('save')
  .description('Save a gspec spec to ~/.gspec for reuse across projects')
  .action(async () => {
    await saveSpec(process.cwd());
  });

program
  .command('restore')
  .description('Restore a saved spec from ~/.gspec into the current project')
  .argument('[spec]', 'spec to restore (e.g. stacks/my-stack, playbook/my-starter)')
  .action(async (spec) => {
    await restoreSpec(spec, process.cwd());
  });

program
  .command('playbook')
  .description('Create a playbook that bundles saved specs for quick project setup')
  .action(async () => {
    await createPlaybook();
  });

program.parse();
