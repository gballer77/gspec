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

// Codex agent = a standalone TOML file (.codex/agents/<name>.toml). The system
// prompt is the INLINE, triple-quoted `developer_instructions`; `model` is
// omitted (Codex uses its own gpt ids); permission is `sandbox_mode` only. The
// persona is inlined into `body` upstream (Codex can only reference skills by
// filesystem path, which we can't assume at build time).
function tomlBasicString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
}
function codexSandbox(toolsStr) {
  const list = String(toolsStr || '').split(',').map((s) => s.trim().toLowerCase());
  return list.includes('write') || list.includes('edit') ? 'workspace-write' : 'read-only';
}
export function buildCodexAgent(meta, body) {
  const safe = body.replace(/'''/g, "'' '").trimEnd(); // guard the literal-string terminator
  return [
    `name = "${meta.name}"`,
    `description = ${tomlBasicString(meta.description)}`,
    `sandbox_mode = "${codexSandbox(meta.tools)}"`,
    "developer_instructions = '''",
    safe,
    "'''",
    '',
  ].join('\n');
}

// Cursor agent frontmatter: exactly name/description/model/readonly/is_background
// (no `tools` field — permission is the `readonly` boolean; model defaults to
// inherit). No skill preload, so the persona is inlined into the body upstream.
function cursorReadonly(toolsStr) {
  const list = String(toolsStr || '').split(',').map((s) => s.trim().toLowerCase());
  return !(list.includes('write') || list.includes('edit'));
}
export function buildCursorAgentFrontmatter(meta) {
  const lines = ['---'];
  lines.push(`name: ${meta.name}`);
  lines.push(`description: ${yamlScalar(meta.description)}`);
  lines.push('model: inherit');
  if (cursorReadonly(meta.tools)) lines.push('readonly: true');
  lines.push('---');
  return lines.join('\n');
}

