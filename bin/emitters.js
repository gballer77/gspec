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

// Agent frontmatter differs from skill frontmatter: it carries a `skills:` list
// (emitted as a YAML flow list of bare slugs), a `tools` comma string, and
// optional `model`/`memory` scalars. name/model/memory are simple slugs emitted
// unquoted; description goes out as a quoted scalar (it contains ": " and "…").
export function buildAgentFrontmatter(meta) {
  const lines = ['---'];
  lines.push(`name: ${meta.name}`);
  lines.push(`description: ${yamlScalar(meta.description)}`);
  if (meta.skills && meta.skills.length) lines.push(`skills: [${meta.skills.join(', ')}]`);
  if (meta.tools) lines.push(`tools: ${meta.tools}`);
  if (meta.model) lines.push(`model: ${meta.model}`);
  if (meta.memory) lines.push(`memory: ${meta.memory}`);
  lines.push('---');
  return lines.join('\n');
}

// OpenCode agent frontmatter. OpenCode has no `skills:` preload and no per-agent
// memory; the persona is inlined into the body upstream. `tools` is a boolean
// MAP (not a list); `model` is omitted so OpenCode uses its configured default
// (its ids are provider/model-id, which we can't assume). name comes from the
// filename. Read/grep/glob/list default to allowed; we only restrict the rest.
function opencodeToolsMap(toolsStr) {
  const list = String(toolsStr || '').split(',').map((s) => s.trim().toLowerCase());
  const has = (t) => list.includes(t);
  const write = has('write') || has('edit');
  return { write, edit: write, bash: has('bash'), webfetch: has('webfetch'), websearch: has('websearch') };
}

export function buildOpenCodeAgentFrontmatter(meta) {
  const lines = ['---'];
  lines.push(`description: ${yamlScalar(meta.description)}`);
  lines.push('mode: subagent');
  lines.push('tools:');
  for (const [k, v] of Object.entries(opencodeToolsMap(meta.tools))) lines.push(`  ${k}: ${v}`);
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
    // Claude subagents preload skills via the `skills:` frontmatter field, so
    // v2 agents keep their persona out-of-line (as reusable skills).
    preloadsSkills: true,
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
    async emitSkill(outDir, content, meta) {
      return this.emit(outDir, content, meta);
    },
    // v2: agents install to .claude/agents/<name>.md
    async emitAgent(outDir, content, meta) {
      const frontmatter = buildAgentFrontmatter(meta);
      // Agents receive a delegated brief, not slash-command args — drop any
      // leftover <<<PLACEHOLDER>>> lines rather than mapping them to $ARGUMENTS.
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'agents');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
    },
    // v2: commands install to .claude/commands/<name>.md and support $ARGUMENTS
    async emitCommand(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ description: meta.description });
      const body = content.replace(PLACEHOLDER_RE, '$ARGUMENTS');
      const dir = join(outDir, 'commands');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
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
    layout: 'opencode',
    fileExt: '.md',
    // OpenCode has native sub-agents + skills + commands (it converged on Claude
    // Code's model), but agents CANNOT preload skills — so the persona is inlined
    // into each agent body upstream (see composeAgentBody in build.js). Dirs:
    // agent/ + command/ (singular, per the loader/CLI) and skills/ (plural).
    preloadsSkills: false,
    // .opencode/skills/<name>/SKILL.md — persona/convention catalog (on-demand)
    async emitSkill(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ name: meta.name, description: meta.description });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'skills', meta.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
    // .opencode/agent/<name>.md — the persona is already inlined into `content`
    async emitAgent(outDir, content, meta) {
      const frontmatter = buildOpenCodeAgentFrontmatter(meta);
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'agent');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
    },
    // .opencode/command/<name>.md — native delegation to agents; $ARGUMENTS ok
    async emitCommand(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ description: meta.description });
      const body = content.replace(PLACEHOLDER_RE, '$ARGUMENTS');
      const dir = join(outDir, 'command');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
};
