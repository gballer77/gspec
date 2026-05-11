import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Placeholder pattern used in generic command files
export const PLACEHOLDER_RE = /<<<\w+>>>/g;

export function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
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
    installDir: '.opencode/skills',
    layout: 'directory',
    // .opencode/skills/<name>/SKILL.md
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
};
