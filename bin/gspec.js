#!/usr/bin/env node

import { program } from 'commander';
import { readdir, readFile, writeFile, mkdir, stat, unlink, rm, rename } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { promptSelect, promptMultiSelect, promptConfirm, promptInput } from '../lib/prompts.js';
import { TARGETS as EMITTER_TARGETS } from '../lib/emitters.js';
import { runBuild, reportBuildStatus, EXIT } from '../lib/build.js';
import {
  writeProjectConfig, PROJECT_CONFIG_PATH, readProjectConfig, readGlobalConfig,
  recommendedModels, hasModelsConfigured,
} from '../lib/config.js';
import { SPEC_VERSION } from '../lib/spec-version.js';

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
  ${chalk.dim(`v${pkg.version}`)}
`;

// Derive install-side TARGETS from the shared emitter config so we have one source of truth.
// `sourceDir` is computed from the shared `distSubdir`; `emit` is reused for installing user extensions.
const TARGETS = Object.fromEntries(
  Object.entries(EMITTER_TARGETS).map(([key, t]) => [key, {
    ...t,
    sourceDir: join(DIST_DIR, t.distSubdir),
  }]),
);

// The v1 command-skill names. v2 no longer emits these as skills, so on upgrade
// their leftover dirs are cleaned up (cleanupStaleV1Skills). This is NOT the
// extension-collision surface — that is the CURRENT build's skills, read live
// from dist/ via reservedSkillNames().
const LEGACY_V1_SKILL_NAMES = new Set([
  'gspec-profile', 'gspec-feature', 'gspec-plan', 'gspec-style',
  'gspec-stack', 'gspec-practices', 'gspec-architect', 'gspec-analyze',
  'gspec-audit', 'gspec-research', 'gspec-implement', 'gspec-migrate',
  // gspec-tasks was v1's planner. Leaving it behind is worse than an unused
  // dir: its trigger description still points at the flat gspec/features/
  // <slug>.tasks.md path, so it can write v1 layout back into a migrated repo.
  'gspec-tasks',
]);

const TARGET_CHOICES = [
  { name: 'claude', label: 'Claude Code' },
  { name: 'cursor', label: 'Cursor' },
  { name: 'antigravity', label: 'Antigravity' },
  { name: 'codex', label: 'Codex' },
  { name: 'opencode', label: 'Open Code' },
  { name: 'pi', label: 'Pi' },
];

function promptTarget() {
  return promptSelect(
    'Which application are you installing gspec for?',
    TARGET_CHOICES.map((c) => ({ value: c.name, label: c.label })),
  );
}

function formatStarterName(slug) {
  if (slug === '_none') return 'None';
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Saved-spec choices come as { slug, description }; render them for the prompt layer.
function specOptions(choices) {
  return choices.map((c) => ({
    value: c.slug,
    label: formatStarterName(c.slug),
    hint: c.description || undefined,
  }));
}

function promptSpecSelect(message, choices) {
  return promptSelect(message, specOptions(choices));
}

function promptSpecMultiSelect(message, choices) {
  return promptMultiSelect(message, specOptions(choices));
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

  const wantSaved = await promptConfirm('Would you like to start from saved specs in ~/.gspec/?');
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
    const selected = await promptSpecSelect('Select a playbook', [...playbookChoices, INDIVIDUAL_OPTION]);

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
        : await promptSpecSelect(cat.label, [...specs, NONE_OPTION]);

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
      let selectedSlugs = await promptSpecMultiSelect(cat.label, specs);
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
    const confirmed = await promptConfirm('Continue and overwrite?');
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

  // Multi-dir native layouts (opencode/codex/cursor/antigravity/pi) write agent/
  // command/skill/workflow subdirs — skip the overwrite pre-check; install
  // overwrites in place.
  if (['opencode', 'codex', 'cursor', 'antigravity', 'pi'].includes(target.layout)) return existing;

  if (target.layout === 'flat') {
    const srcEntries = await readdir(target.sourceDir);
    for (const file of srcEntries.filter(f => f.endsWith(target.fileExt))) {
      try {
        await stat(join(destBase, file));
        existing.push(file);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  } else if (target.layout === 'dual') {
    const commandsSubdir = target.commandsSubdir;
    const commandFiles = await readdir(join(target.sourceDir, commandsSubdir));
    for (const file of commandFiles.filter(f => f.endsWith(target.fileExt))) {
      try {
        await stat(join(destBase, commandsSubdir, file));
        existing.push(`${commandsSubdir}/${file}`);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    const skillEntries = await readdir(join(target.sourceDir, 'skills'));
    for (const entry of skillEntries) {
      const info = await stat(join(target.sourceDir, 'skills', entry));
      if (!info.isDirectory()) continue;
      try {
        await stat(join(destBase, 'skills', entry, 'SKILL.md'));
        existing.push(`skills/${entry}/SKILL.md`);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  } else {
    const srcEntries = await readdir(target.sourceDir);
    for (const entry of srcEntries) {
      const info = await stat(join(target.sourceDir, entry));
      if (!info.isDirectory()) continue;
      if (entry === 'agents' || entry === 'commands') continue; // v2 sibling classes, not skills
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
  const skillsInstallDir = join(cwd, target.installDir); // e.g. .claude/skills
  const baseDir = dirname(skillsInstallDir);             // e.g. .claude

  const skills = [];
  for (const entry of entries) {
    const info = await stat(join(target.sourceDir, entry));
    if (!info.isDirectory()) continue;
    if (entry === 'agents' || entry === 'commands') continue; // v2 sibling classes, handled below
    skills.push(entry);
  }

  for (const skill of skills) {
    const srcPath = join(target.sourceDir, skill, 'SKILL.md');
    const destDir = join(skillsInstallDir, skill);
    await mkdir(destDir, { recursive: true });
    const content = await readFile(srcPath, 'utf-8');
    await writeFile(join(destDir, 'SKILL.md'), content, 'utf-8');
    console.log(`  ${chalk.green('+')} ${skill}`);
  }

  // v2 emits agents/ and commands/ as sibling classes under the tool's base dir
  // (e.g. .claude/agents, .claude/commands). Present only for targets that build
  // them (currently Claude); a no-op elsewhere.
  let extra = 0;
  for (const cls of ['agents', 'commands']) {
    const clsSrc = join(target.sourceDir, cls);
    let files;
    try {
      files = (await readdir(clsSrc)).filter((f) => f.endsWith('.md'));
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const clsDest = join(baseDir, cls);
    await mkdir(clsDest, { recursive: true });
    for (const file of files) {
      const content = await readFile(join(clsSrc, file), 'utf-8');
      await writeFile(join(clsDest, file), content, 'utf-8');
      console.log(`  ${chalk.green('+')} ${cls}/${file.replace(/\.md$/, '')}`);
      extra++;
    }
  }

  return skills.length + extra;
}

async function installDual(target, cwd) {
  const commandsSubdir = target.commandsSubdir;
  const commandsSrc = join(target.sourceDir, commandsSubdir);
  const commandsDest = join(cwd, target.installDir, commandsSubdir);
  await mkdir(commandsDest, { recursive: true });
  const commandFiles = (await readdir(commandsSrc)).filter(f => f.endsWith(target.fileExt));
  for (const file of commandFiles) {
    const content = await readFile(join(commandsSrc, file), 'utf-8');
    await writeFile(join(commandsDest, file), content, 'utf-8');
  }

  const skillsSrc = join(target.sourceDir, 'skills');
  const entries = await readdir(skillsSrc);
  const skills = [];
  for (const entry of entries) {
    const info = await stat(join(skillsSrc, entry));
    if (info.isDirectory()) skills.push(entry);
  }
  for (const skill of skills) {
    const destDir = join(cwd, target.installDir, 'skills', skill);
    await mkdir(destDir, { recursive: true });
    const content = await readFile(join(skillsSrc, skill, 'SKILL.md'), 'utf-8');
    await writeFile(join(destDir, 'SKILL.md'), content, 'utf-8');
    console.log(`  ${chalk.green('+')} ${skill} ${chalk.dim('(command + skill)')}`);
  }

  return skills.length;
}

// OpenCode native layout: skills/<name>/SKILL.md + agent/<name>.md + command/<name>.md
async function installOpenCode(target, cwd) {
  const base = join(cwd, target.installDir); // .opencode
  let count = 0;

  const skillsSrc = join(target.sourceDir, 'skills');
  try {
    for (const entry of await readdir(skillsSrc)) {
      const info = await stat(join(skillsSrc, entry));
      if (!info.isDirectory()) continue;
      const destDir = join(base, 'skills', entry);
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'SKILL.md'), await readFile(join(skillsSrc, entry, 'SKILL.md'), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} skills/${entry}`);
      count++;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  for (const cls of ['agent', 'command']) {
    const src = join(target.sourceDir, cls);
    let files;
    try {
      files = (await readdir(src)).filter((f) => f.endsWith('.md'));
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const dest = join(base, cls);
    await mkdir(dest, { recursive: true });
    for (const f of files) {
      await writeFile(join(dest, f), await readFile(join(src, f), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} ${cls}/${f.replace(/\.md$/, '')}`);
      count++;
    }
  }

  return count;
}

// Pi native layout: skills/<name>/SKILL.md + agents/<name>.md + prompts/<name>.md
// (all under .pi/). The agents/ files are consumed by the pi-subagents extension
// (a documented install prerequisite — see the post-install note).
async function installPi(target, cwd) {
  const base = join(cwd, target.installDir); // .pi
  let count = 0;

  const skillsSrc = join(target.sourceDir, 'skills');
  try {
    for (const entry of await readdir(skillsSrc)) {
      const info = await stat(join(skillsSrc, entry));
      if (!info.isDirectory()) continue;
      const destDir = join(base, 'skills', entry);
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'SKILL.md'), await readFile(join(skillsSrc, entry, 'SKILL.md'), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} skills/${entry}`);
      count++;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  for (const cls of ['agents', 'prompts']) {
    const src = join(target.sourceDir, cls);
    let files;
    try {
      files = (await readdir(src)).filter((f) => f.endsWith('.md'));
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const dest = join(base, cls);
    await mkdir(dest, { recursive: true });
    for (const f of files) {
      await writeFile(join(dest, f), await readFile(join(src, f), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} ${cls}/${f.replace(/\.md$/, '')}`);
      count++;
    }
  }

  return count;
}

// Codex native layout: skills → .agents/skills/<name>/SKILL.md (personas +
// command-as-skill), TOML agents → .codex/agents/<name>.toml.
async function installCodex(target, cwd) {
  let count = 0;

  const skillsSrc = join(target.sourceDir, 'skills');
  try {
    for (const entry of await readdir(skillsSrc)) {
      const info = await stat(join(skillsSrc, entry));
      if (!info.isDirectory()) continue;
      const destDir = join(cwd, '.agents', 'skills', entry);
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'SKILL.md'), await readFile(join(skillsSrc, entry, 'SKILL.md'), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} .agents/skills/${entry}`);
      count++;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const agentsSrc = join(target.sourceDir, 'agents');
  try {
    const files = (await readdir(agentsSrc)).filter((f) => f.endsWith('.toml'));
    const dest = join(cwd, '.codex', 'agents');
    await mkdir(dest, { recursive: true });
    for (const f of files) {
      await writeFile(join(dest, f), await readFile(join(agentsSrc, f), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} .codex/agents/${f.replace(/\.toml$/, '')}`);
      count++;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  return count;
}

// Cursor native layout: skills/<name>/SKILL.md + agents/<name>.md + commands/<name>.md (all under .cursor/)
async function installCursor(target, cwd) {
  const base = join(cwd, target.installDir); // .cursor
  let count = 0;

  const skillsSrc = join(target.sourceDir, 'skills');
  try {
    for (const entry of await readdir(skillsSrc)) {
      const info = await stat(join(skillsSrc, entry));
      if (!info.isDirectory()) continue;
      const destDir = join(base, 'skills', entry);
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'SKILL.md'), await readFile(join(skillsSrc, entry, 'SKILL.md'), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} skills/${entry}`);
      count++;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  for (const cls of ['agents', 'commands']) {
    const src = join(target.sourceDir, cls);
    let files;
    try {
      files = (await readdir(src)).filter((f) => f.endsWith('.md'));
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const dest = join(base, cls);
    await mkdir(dest, { recursive: true });
    for (const f of files) {
      await writeFile(join(dest, f), await readFile(join(src, f), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} ${cls}/${f.replace(/\.md$/, '')}`);
      count++;
    }
  }

  return count;
}

// Antigravity native layout: skills/<name>/SKILL.md + workflows/<name>.md (under .agents/)
async function installAntigravity(target, cwd) {
  const base = join(cwd, target.installDir); // .agents
  let count = 0;

  const skillsSrc = join(target.sourceDir, 'skills');
  try {
    for (const entry of await readdir(skillsSrc)) {
      const info = await stat(join(skillsSrc, entry));
      if (!info.isDirectory()) continue;
      const destDir = join(base, 'skills', entry);
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'SKILL.md'), await readFile(join(skillsSrc, entry, 'SKILL.md'), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} skills/${entry}`);
      count++;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const wfSrc = join(target.sourceDir, 'workflows');
  try {
    const files = (await readdir(wfSrc)).filter((f) => f.endsWith('.md'));
    const dest = join(base, 'workflows');
    await mkdir(dest, { recursive: true });
    for (const f of files) {
      await writeFile(join(dest, f), await readFile(join(wfSrc, f), 'utf-8'), 'utf-8');
      console.log(`  ${chalk.green('+')} workflows/${f.replace(/\.md$/, '')}`);
      count++;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  return count;
}

async function installFlat(target, cwd) {
  const entries = await readdir(target.sourceDir);
  const files = entries.filter(f => f.endsWith(target.fileExt));
  const destDir = join(cwd, target.installDir);
  await mkdir(destDir, { recursive: true });

  for (const file of files) {
    const content = await readFile(join(target.sourceDir, file), 'utf-8');
    await writeFile(join(destDir, file), content, 'utf-8');
    const name = file.slice(0, -target.fileExt.length);
    console.log(`  ${chalk.green('+')} ${name}`);
  }

  return files.length;
}

// Where per-name skill directories (<name>/SKILL.md) live for a target, or null
// if the target does not use that convention (e.g. the `flat` layout). Mirrors
// the destinations written by the install* functions above.
function skillsBaseDir(target, cwd) {
  switch (target.layout) {
    case 'directory': // Claude: .claude/skills/<name>
    case 'codex':     // .agents/skills/<name> (installDir is already .agents/skills)
      return join(cwd, target.installDir);
    case 'dual':
    case 'opencode':
    case 'pi':
    case 'cursor':
    case 'antigravity':
      return join(cwd, target.installDir, 'skills');
    default:
      return null;
  }
}

// The skill names the CURRENT build installs for a target, read from dist/ (the
// source of truth for what v2 emits).
async function currentSkillNames(target) {
  const root = target.layout === 'directory'
    ? target.sourceDir               // top-level dirs are the skills (agents/commands excepted)
    : join(target.sourceDir, 'skills');
  const names = new Set();
  let entries;
  try {
    entries = await readdir(root);
  } catch (e) {
    if (e.code === 'ENOENT') return names;
    throw e;
  }
  for (const entry of entries) {
    if (target.layout === 'directory' && (entry === 'agents' || entry === 'commands')) continue;
    try {
      if ((await stat(join(root, entry))).isDirectory()) names.add(entry);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return names;
}

// Skill names the current build emits — an extension may not reuse one, as it
// would overwrite a core skill. Read live from dist/ so this never drifts from
// what actually ships. Pass a target for the install path; omit it on the
// target-agnostic save/list paths to reserve the union across every target.
async function reservedSkillNames(target) {
  if (target) return currentSkillNames(target);
  const all = new Set();
  for (const t of Object.values(TARGETS)) {
    for (const name of await currentSkillNames(t)) all.add(name);
  }
  return all;
}

// v1 installed 12 command-skills under the skills dir. v2 replaces that set with
// personas/conventions; the command-skills that did not survive are left orphaned
// on disk (the installer only overwrites, never deletes) and can shadow the new
// commands. Remove any skill dir whose name is a known v1 builtin that the current
// build no longer installs as a skill. Restricting to LEGACY_V1_SKILL_NAMES keeps
// this from touching user-authored skills.
async function cleanupStaleV1Skills(target, cwd) {
  const base = skillsBaseDir(target, cwd);
  if (!base) return [];
  const current = await currentSkillNames(target);
  const removed = [];
  for (const name of LEGACY_V1_SKILL_NAMES) {
    if (current.has(name)) continue; // still emitted by v2, overwritten in place, keep
    const skillDir = join(base, name);
    try {
      await stat(join(skillDir, 'SKILL.md'));
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    await rm(skillDir, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
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
    const confirmed = await promptConfirm('Continue and overwrite?');
    if (!confirmed) {
      console.log(chalk.dim('\nInstallation cancelled.\n'));
      process.exit(0);
    }
  }

  console.log(chalk.bold(`\nInstalling gspec skills for ${target.label}...\n`));

  const count = target.layout === 'flat'
    ? await installFlat(target, cwd)
    : target.layout === 'dual'
      ? await installDual(target, cwd)
      : target.layout === 'opencode'
        ? await installOpenCode(target, cwd)
        : target.layout === 'codex'
          ? await installCodex(target, cwd)
          : target.layout === 'cursor'
            ? await installCursor(target, cwd)
            : target.layout === 'antigravity'
              ? await installAntigravity(target, cwd)
              : target.layout === 'pi'
                ? await installPi(target, cwd)
                : await installDirectory(target, cwd);

  console.log(chalk.bold(`\n${count} skills installed to ${target.installDir}/\n`));

  // Remove v1 command-skills that v2 no longer emits, so the stale copies don't
  // shadow the new commands (the install step above only overwrites, never deletes).
  const removedStale = await cleanupStaleV1Skills(target, cwd);
  if (removedStale.length > 0) {
    console.log(chalk.bold(`  Removed ${removedStale.length} stale v1 skill${removedStale.length === 1 ? '' : 's'} superseded by v2:\n`));
    for (const name of removedStale) {
      console.log(`  ${chalk.red('-')} ${name}`);
    }
    console.log();
  }

  // Create gspec/ directory and install README
  const gspecDir = join(cwd, 'gspec');
  await mkdir(gspecDir, { recursive: true });
  const readmeContent = await readFile(join(__dirname, '..', 'README.md'), 'utf-8');
  await writeFile(join(gspecDir, 'README.md'), readmeContent, 'utf-8');
  console.log(chalk.bold(`  Created gspec/ directory with README.md\n`));
}

// gspec preamble: platform-specific config for the "always-on" agent-rules block
// injected into each target's instructions file (CLAUDE.md / AGENTS.md / .mdc).
const PREAMBLE_TARGETS = {
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
    // Antigravity now defaults to plural `.agents/rules/` with `.md` (the old
    // `.agent/rules/gspec.mdc` was the legacy path + wrong extension).
    file: '.agents/rules/gspec.md',
    mode: 'create',
    wrap: (content) => `---\ndescription: gspec specification sync — keeps living specs in sync with code changes\n---\n\n${content}`,
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
  pi: {
    // Pi loads project instructions from AGENTS.md in the current directory
    // (concatenated with ~/.pi/agent/AGENTS.md and any parents).
    file: 'AGENTS.md',
    mode: 'append',
    wrap: (content) => content,
  },
};

const GSPEC_SECTION_MARKER = '<!-- gspec:preamble -->';
// Markers written by older gspec versions. Matched on read so a re-install
// replaces a project's existing block in place instead of appending a duplicate;
// the block is always rewritten with the current GSPEC_SECTION_MARKER.
const GSPEC_LEGACY_MARKERS = ['<!-- gspec:spec-sync -->'];
const GSPEC_MARKER_ALT = [GSPEC_SECTION_MARKER, ...GSPEC_LEGACY_MARKERS].join('|');

async function installPreamble(targetName, cwd) {
  const config = PREAMBLE_TARGETS[targetName];
  if (!config) return;

  const templatePath = join(__dirname, '..', 'templates', 'preamble.md');
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

    // Detect the current marker or any legacy one so re-installs replace the
    // block in place (and migrate the delimiters to the current marker).
    const hasMarker = new RegExp(GSPEC_MARKER_ALT).test(existing);
    if (hasMarker) {
      // Replace existing gspec section
      const updated = existing.replace(
        new RegExp(`(?:${GSPEC_MARKER_ALT})[\\s\\S]*?(?:${GSPEC_MARKER_ALT})`),
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

// gspec ships model-free hook guards (Claude Code only). They live in the
// package's hooks/claude/ dir (the claude/ folder marks them Claude-specific and
// is stripped on install) and install to .claude/hooks/, registered per lifecycle
// event in .claude/settings.json. PostToolUse guards flag after a write; the
// PreToolUse memory guard blocks an untagged pending-memory write before it
// lands (the learning loop's address-tag hook).
// Each hook declares its lifecycle event and matcher. Tool hooks match tool
// names (Write|Edit|MultiEdit); the SubagentStop capture hook matches agent_type
// (`*` = every subagent — it filters internally on a FAIL verdict); the Stop
// reconcile hook pairs with the reconcile-marker PostToolUse hook to nudge a
// spec update when a session wrote source code but nothing under gspec/.
const TOOL_MATCHER = 'Write|Edit|MultiEdit';
const HOOK_SPECS = [
  { file: 'gspec-agnosticism-guard.mjs', event: 'PostToolUse', matcher: TOOL_MATCHER },
  { file: 'gspec-token-literals.mjs', event: 'PostToolUse', matcher: TOOL_MATCHER },
  { file: 'gspec-spec-integrity.mjs', event: 'PostToolUse', matcher: TOOL_MATCHER },
  { file: 'gspec-reconcile-marker.mjs', event: 'PostToolUse', matcher: TOOL_MATCHER },
  { file: 'gspec-memory-address-tag.mjs', event: 'PreToolUse', matcher: TOOL_MATCHER },
  { file: 'gspec-skill-write-guard.mjs', event: 'PreToolUse', matcher: TOOL_MATCHER },
  { file: 'gspec-task-immutability.mjs', event: 'PreToolUse', matcher: TOOL_MATCHER },
  { file: 'gspec-subagent-capture.mjs', event: 'SubagentStop', matcher: '*' },
  { file: 'gspec-reconcile.mjs', event: 'Stop', matcher: '*' },
  { file: 'gspec-practices-enforce.mjs', event: 'PostToolUse', matcher: TOOL_MATCHER },
];

// Engine-neutral floor modules (plugin/hooks/floors/) that the entry-point hooks
// import at runtime. Copied into <hooks-dir>/floors/ on every target that installs
// hooks; never wired into a hook config (they are libraries, not lifecycle hooks).
async function copyFloors(destHooksDir) {
  const floorsSrc = join(__dirname, '..', 'plugin', 'hooks', 'floors');
  const floorsDest = join(destHooksDir, 'floors');
  await mkdir(floorsDest, { recursive: true });
  const files = (await readdir(floorsSrc)).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  for (const f of files) await writeFile(join(floorsDest, f), await readFile(join(floorsSrc, f), 'utf-8'), 'utf-8');
  return files.length;
}

async function installHooks(targetName, cwd) {
  if (targetName !== 'claude') return; // hooks are Claude Code-specific (settings.json)

  const hooksSrc = join(__dirname, '..', 'plugin', 'hooks', 'claude');
  const hooksDest = join(cwd, '.claude', 'hooks');
  await mkdir(hooksDest, { recursive: true });
  for (const spec of HOOK_SPECS) {
    await writeFile(join(hooksDest, spec.file), await readFile(join(hooksSrc, spec.file), 'utf-8'), 'utf-8');
  }
  await copyFloors(hooksDest);

  // Merge into .claude/settings.json — create or merge, never clobber other
  // settings, and idempotent on re-install (drop any prior gspec hook entry).
  const settingsPath = join(cwd, '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  settings.hooks = settings.hooks || {};
  const isGspec = (entry) => (entry?.hooks || []).some(
    (h) => typeof h.command === 'string' && h.command.includes('/.claude/hooks/gspec-'),
  );
  const hookCmd = (s) => ({ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${s.file}"`, timeout: 10 });
  // One gspec entry per (event, matcher); idempotent (drop prior gspec entries
  // per event, keeping any non-gspec hooks the user has).
  const byEvent = {};
  for (const spec of HOOK_SPECS) (byEvent[spec.event] = byEvent[spec.event] || []).push(spec);
  for (const [event, specs] of Object.entries(byEvent)) {
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = existing.filter((e) => !isGspec(e));
    const byMatcher = {};
    for (const s of specs) (byMatcher[s.matcher] = byMatcher[s.matcher] || []).push(s);
    for (const [matcher, ms] of Object.entries(byMatcher)) {
      kept.push({ matcher, hooks: ms.map(hookCmd) });
    }
    settings.hooks[event] = kept;
  }
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  console.log(`  ${chalk.green('+')} Installed ${HOOK_SPECS.length} gspec hooks → .claude/hooks/ + settings.json`);
}

// Codex enforcement floors (Codex CLI only). Codex hooks fire on the Bash tool
// only, so the file-write floors run at the turn boundary instead: a SessionStart
// hook snapshots the task baseline and a Stop hook scans gspec/ and blocks on any
// violation (see plugin/hooks/codex/). We install those scripts to .codex/hooks/,
// copy the shared floor modules alongside, wire .codex/hooks.json (merge-safe),
// and enable the hook engine via the config.toml feature flag.
const CODEX_HOOK_SPECS = [
  { file: 'gspec-session-start.mjs', event: 'SessionStart' },
  { file: 'gspec-stop-gate.mjs', event: 'Stop' },
];

// Ensure `[features] codex_hooks = true` in config.toml without clobbering it.
// Heuristic TOML edit (not a full parser) — matches the block shape gspec writes.
function ensureCodexHooksFlag(toml) {
  if (/^\s*codex_hooks\s*=\s*true\s*$/m.test(toml)) return toml;
  let out = toml.replace(/^\s*codex_hooks\s*=.*$\n?/m, ''); // drop a prior `= false`
  if (/^\s*\[features\]\s*$/m.test(out)) {
    out = out.replace(/^(\s*\[features\]\s*)$/m, '$1\ncodex_hooks = true');
  } else {
    out = out.replace(/\s*$/, '');
    out += `${out ? '\n\n' : ''}[features]\ncodex_hooks = true\n`;
  }
  return out.endsWith('\n') ? out : out + '\n';
}

async function installCodexHooks(targetName, cwd) {
  if (targetName !== 'codex') return;

  const src = join(__dirname, '..', 'plugin', 'hooks', 'codex');
  const dest = join(cwd, '.codex', 'hooks');
  await mkdir(dest, { recursive: true });
  for (const f of (await readdir(src)).filter((f) => f.endsWith('.mjs'))) {
    await writeFile(join(dest, f), await readFile(join(src, f), 'utf-8'), 'utf-8');
  }
  await copyFloors(dest);

  // .codex/hooks.json — merge, drop prior gspec entries, keep the user's own.
  const hooksJsonPath = join(cwd, '.codex', 'hooks.json');
  let cfg = {};
  try { cfg = JSON.parse(await readFile(hooksJsonPath, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  cfg.hooks = cfg.hooks || {};
  // Absolute path: Codex hook commands take a literal command, and there is no
  // documented project-dir variable, so we bake the installed absolute path.
  const cmd = (f) => ({ command: `node "${join(cwd, '.codex', 'hooks', f)}"` });
  const isGspecEntry = (e) => typeof e?.command === 'string' && e.command.includes('/.codex/hooks/gspec-');
  for (const spec of CODEX_HOOK_SPECS) {
    const existing = Array.isArray(cfg.hooks[spec.event]) ? cfg.hooks[spec.event] : [];
    const kept = existing.filter((e) => !isGspecEntry(e));
    kept.push(cmd(spec.file));
    cfg.hooks[spec.event] = kept;
  }
  await writeFile(hooksJsonPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');

  const cfgTomlPath = join(cwd, '.codex', 'config.toml');
  let toml = '';
  try { toml = await readFile(cfgTomlPath, 'utf-8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(cfgTomlPath, ensureCodexHooksFlag(toml), 'utf-8');

  console.log(`  ${chalk.green('+')} Installed ${CODEX_HOOK_SPECS.length} gspec Codex hooks → .codex/hooks/ + hooks.json (enabled codex_hooks in config.toml)`);
}

const MIGRATE_COMMANDS = {
  claude: '/gspec-migrate',
  cursor: '/gspec-migrate',
  antigravity: '/gspec-migrate',
  codex: '/gspec-migrate',
  opencode: '/gspec-migrate',
  pi: '/gspec-migrate',
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

// Offer the recommended per-agent model tiering (v3.3).
//
// The `models` map is the largest unused cost lever gspec ships: without one,
// every agent — validators included — runs on the engine's default, which is
// usually the top tier. This offers the tiering rather than applying it,
// because which models spend a user's money is not something an installer
// should decide quietly. Hence: only on a TTY, only for the engines that
// actually run the build's agents, never when models are already configured,
// and never at all unless asked for explicitly in a headless run.
async function offerRecommendedModels(targetName, cwd, mode) {
  if (mode === 'none') return;
  const models = recommendedModels(targetName);
  if (!models) return; // cursor/opencode don't run these agents; pi moves too fast to table

  // Never second-guess a user who has configured this.
  if (hasModelsConfigured(await readProjectConfig(cwd), await readGlobalConfig())) {
    if (mode === 'recommended') {
      console.log(chalk.dim(`  Per-agent models already configured — left as they are.\n`));
    }
    return;
  }

  const tiers = [...new Set(Object.values(models))];
  if (mode !== 'recommended') {
    // A non-TTY install (CI, a piped script) gets nothing by default: silently
    // changing which models a run bills to is not an install-time default.
    if (!process.stdin.isTTY) return;
    console.log(chalk.bold('\n  Per-agent models'));
    console.log(chalk.dim('  Each build stage runs as its own agent, so they need not share a model.'));
    console.log(chalk.dim(`  Recommended for ${targetName}: validators on ${tiers[tiers.length - 1]},`));
    console.log(chalk.dim(`  authoring on ${models.default}, and the architecture + implementation on ${models.implementer}.\n`));
    const yes = await promptConfirm('Use this recommended model assignment?');
    if (!yes) {
      console.log(chalk.dim(`  Skipped — every agent uses the engine default. Add a "models" map to ${PROJECT_CONFIG_PATH} any time.\n`));
      return;
    }
  }

  await writeProjectConfig(cwd, { models });
  console.log(chalk.dim(`  Recorded the recommended model assignment in ${PROJECT_CONFIG_PATH}\n`));
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

  // `architecture` is the module tier, `tasks` the plans — both were missing
  // here, so the outdated-spec check silently skipped every sub-architecture
  // file and every plan: a project could be told it was current while half its
  // specs still carried the previous spec-version.
  for (const subdir of ['features', 'architecture', 'tasks', 'epics']) {
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

// Detect specs sitting in a pre-v2 layout that /gspec-migrate must relocate.
// These can carry a current spec-version, so the version check above never flags
// them even though v2 expects everything for a feature in gspec/features/<slug>/:
//   - flat PRDs/plans under gspec/features/  → moved into gspec/features/<slug>/
//   - anything under gspec/tasks/            → moved into gspec/features/<slug>/
//   - anything under gspec/epics/            → epics were removed
async function collectLegacyLayout(gspecDir) {
  const legacy = [];
  try {
    for (const entry of await readdir(join(gspecDir, 'features'))) {
      if (entry.endsWith('.plan.md') || entry.endsWith('.tasks.md')) {
        legacy.push(`gspec/features/${entry}`);
      } else if (entry.endsWith('.md')) {
        // A flat PRD. Layout is checked independently of spec-version precisely
        // because a file can be stamped current and still sit in the old place —
        // the version check would never flag it.
        legacy.push(`gspec/features/${entry}`);
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  try {
    for (const entry of await readdir(join(gspecDir, 'tasks'))) {
      if (entry.endsWith('.md')) legacy.push(`gspec/tasks/${entry}`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  try {
    for (const entry of await readdir(join(gspecDir, 'epics'))) {
      if (entry.endsWith('.md')) legacy.push(`gspec/epics/${entry}`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return legacy;
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

  const legacy = await collectLegacyLayout(gspecDir);

  if (outdated.length === 0 && legacy.length === 0) return;

  const cmd = MIGRATE_COMMANDS[targetName] || '/gspec-migrate';

  if (outdated.length > 0) {
    console.log(chalk.yellow(`  Found existing gspec files that may need updating:\n`));
    for (const file of outdated) {
      const status = file.version
        ? `version ${file.version} (current: ${SPEC_VERSION})`
        : `no version (pre-${SPEC_VERSION})`;
      console.log(`    ${chalk.yellow('!')} ${file.label} — ${status}`);
    }
    console.log();
  }

  if (legacy.length > 0) {
    console.log(chalk.yellow(`  Found specs in a pre-${SPEC_VERSION} layout. gspec ${SPEC_VERSION} keeps everything for a`));
    console.log(chalk.yellow(`  feature in ${chalk.bold('gspec/features/<slug>/')} — ${chalk.bold('prd.md')} and ${chalk.bold('tasks.md')}.`));
    console.log(chalk.yellow(`  ${chalk.bold(cmd)} relocates these for you:\n`));
    for (const file of legacy) {
      console.log(`    ${chalk.yellow('!')} ${file}`);
    }
    console.log();
  }

  // Always surface the command (no y/N gate) so the migration step is hard to miss,
  // and so it still prints on non-interactive installs.
  console.log(chalk.bold(`  Run this command in ${TARGETS[targetName].label} to migrate:\n`));
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
  const fileOptions = [];
  for (let i = 0; i < files.length; i++) {
    const content = await readFile(files[i].path, 'utf-8');
    const { fields } = parseFrontmatter(content);
    fileOptions.push({ value: i, label: files[i].label, hint: fields.description || undefined });
  }
  const selectedIndex = await promptSelect('Which spec would you like to save?', fileOptions);

  const selected = files[selectedIndex];
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
      const overwrite = await promptConfirm(
        `Overwrite existing ~/.gspec/${selected.type}/${existingName}${ext}?`,
        true,
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
    const answered = await promptInput('Save name (no spaces):', { placeholder: 'my-saas-stack' });
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
    const desc = await promptInput('Description (short summary):');
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
      const overwrite = await promptConfirm(`${selected.type}/${name}${ext} already exists. Overwrite?`);
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

  const selectedType = await promptSelect(
    'Select a spec type:',
    types.map((t) => ({ value: t, label: t })),
  );
  const specs = await listSavedSpecs(selectedType);

  if (specs.length === 0) {
    console.error(chalk.red(`\n  No specs found in ~/.gspec/${selectedType}/\n`));
    process.exit(1);
  }

  const selectedSlug = await promptSelect(
    `Select a spec from ${selectedType}:`,
    specs.map((s) => ({ value: s.slug, label: s.slug, hint: s.description || undefined })),
  );

  await restoreFile(selectedType, selectedSlug, cwd);
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
    const overwrite = await promptConfirm(`${relPath} already exists. Overwrite?`);
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
    profile = await promptSpecSelect('Select a profile (or skip)', [...profiles, NONE_OPTION]);
    if (profile === '_none') profile = null;
  } else {
    console.log(chalk.dim('  No saved profiles found — skipping.\n'));
  }

  // --- Stack (0 or 1) ---
  const stacks = await listSavedSpecsSafe('stacks');
  let stack = null;
  if (stacks.length > 0) {
    stack = await promptSpecSelect('Select a stack (or skip)', [...stacks, NONE_OPTION]);
    if (stack === '_none') stack = null;
  } else {
    console.log(chalk.dim('  No saved stacks found — skipping.\n'));
  }

  // --- Practices (0 or 1) ---
  const practices = await listSavedSpecsSafe('practices');
  let practice = null;
  if (practices.length > 0) {
    practice = await promptSpecSelect('Select practices (or skip)', [...practices, NONE_OPTION]);
    if (practice === '_none') practice = null;
  } else {
    console.log(chalk.dim('  No saved practices found — skipping.\n'));
  }

  // --- Style (0 or 1) ---
  const styles = await listSavedSpecsSafe('styles');
  let style = null;
  if (styles.length > 0) {
    style = await promptSpecSelect('Select a style (or skip)', [...styles, NONE_OPTION]);
    if (style === '_none') style = null;
  } else {
    console.log(chalk.dim('  No saved styles found — skipping.\n'));
  }

  // --- Features (0 to many) ---
  const features = await listSavedSpecsSafe('features');
  let selectedFeatures = [];
  if (features.length > 0) {
    selectedFeatures = await promptSpecMultiSelect('Select features (optional)', features);
  } else {
    console.log(chalk.dim('  No saved features found — skipping.\n'));
  }

  // Check that at least one spec was selected
  if (!profile && !stack && !practice && !style && selectedFeatures.length === 0) {
    console.error(chalk.red('\n  No specs selected. Playbook not created.\n'));
    process.exit(1);
  }

  // Prompt for playbook name
  const name = await promptInput('Playbook name (no spaces):', { placeholder: 'my-saas-starter' });
  if (!name) {
    console.error(chalk.red('\n  Name is required.'));
    process.exit(1);
  }
  if (/\s/.test(name)) {
    console.error(chalk.red('\n  Name cannot contain spaces. Use hyphens instead (e.g. my-saas-starter).'));
    process.exit(1);
  }

  // Prompt for description
  const description = await promptInput('Description (short summary):');

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
    const overwrite = await promptConfirm(`Playbook "${name}" already exists. Overwrite?`);
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
    const confirmed = await promptConfirm('Continue and overwrite?');
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
  .option('-t, --target <target>', 'target platform (claude, cursor, antigravity, codex, opencode, pi)')
  .option('--models <mode>', "assign per-agent models without being asked: 'recommended' writes the tiering for this engine, 'none' skips the question")
  .action(async (opts) => {
    console.log(BANNER);

    let targetName = opts.target;

    if (!targetName) {
      targetName = await promptTarget();
    }

    await install(targetName, process.cwd());

    // Record the target so later commands can infer the platform this project
    // runs on (gspec build defaults its engine from this).
    // Stamp the version too. The agent/command/skill files this just wrote are
    // COPIES: upgrading gspec does not touch them, so a project silently keeps
    // running yesterday's agents. A measured dogfood run did exactly that — all
    // 29 installed agents were a day behind, and a QA bar that had already been
    // fixed failed the same stage seven times. Without a stamp the build has no
    // way to notice.
    await writeProjectConfig(process.cwd(), { target: targetName, gspecVersion: pkg.version });
    console.log(chalk.dim(`  Recorded install target and v${pkg.version} in ${PROJECT_CONFIG_PATH}\n`));

    await installExtensions(targetName, process.cwd());

    // Sweep the pre-3.7 stores first — the renamed lessons/ directories and any
    // per-agent memory silo — so nothing recorded under the old scheme is
    // stranded, and a renamed store composes on this very install.
    await migrateLessonsDirs(process.cwd());
    await migrateMemorySilos(process.cwd());

    // After extensions, so a memory can be composed into an extension skill too.
    await applyMemory(targetName, process.cwd());

    await seedFromSavedSpecs(process.cwd());

    await installPreamble(targetName, process.cwd());

    await installHooks(targetName, process.cwd());

    await offerRecommendedModels(targetName, process.cwd(), opts.models);

    await installCodexHooks(targetName, process.cwd());

    await checkGspecFiles(process.cwd(), targetName);

    // Pi delegates the whole gspec flow to sub-agents (installed to .pi/agents/),
    // which Pi only understands with the pi-subagents extension. Surface it as a
    // hard prerequisite so the install isn't silently half-wired.
    if (targetName === 'pi') {
      console.log();
      console.log(chalk.bold.yellow('  ═══ Required: pi-subagents extension ════════════════════════'));
      console.log();
      console.log(chalk.bold.white('  gspec runs as sub-agents on Pi. Install the extension:'));
      console.log();
      console.log(`    ${chalk.bold.cyan('pi install npm:pi-subagents')}`);
      console.log();
      console.log(`  The ${chalk.bold('/gspec-*')} prompts in ${chalk.bold('.pi/prompts/')} delegate to the sub-agents`);
      console.log(`  in ${chalk.bold('.pi/agents/')}. Without the extension Pi can't spawn them and`);
      console.log(`  the commands won't work as designed.`);
      console.log();
      console.log(chalk.bold.yellow('  ═════════════════════════════════════════════════════════════'));
      console.log();
    }

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

// --- Memory (the durable half of the learning loop) ---
//
// A committed memory — one approved through /gspec-memorize or /gspec-teach —
// used to be written straight into `.claude/skills/<name>/SKILL.md`, which the
// next install overwrites. That put the DURABLE store and the COMMITTED store
// the wrong way round: the review step deletes the pending copy once a memory
// graduates, so committing it moved it from the file that survives an upgrade
// into the file that does not, then deleted the surviving copy.
//
// Memory now lives outside the overwrite path, in one of two homes by scope, and
// is composed back into the skill on every install. That makes an upgrade
// IDEMPOTENT rather than destructive: the skill is rebuilt from source + what
// you remember each time, so there is nothing left to lose.
//
//   personal → ~/.gspec/memory/<skill>.md   travels with you, every project
//   project  → <cwd>/.gspec/memory/<skill>.md   committed, shared with the team
//
// Project composes LAST and therefore wins: the repo you are in gets the final
// word, matching how gspec already treats project config as more specific than
// global.
//
// Upstream of both sits the PENDING tier, `<cwd>/.gspec/memory/pending/`, where
// agents record raw memories mid-run (see the gspec-memory skill). It is a
// SUBDIRECTORY, deliberately: readMemoryFrom only reads `*.md` files, so an
// unreviewed memory can never be composed into a skill by accident — committing
// stays the reviewed path through /gspec-memorize. One file per memory, under a
// per-agent dir, because same-wave agents run concurrently and a shared file
// would silently lose whichever write landed first.
const MEMORY_DIR = join(GSPEC_HOME, 'memory');
const projectMemoryDir = (cwd) => join(cwd, '.gspec', 'memory');
const pendingMemoryDir = (cwd) => join(cwd, '.gspec', 'memory', 'pending');

// Fences so the pass is idempotent — a re-install strips the previous block
// before appending the current one, and never doubles it up. The strip pattern
// also matches the pre-rename `gspec:lessons:` marker, so `gspec memory apply`
// on a skill composed by an older install replaces that block instead of
// stacking a second one beside it.
const MEMORY_START = '<!-- gspec:memory:start — managed by /gspec-teach and /gspec-memorize; edit the files in .gspec/memory/ or ~/.gspec/memory/ -->';
const MEMORY_END = '<!-- gspec:memory:end -->';
const MEMORY_FENCE_RE = /\n*<!-- gspec:(?:memory|lessons):start[\s\S]*?<!-- gspec:(?:memory|lessons):end -->\n*/g;

async function readMemoryFrom(dir) {
  let entries;
  try { entries = await readdir(dir); } catch (e) { if (e.code === 'ENOENT') return new Map(); throw e; }
  const out = new Map();
  for (const file of entries.filter((f) => f.endsWith('.md'))) {
    // `gspec` names the third category — reports about the tool itself, which
    // live in the sibling gspec/ directory and are never composed into a skill.
    // The directory is skipped naturally (it has no .md suffix), as is the
    // pending/ tier; this catches a stray `gspec.md` or `pending.md`, either of
    // which would otherwise compose unreviewed text into a skill.
    if (basename(file, '.md') === 'gspec' || basename(file, '.md') === 'pending') continue;
    const body = (await readFile(join(dir, file), 'utf-8')).trim();
    if (body) out.set(basename(file, '.md'), body);
  }
  return out;
}

// { skillName -> { personal, project } } across both homes.
async function loadMemory(cwd) {
  const [personal, project] = await Promise.all([
    readMemoryFrom(MEMORY_DIR),
    readMemoryFrom(projectMemoryDir(cwd)),
  ]);
  const names = new Set([...personal.keys(), ...project.keys()]);
  const out = new Map();
  for (const name of names) out.set(name, { personal: personal.get(name), project: project.get(name) });
  return out;
}

// The block appended to a skill. Personal first, project second — later text is
// what a reader (and a model) carries forward, and the precedence is stated in
// the prose too rather than left to ordering alone.
// A store file writes one memory per `## ` heading — the same shape a pending
// memory uses, so a memory reads identically wherever it lives. Composed, those
// sit two levels down under `### Personal` / `### Project`, so demote them;
// leaving them at `##` would make each memory a sibling of "Remembered" and
// silently break the section it is supposed to belong to. Only fenced-code-free
// lines are touched, so a memory quoting markdown keeps its example intact.
function demoteHeadings(body, by = 2) {
  let inFence = false;
  return String(body).split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    const m = line.match(/^(#{1,6})(\s+.*)$/);
    return m ? '#'.repeat(Math.min(6, m[1].length + by)) + m[2] : line;
  }).join('\n');
}

function composeMemoryBlock({ personal, project }) {
  const parts = [MEMORY_START, '', '## Remembered',
    'What `/gspec-teach` or `/gspec-memorize` committed to memory for this skill. It is part of the skill: apply it as you would anything above. Where a project memory and a personal one conflict, **the project memory wins** — it is the more specific of the two.'];
  if (personal) parts.push('', '### Personal — carried across every project', '', demoteHeadings(personal));
  if (project) parts.push('', '### Project — this repository, and it overrides the personal memories above', '', demoteHeadings(project));
  parts.push('', MEMORY_END);
  return parts.join('\n');
}

// Post-install pass: one hook point covering every layout, because they all
// resolve a skill to `<skillsBaseDir>/<name>/SKILL.md`. Runs after the core
// skills land, so it composes onto the freshly written file.
async function applyMemory(targetName, cwd) {
  const memory = await loadMemory(cwd);
  if (memory.size === 0) return;

  const target = TARGETS[targetName];
  const skillsDir = skillsBaseDir(target, cwd);
  const applied = [];
  const orphans = [];
  for (const [name, sources] of memory) {
    const path = join(skillsDir, name, 'SKILL.md');
    let current;
    try { current = await readFile(path, 'utf-8'); }
    catch (e) { if (e.code === 'ENOENT') { orphans.push(name); continue; } throw e; }
    const stripped = current.replace(MEMORY_FENCE_RE, '\n').trimEnd();
    await writeFile(path, `${stripped}\n\n${composeMemoryBlock(sources)}\n`, 'utf-8');
    applied.push({ name, ...sources });
  }

  if (applied.length > 0) {
    console.log(chalk.bold(`\nComposing memory into ${applied.length} skill${applied.length === 1 ? '' : 's'}...\n`));
    for (const a of applied) {
      const from = [a.personal && 'personal', a.project && 'project'].filter(Boolean).join(' + ');
      console.log(`  ${chalk.green('+')} ${a.name} ${chalk.dim(`(${from})`)}`);
    }
  }
  // Named for a skill this target does not ship — say so rather than dropping it
  // silently, since a typo here looks identical to a memory that never applied.
  for (const name of orphans) {
    console.warn(chalk.yellow(`  ! Memory file "${name}.md" matches no installed skill — nothing to compose it into.`));
  }
}

// --- The pending tier ------------------------------------------------------

// One memory per file, so read the tree rather than parse one document.
// Returns { agentName -> [{ file, heading }] } for everything under pending/.
async function loadPendingMemories(cwd) {
  const root = pendingMemoryDir(cwd);
  let agents;
  try { agents = await readdir(root, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return new Map(); throw e; }

  const out = new Map();
  for (const ent of agents) {
    if (!ent.isDirectory()) continue;
    let files;
    try { files = (await readdir(join(root, ent.name))).filter((f) => f.endsWith('.md')); }
    catch { continue; }
    const memories = [];
    for (const file of files) {
      let body = '';
      try { body = await readFile(join(root, ent.name, file), 'utf-8'); } catch { continue; }
      // The `## ` line is the memory's one-liner; fall back to the filename so a
      // malformed one is still visible rather than silently uncounted.
      const heading = (body.match(/^##\s+(\S.*)$/m) || [])[1]?.trim() || basename(file, '.md');
      memories.push({ file, heading });
    }
    if (memories.length) out.set(ent.name, memories);
  }
  return out;
}

// --- Migration: pre-3.7 stores ---------------------------------------------
//
// Two things moved in 3.7.0 and both are swept on the next install rather than
// left stranded:
//
//   1. Claude's per-agent `memory:` silo (`.claude/agent-memory*/<agent>/
//      MEMORY.md`) — one file per agent, many `## ` blocks in it, Claude-only.
//      Each block becomes its own pending memory, and the MEMORY.md is RENAMED
//      rather than deleted: nothing is destroyed, and the rename is what stops a
//      re-sweep on the next install.
//   2. `.gspec/lessons/` and `~/.gspec/lessons/` — the store's former name.
//      A plain directory rename, since the contents and format are unchanged.
const OLD_MEMORY_DIRS = ['.claude/agent-memory', '.claude/agent-memory-local'];

// Split a MEMORY.md into its `## ` blocks (heading + body, verbatim).
function splitMemoryLessons(md) {
  const out = [];
  let current = null;
  for (const line of String(md).split('\n')) {
    const m = line.match(/^##\s+(\S.*)$/);
    if (m) {
      if (current) out.push(current);
      current = { heading: m[1].trim(), lines: [] };
    } else if (current) current.lines.push(line);
  }
  if (current) out.push(current);
  return out.map(({ heading, lines }) => ({ heading, body: lines.join('\n').trim() }));
}

async function migrateMemorySilos(cwd) {
  let migrated = 0;
  const agentsSeen = new Set();

  for (const dir of OLD_MEMORY_DIRS) {
    let entries;
    try { entries = await readdir(join(cwd, dir), { withFileTypes: true }); }
    catch { continue; } // no silo here — the normal case
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const memPath = join(cwd, dir, ent.name, 'MEMORY.md');
      let text;
      try { text = await readFile(memPath, 'utf-8'); } catch { continue; }

      const blocks = splitMemoryLessons(text);
      const destDir = join(pendingMemoryDir(cwd), ent.name);
      if (blocks.length) await mkdir(destDir, { recursive: true });
      for (const [i, block] of blocks.entries()) {
        // The old format carried `- target:`/`- layer:` bullets inside the body;
        // they satisfy the address-tag contract as-is, so the block moves across
        // verbatim under frontmatter that records where it came from.
        const name = `migrated-${String(i + 1).padStart(2, '0')}-${slugifyTitle(block.heading)}.md`;
        const file = join(destDir, name);
        // Never clobber a memory that is already there — a re-run is a no-op.
        try { await stat(file); continue; } catch { /* absent, write it */ }
        const front = ['---', `agent: ${ent.name}`, `migrated-from: ${dir}/${ent.name}/MEMORY.md`, '---', ''].join('\n');
        await writeFile(file, `${front}\n## ${block.heading}\n\n${block.body}\n`, 'utf-8');
        migrated++;
      }
      await rename(memPath, `${memPath}.migrated`).catch(() => {});
      agentsSeen.add(ent.name);
    }
  }

  if (migrated > 0) {
    console.log(`  ${chalk.green('+')} Migrated ${chalk.bold(migrated)} memor${migrated === 1 ? 'y' : 'ies'} from ${agentsSeen.size} agent memory silo(s) → .gspec/memory/pending/`);
    console.log(chalk.dim('    Each old MEMORY.md was renamed to MEMORY.md.migrated, not deleted. Review with /gspec-memorize.'));
  }
}

// `.gspec/lessons/` → `.gspec/memory/` (and the same under ~). A rename, not a
// merge: if the destination already exists the old directory is left untouched
// and named, because silently merging two stores could resurrect a memory the
// user deleted. Runs before the composition pass, so a renamed store composes on
// the very install that moves it.
async function migrateLessonsDirs(cwd) {
  const moves = [
    [join(cwd, '.gspec', 'lessons'), projectMemoryDir(cwd), '.gspec/lessons/'],
    [join(GSPEC_HOME, 'lessons'), MEMORY_DIR, '~/.gspec/lessons/'],
  ];
  for (const [from, to, label] of moves) {
    try { await stat(from); } catch { continue; } // not present — the normal case
    try { await stat(to); }
    catch {
      await rename(from, to);
      console.log(`  ${chalk.green('+')} Moved ${chalk.bold(label)} → ${label.replace('lessons', 'memory')} (the store was renamed in 3.7.0)`);
      continue;
    }
    console.warn(chalk.yellow(`  ! ${label} still exists and ${label.replace('lessons', 'memory')} does too — left both alone. Merge them by hand; only the memory/ one is read.`));
  }
}

// --- The third category: memories about gspec itself ---
//
// Some corrections are not about your project or your habits — they are about
// the tool. "This lint has a false positive." "This persona should require X."
// Those cannot be fixed by composing text into a skill on your machine; they
// have to reach the people who ship gspec.
//
// A gspec memory is therefore a REPORT, never composed into a skill. It lives
// one-file-per-report so each carries its own filed status, and it reaches
// GitHub as a PREFILLED ISSUE URL rather than an API call: no token to store, no
// credential for gspec to hold, and nothing leaves the machine until the user
// themselves clicks submit. Filing an issue is outward-facing and effectively
// irreversible — public, indexed, attributed — so the last step stays a human's.
const REPORTS_DIR = join(MEMORY_DIR, 'gspec');

// GitHub rejects a request line beyond roughly 8KB, and a silently truncated
// report is worse than a short one that says it was cut.
const ISSUE_URL_BUDGET = 6000;

const repoUrl = () => String(pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');

const slugifyTitle = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';

async function loadReports() {
  let entries;
  try { entries = await readdir(REPORTS_DIR); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const file of entries.filter((f) => f.endsWith('.md'))) {
    const raw = await readFile(join(REPORTS_DIR, file), 'utf-8');
    const { fields, body } = parseFrontmatter(raw);
    out.push({ name: basename(file, '.md'), path: join(REPORTS_DIR, file), fields, body: body.trim(), raw });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function issueUrl(report) {
  const base = repoUrl();
  if (!base) return null;
  // A quoted YAML scalar keeps its quotes through the frontmatter parser, and
  // they would land verbatim in the issue title.
  const title = String(report.fields.title || report.name).replace(/^(['"])([\s\S]*)\1$/, '$2');
  let body = `${report.body}\n\n---\nReported from gspec v${pkg.version} via \`/gspec-teach\`.`;
  const encodedLen = () => `${base}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=lesson`.length;
  if (encodedLen() > ISSUE_URL_BUDGET) {
    // Trim the body, not the title, and say so in the issue itself so a reader
    // knows they are looking at a fragment.
    const notice = '\n\n_(truncated by gspec — the full report is in the reporter\'s `~/.gspec/memory/gspec/`.)_';
    while (encodedLen() > ISSUE_URL_BUDGET && body.length > 200) body = body.slice(0, Math.floor(body.length * 0.9));
    body += notice;
  }
  return `${base}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=lesson`;
}

async function memoryReport() {
  const reports = await loadReports();
  if (reports.length === 0) {
    console.log(chalk.dim('\n  No gspec reports yet.'));
    console.log(chalk.dim(`  They live in ${REPORTS_DIR}, written by /gspec-teach when a memory is about gspec itself.\n`));
    return;
  }
  const unsent = reports.filter((r) => r.fields.status !== 'filed');
  console.log(chalk.bold(`\n  ${reports.length} gspec report${reports.length === 1 ? '' : 's'} (${unsent.length} unsent):\n`));
  for (const r of reports) {
    const filed = r.fields.status === 'filed';
    const mark = filed ? chalk.green('✓') : chalk.yellow('•');
    console.log(`  ${mark} ${chalk.bold(r.name)} ${chalk.dim(filed ? `— filed: ${r.fields.issue || '(no url recorded)'}` : '— not yet filed')}`);
  }
  if (unsent.length === 0) { console.log(); return; }

  console.log(chalk.bold('\n  Open these to file them — review the text on GitHub before submitting:\n'));
  for (const r of unsent) {
    const url = issueUrl(r);
    if (!url) { console.warn(chalk.yellow(`  ! ${r.name}: no repository url in package.json — cannot build an issue link.`)); continue; }
    console.log(`  ${chalk.bold(r.name)}\n    ${chalk.cyan(url)}\n`);
  }
  console.log(chalk.dim(`  Once submitted, record it: gspec memory filed <name> <issue-url>\n`));
}

async function memoryFiled(name, url) {
  const reports = await loadReports();
  const r = reports.find((x) => x.name === name);
  if (!r) {
    console.error(chalk.red(`\n  No gspec report named "${name}".`));
    console.error(chalk.dim('  See them with: gspec memory report\n'));
    process.exit(1);
  }
  const fields = { ...r.fields, status: 'filed', issue: url };
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  await writeFile(r.path, `---\n${fm}\n---\n\n${r.body}\n`, 'utf-8');
  console.log(chalk.green(`\n  ✓ Recorded ${name} as filed → ${url}\n`));
}

// Count the `## ` headings in a store file — the same one-entry-per-heading
// shape a pending memory uses, so a memory reads identically wherever it is.
const countMemories = (body) => (String(body).match(/^##\s+\S/gm) || []).length;

async function memoryList(cwd) {
  const memory = await loadMemory(cwd);
  const reports = await loadReports();
  const pending = await loadPendingMemories(cwd);
  const reportLine = () => {
    if (reports.length === 0) return;
    const unsent = reports.filter((r) => r.fields.status !== 'filed').length;
    console.log(chalk.dim(`  gspec    → ${REPORTS_DIR} (${reports.length} report${reports.length === 1 ? '' : 's'}${unsent ? `, ${chalk.yellow(`${unsent} unsent`)}` : ''}) — see: gspec memory report`));
  };
  // Recorded but not yet reviewed — these change nothing until committed, so
  // they are reported separately from what is actually composed into a skill.
  const pendingBlock = () => {
    if (pending.size === 0) return;
    const total = [...pending.values()].reduce((n, l) => n + l.length, 0);
    console.log(chalk.bold(`\n  ${chalk.yellow(total)} pending memor${total === 1 ? 'y' : 'ies'} awaiting review, from ${pending.size} agent${pending.size === 1 ? '' : 's'}:\n`));
    for (const [agent, items] of [...pending].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${chalk.yellow('✎')} ${chalk.bold(agent)}`);
      for (const it of items) console.log(chalk.dim(`      · ${it.heading}`));
    }
    console.log(chalk.dim(`\n  pending  → ${pendingMemoryDir(cwd)} — commit them with /gspec-memorize.`));
  };
  if (memory.size === 0) {
    console.log(chalk.dim('\n  Nothing composed into skills yet.'));
    console.log(chalk.dim(`  personal → ${MEMORY_DIR}`));
    console.log(chalk.dim(`  project  → ${projectMemoryDir(cwd)}`));
    reportLine();
    pendingBlock();
    console.log(chalk.dim('  Add one with /gspec-teach, or commit a pending one with /gspec-memorize.\n'));
    return;
  }
  console.log(chalk.bold(`\n  Memory composed into ${memory.size} skill${memory.size === 1 ? '' : 's'}:\n`));
  for (const [name, { personal, project }] of [...memory].sort(([a], [b]) => a.localeCompare(b))) {
    const bits = [];
    if (personal) bits.push(`${countMemories(personal)} personal`);
    if (project) bits.push(`${countMemories(project)} project`);
    console.log(`  ${chalk.green('•')} ${chalk.bold(name)} ${chalk.dim(`— ${bits.join(', ')}`)}`);
  }
  console.log(chalk.dim(`\n  personal → ${MEMORY_DIR}`));
  console.log(chalk.dim(`  project  → ${projectMemoryDir(cwd)}`));
  reportLine();
  pendingBlock();
  console.log(chalk.dim('\n  Project memories override personal ones. Re-run the installer to recompose.\n'));
}

// --- Extensions ---

const EXTENSIONS_DIR = join(GSPEC_HOME, 'extensions');
const EXTENSION_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

async function loadExtensions() {
  let entries;
  try {
    entries = await readdir(EXTENSIONS_DIR);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }

  const files = entries.filter((f) => f.endsWith('.md'));
  const loaded = [];
  for (const file of files) {
    const path = join(EXTENSIONS_DIR, file);
    const content = await readFile(path, 'utf-8');
    const { fields, body } = parseFrontmatter(content);
    loaded.push({ file, path, fields, body, content });
  }
  return loaded;
}

function validateExtension(ext, reserved) {
  const errors = [];
  if (!ext.fields.name) errors.push("missing 'name' frontmatter");
  if (!ext.fields.description) errors.push("missing 'description' frontmatter");
  if (ext.fields.name && !EXTENSION_NAME_RE.test(ext.fields.name)) {
    errors.push(`invalid name "${ext.fields.name}" (must match /^[a-z0-9][a-z0-9-]*$/)`);
  }
  if (ext.fields.name && reserved && reserved.has(ext.fields.name)) {
    errors.push(`name "${ext.fields.name}" collides with a built-in gspec skill`);
  }
  return errors;
}

async function installExtensions(targetName, cwd) {
  const extensions = await loadExtensions();
  if (extensions.length === 0) return;

  const target = TARGETS[targetName];
  const reserved = await reservedSkillNames(target);
  const valid = [];
  for (const ext of extensions) {
    const errors = validateExtension(ext, reserved);
    if (errors.length > 0) {
      console.warn(chalk.yellow(`  ! Skipping extension ${ext.file}: ${errors.join('; ')}`));
      continue;
    }
    valid.push(ext);
  }

  // Resolve duplicates by name (last write wins, with a warning)
  const byName = new Map();
  for (const ext of valid) {
    if (byName.has(ext.fields.name)) {
      console.warn(chalk.yellow(
        `  ! Extension name "${ext.fields.name}" defined in two files; ${ext.file} overrides ${byName.get(ext.fields.name).file}`
      ));
    }
    byName.set(ext.fields.name, ext);
  }
  const finalSet = Array.from(byName.values());
  if (finalSet.length === 0) return;

  console.log(chalk.bold(`\nInstalling ${finalSet.length} user extension${finalSet.length === 1 ? '' : 's'} from ~/.gspec/extensions/...\n`));
  // Extensions are user-authored skills. Every target defines emitSkill (a bare
  // emit() exists only on the Claude target), so route through emitSkill to stay
  // format-consistent with the core skills. Its outDir is the skills dir itself
  // for the 'directory' layout (Claude writes <outDir>/<name>) and the PARENT of
  // the skills dir for every other layout (their emitSkill re-appends `skills/`).
  const skillsDir = skillsBaseDir(target, cwd);
  const emitOut = target.layout === 'directory' ? skillsDir : dirname(skillsDir);
  for (const ext of finalSet) {
    const meta = { name: ext.fields.name, description: ext.fields.description };
    await target.emitSkill(emitOut, ext.body, meta);
    console.log(`  ${chalk.green('+')} ${ext.fields.name} ${chalk.dim('(extension)')}`);
  }
}

async function extensionList() {
  console.log(BANNER);
  const extensions = await loadExtensions();
  if (extensions.length === 0) {
    console.log(chalk.dim('\n  No extensions installed in ~/.gspec/extensions/.\n'));
    console.log(chalk.dim('  Use "gspec extension save <path>" to install one.\n'));
    return;
  }

  console.log(chalk.bold(`\n  ${extensions.length} extension${extensions.length === 1 ? '' : 's'} in ~/.gspec/extensions/:\n`));
  const reserved = await reservedSkillNames();
  for (const ext of extensions) {
    const errors = validateExtension(ext, reserved);
    const name = ext.fields.name || chalk.dim('(no name)');
    const desc = ext.fields.description ? chalk.dim(` — ${ext.fields.description}`) : '';
    if (errors.length > 0) {
      console.log(`  ${chalk.yellow('!')} ${ext.file} → ${name}${desc}`);
      console.log(`      ${chalk.yellow(errors.join('; '))}`);
    } else {
      console.log(`  ${chalk.green('•')} ${name}${desc}`);
      console.log(`      ${chalk.dim(ext.file)}`);
    }
  }
  console.log();
}

async function extensionSave(srcPath) {
  console.log(BANNER);

  if (!srcPath) {
    console.error(chalk.red('\n  Usage: gspec extension save <path-to-extension.md>\n'));
    process.exit(1);
  }

  let content;
  try {
    content = await readFile(srcPath, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(chalk.red(`\n  File not found: ${srcPath}\n`));
      process.exit(1);
    }
    throw e;
  }

  const { fields } = parseFrontmatter(content);
  const ext = { file: basename(srcPath), fields };
  const errors = validateExtension(ext, await reservedSkillNames());
  if (errors.length > 0) {
    console.error(chalk.red(`\n  Cannot save extension: ${errors.join('; ')}\n`));
    process.exit(1);
  }

  await mkdir(EXTENSIONS_DIR, { recursive: true });
  const destPath = join(EXTENSIONS_DIR, `${fields.name}.md`);

  try {
    await stat(destPath);
    const overwrite = await promptConfirm(`Extension "${fields.name}" already exists. Overwrite?`);
    if (!overwrite) {
      console.log(chalk.dim('\n  Cancelled.\n'));
      return;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  await writeFile(destPath, content, 'utf-8');
  console.log(chalk.green(`\n  ✓ Saved extension to ~/.gspec/extensions/${fields.name}.md\n`));
  console.log(chalk.dim(`  It will be installed alongside core skills the next time you run "gspec" in a project.\n`));
}

async function extensionRemove(name) {
  console.log(BANNER);

  if (!name) {
    console.error(chalk.red('\n  Usage: gspec extension remove <name>\n'));
    process.exit(1);
  }

  const path = join(EXTENSIONS_DIR, `${name}.md`);
  try {
    await stat(path);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(chalk.red(`\n  Extension not found: ~/.gspec/extensions/${name}.md\n`));
      process.exit(1);
    }
    throw e;
  }

  await unlink(path);
  console.log(chalk.green(`\n  ✓ Removed ~/.gspec/extensions/${name}.md\n`));
  console.log(chalk.dim(`  Already-installed copies in projects (.claude/skills/, .cursor/commands/, etc.) are left in place — delete them manually if desired.\n`));
}

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

const memoryCmd = program
  .command('memory')
  .description('Show what gspec remembers: composed into your skills (personal + project), plus anything pending review');

memoryCmd
  .command('list', { isDefault: true })
  .description('List memory in ~/.gspec/memory/ (personal) and .gspec/memory/ (project), plus anything pending')
  .action(async () => {
    await memoryList(process.cwd());
  });

memoryCmd
  .command('report')
  .description('Show memories about gspec itself, with a prefilled GitHub issue link for each unsent one')
  .action(async () => {
    await memoryReport();
  });

memoryCmd
  .command('filed <name> <url>')
  .description('Record that a gspec report was filed, with its issue url')
  .action(async (name, url) => {
    await memoryFiled(name, url);
  });

memoryCmd
  .command('apply')
  .description('Recompose memory into the installed skills, without a full re-install')
  .action(async () => {
    const cwd = process.cwd();
    const config = await readProjectConfig(cwd);
    const targetName = config?.target;
    if (!targetName || !TARGETS[targetName]) {
      console.error(chalk.red(`\n  No gspec install found here (${PROJECT_CONFIG_PATH} has no target).`));
      console.error(chalk.dim('  Run `npx gspec -t <target>` first.\n'));
      process.exit(1);
    }
    const memory = await loadMemory(cwd);
    if (memory.size === 0) {
      console.log(chalk.dim('\n  Nothing to apply.\n'));
      return;
    }
    await applyMemory(targetName, cwd);
    console.log();
  });

const extensionCmd = program
  .command('extension')
  .description('Manage user-authored gspec extension skills in ~/.gspec/extensions/');

extensionCmd
  .command('list')
  .description('List installed extensions')
  .action(async () => {
    await extensionList();
  });

extensionCmd
  .command('save <path>')
  .description('Save a local .md skill file as a user extension in ~/.gspec/extensions/')
  .action(async (path) => {
    await extensionSave(path);
  });

extensionCmd
  .command('remove <name>')
  .description('Remove a user extension from ~/.gspec/extensions/ (does not uninstall already-emitted copies)')
  .action(async (name) => {
    await extensionRemove(name);
  });

program
  .command('build [idea]')
  .description('Run the autonomous "idea → built" build on Claude Code, Codex, or Pi')
  .option('--engine <name>', 'execution engine: claude | codex | pi (default: the target this project was installed for, else claude)')
  .option('--pi-permission-level <level>', 'Pi only: value for PI_PERMISSION_LEVEL if a stage stalls on tool approval')
  .option('--no-qa', 'skip the QA validator gates (on by default)')
  .option('--qa-retries <n>', 'self-heal revisions each QA gate may attempt before pausing (default: 1)')
  .option('--no-review', 'skip the spec-review pause before implementation (on by default)')
  .option('--research', 'run competitive research after the profile stage, for richer feature requirements (needs web access)')
  .option('--scope <tier>', 'how big this product is: small | standard | large — scales every spec\'s size budget (default: what the intake recorded, else standard)')
  .option('--resume', 'resume an existing run from where it paused')
  .option('--status', 'print how the current/last run ended and exit with its code (0 complete · 1 failed · 2 paused for review · 3 crashed)')
  .option('--dry-run', 'print the stage plan without invoking the engine')
  .action(async (idea, opts) => {
    // --status is a read: report the run's terminal state and exit with the
    // code that describes it, so a watcher branches on a number, not on prose.
    if (opts.status) {
      process.exitCode = await reportBuildStatus(process.cwd());
      return;
    }
    try {
      await runBuild({
        idea,
        cwd: process.cwd(),
        engine: opts.engine,
        piPermissionLevel: opts.piPermissionLevel,
        noQa: !opts.qa,
        noReview: !opts.review,
        research: !!opts.research,
        scope: opts.scope,
        qaRetries: opts.qaRetries,
        resume: !!opts.resume,
        dryRun: !!opts.dryRun,
      });
    } catch (e) {
      // Anything thrown before the run installs its own crash handlers (engine
      // resolution, preflight, intake). Report it as a failure rather than
      // letting node print a bare stack trace over a half-written run.
      console.error(chalk.red(`\n  ✗ gspec build could not run: ${e.message}\n`));
      process.exitCode = EXIT.FAILED;
    }
  });

program.parse();