// Pi agent frontmatter (the pi-subagents extension — `pi install npm:pi-subagents`,
// repo nicobailon/pi-subagents — the documented install prerequisite).
// Its loader REQUIRES both `name:` and `description:` in frontmatter and silently
// skips any agent file missing either; the frontmatter `name` is authoritative
// (the filename is not consulted). `tools` is a CSV allowlist of Pi's lowercase
// builtin tool ids (read, bash, edit, write, grep, find, ls — there is no glob;
// Claude's Glob maps to `find`); `model` is omitted so the sub-agent inherits
// Pi's configured default (Pi model ids are provider-specific — we can't assume
// one). Custom agents don't inherit skills by default, so the persona is inlined
// into the body upstream rather than preloaded.
const PI_BUILTIN_TOOLS = { read: 'read', write: 'write', edit: 'edit', grep: 'grep', glob: 'find', bash: 'bash' };
function piToolsCsv(toolsStr) {
  const raw = String(toolsStr || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (raw.length === 0) return '';
  const mapped = raw.map((t) => PI_BUILTIN_TOOLS[t]);
  // Web tools are extension-provided on Pi, not builtins — if any tool has no
  // builtin equivalent, omit the field (the child then gets Pi's normal builtins
  // plus extension tools) rather than emit a strict allowlist that would strip
  // the unmapped capability.
  if (mapped.some((m) => !m)) return '';
  return [...new Set(mapped)].join(', ');
}
export function buildPiAgentFrontmatter(meta) {
  const lines = ['---'];
  lines.push(`name: ${yamlScalar(meta.name)}`);
  lines.push(`description: ${yamlScalar(meta.description)}`);
  const tools = piToolsCsv(meta.tools);
  if (tools) lines.push(`tools: ${yamlScalar(tools)}`);
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
    // Claude is the only target with per-agent `memory:` — so it's the only one
    // that gets the learning-loop skills (gspec-memory) emitted + preloaded.
    learningLoop: true,
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
    installDir: '.cursor',
    layout: 'cursor',
    // Cursor 2.4+ has native sub-agents (.cursor/agents/<n>.md, markdown body =
    // prompt, no `tools` field — permission via `readonly`), skills
    // (.cursor/skills/<n>/SKILL.md), and commands (.cursor/commands/<n>.md — NO
    // frontmatter, no arg substitution). Agents can't preload skills, so the
    // persona is inlined into the body. (Fixes the old .mdc + frontmatter bug.)
    preloadsSkills: false,
    async emitSkill(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ name: meta.name, description: meta.description });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'skills', meta.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
    async emitAgent(outDir, content, meta) {
      const frontmatter = buildCursorAgentFrontmatter(meta);
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'agents');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
    },
    // Cursor commands: .md, NO frontmatter, no argument substitution.
    async emitCommand(outDir, content, meta) {
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'commands');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), body, 'utf-8');
    },
  },
  antigravity: {
    label: 'Antigravity',
    distSubdir: 'antigravity',
    installDir: '.agents',
    layout: 'antigravity',
    // Antigravity (Google) has NO agent FILES (sub-agents are spawned at runtime
    // via the Agent Manager / define_subagent). So personas/conventions are
    // SKILLS and each /gspec-* command is a self-contained WORKFLOW (the composed
    // body — nothing to delegate to). Current default dirs are PLURAL `.agents/`
    // (singular `.agent/` is the legacy fallback).
    async emitSkill(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ name: meta.name, description: meta.description });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'skills', meta.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
    // .agents/workflows/<name>.md — description frontmatter; invoke /<name>; no args
    async emitWorkflow(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ description: meta.description });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'workflows');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
  codex: {
    label: 'Codex',
    distSubdir: 'codex',
    installDir: '.agents/skills',
    layout: 'codex',
    // Codex has native sub-agents (TOML at .codex/agents/) + skills (.agents/
    // skills/). Its custom-prompt commands are deprecated, so /gspec-* entry
    // points are emitted as skills too. Agents can't reliably reference project-
    // relative skills, so the persona is inlined into developer_instructions.
    preloadsSkills: false,
    // Commands share the skills/ namespace here, so skip the standalone persona/
    // convention skill catalog (it's inlined into agents) to avoid name clashes.
    emitSkills: false,
    // dist: skills/<name>/SKILL.md  →  .agents/skills/<name>/SKILL.md
    async emitSkill(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ name: meta.name, description: meta.description });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'skills', meta.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
    // Commands become skills — Codex custom prompts are deprecated.
    async emitCommand(outDir, content, meta) {
      return this.emitSkill(outDir, content, meta);
    },
    // dist: agents/<name>.toml  →  .codex/agents/<name>.toml (persona inlined)
    async emitAgent(outDir, content, meta) {
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'agents');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.toml`), buildCodexAgent(meta, body), 'utf-8');
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
  pi: {
    label: 'Pi',
    distSubdir: 'pi',
    installDir: '.pi',
    layout: 'pi',
    fileExt: '.md',
    // Pi (pi.dev) gains sub-agents through the pi-subagents extension
    // (`pi install npm:pi-subagents`, repo nicobailon/pi-subagents), which
    // discovers agent definitions from .pi/agents/*.md — frontmatter `name:` and
    // `description:` are required or the file is silently skipped. gspec's v2
    // flow delegates to those sub-agents, so the extension is a prerequisite
    // (surfaced at install). Layout:
    //   .pi/prompts/<name>.md         prompt template the user invokes (/gspec-*)
    //   .pi/skills/<name>/SKILL.md    skill the agent auto-loads by description
    //   .pi/agents/<name>.md          sub-agent (pi-subagents extension)
    // pi-subagents' `skills:` frontmatter can preload named skills, but custom
    // agents don't inherit skills by default and the resolution rules are the
    // extension's, not ours — so, like opencode/cursor/codex, the persona is
    // inlined into each agent body upstream (see composeAgentBody in build.js).
    preloadsSkills: false,
    // .pi/skills/<name>/SKILL.md — persona/convention catalog (on-demand)
    async emitSkill(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ name: meta.name, description: meta.description });
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'skills', meta.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), frontmatter + '\n\n' + body, 'utf-8');
    },
    // .pi/agents/<name>.md — persona already inlined into `content` (build.js)
    async emitAgent(outDir, content, meta) {
      const frontmatter = buildPiAgentFrontmatter(meta);
      const body = content.replace(/^.*<<<\w+>>>.*$\n?/gm, '');
      const dir = join(outDir, 'agents');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
    },
    // .pi/prompts/<name>.md — prompt template; $ARGUMENTS substitution supported
    async emitCommand(outDir, content, meta) {
      const frontmatter = buildFrontmatter({ description: meta.description });
      const body = content.replace(PLACEHOLDER_RE, '$ARGUMENTS');
      const dir = join(outDir, 'prompts');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${meta.name}.md`), frontmatter + '\n\n' + body, 'utf-8');
    },
  },
};
