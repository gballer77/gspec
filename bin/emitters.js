import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Placeholder pattern used in generic command files
export const PLACEHOLDER_RE = /<<<\w+>>>/g;

// Emit a YAML scalar safely. Skill descriptions contain ": ", embedded "…"
// examples, and other characters that break unquoted plain scalars, so every
// value goes out as a double-quoted scalar with the minimal escape set
// required by the YAML 1.2 spec (backslash, double-quote, and control chars).
function yamlScalar(value) {
  const str = String(value);
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

export function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// Platform target definitions: how to emit a skill file for each AI tool.
// Used by both `scripts/build.js` (writing to dist/) and `bin/gspec.js`
// (writing user-installed extensions directly to a project's install dir).
export const TARGETS = {
  claude: {
    label: 'Claude Code',
    distSubdir: 'claude',
    installDir: '.claude/skills',
    layout: 'directory',
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
    label: 'Cursor',
    distSubdir: 'cursor',
    installDir: '.cursor/commands',
    layout: 'flat',
    fileExt: '.mdc',
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
    label: 'Antigravity',
    distSubdir: 'antigravity',
    installDir: '.agent/skills',
    layout: 'directory',
    // .agent/skills/<name>/SKILL.md
    async emit(outDir, content, meta) {
      const frontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const skillDir = join(outDir, meta.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
  codex: {
    label: 'Codex',
    distSubdir: 'codex',
    installDir: '.agents/skills',
    layout: 'directory',
    // .agents/skills/<name>/SKILL.md
    async emit(outDir, content, meta) {
      const frontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const skillDir = join(outDir, meta.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
  opencode: {
    label: 'Open Code',
    distSubdir: 'opencode',
    installDir: '.opencode',
    layout: 'dual',
    fileExt: '.md',
    // Dual emission — opencode splits Claude Code's skill behavior across two
    // mechanisms, so each prompt ships twice:
    //   .opencode/commands/<name>.md    slash command the user invokes (/gspec-*)
    //   .opencode/skills/<name>/SKILL.md skill the agent auto-loads by description
    // On a name collision opencode's slash menu prefers the file command, so
    // both can coexist safely.
    async emit(outDir, content, meta) {
      // opencode commands support $ARGUMENTS substitution, same as Claude Code
      const commandFrontmatter = buildFrontmatter({
        description: meta.description,
      });
      const commandBody = content.replace(PLACEHOLDER_RE, '$ARGUMENTS');
      const commandsDir = join(outDir, 'commands');
      await mkdir(commandsDir, { recursive: true });
      await writeFile(join(commandsDir, `${meta.name}.md`), commandFrontmatter + '\n\n' + commandBody, 'utf-8');

      // Skill content is loaded as context, not expanded as a template, so
      // strip the placeholder lines rather than mapping them to $ARGUMENTS
      const skillFrontmatter = buildFrontmatter({
        name: meta.name,
        description: meta.description,
      });
      const skillBody = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const skillDir = join(outDir, 'skills', meta.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), skillFrontmatter + '\n\n' + skillBody, 'utf-8');
    },
  },
};
