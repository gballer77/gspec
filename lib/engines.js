// gspec build — pluggable execution engines.
//
// The build drives "idea → built" by running each stage as an ISOLATED,
// headless agent run. WHICH CLI performs that run is abstracted here so the
// same driver (lib/build.js) can build on Claude Code, Codex, or Pi. Each
// engine adapter owns its binary, its headless + interactive invocation, how it
// runs a stage AS a named gspec agent, and how it gates tool permissions.
//
// Agent-invocation strategy differs by tool (verified against each CLI's docs):
//   • claude — native `--agent <name>` loads .claude/agents/<name>.md (persona,
//     preloaded skills, tools, model). The richest path; unchanged from the
//     original driver.
//   • codex  — `codex exec` has NO agent-selection flag. We read the installed
//     .codex/agents/<name>.toml, extract its `developer_instructions` (the build
//     already inlines the full persona there), and inject them ahead of the
//     prompt. Permissions map onto `--sandbox`.
//   • pi     — `pi -p` (print mode) has NO agent-selection flag, and the
//     pi-subagents extension can only be reached from inside a live session. We
//     read the installed .pi/agents/<name>.md body (persona already inlined) and
//     inject it. `-a` trusts the project-local files for the run.
//
// Every adapter resolves to { code, text } where `text` is the final assistant
// message captured from stdout, so the driver's VERDICT parsing stays
// engine-agnostic. Interactive runs (intake) resolve to { code }.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';

// --- shared spawn plumbing -------------------------------------------------

// Headless run: capture stdout as the agent's final message; inherit stderr so
// the engine's own progress stream still reaches the user's terminal.
function spawnCapture(bin, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let text = '';
    child.stdout.on('data', (d) => { text += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, text }));
  });
}

// Interactive run (intake): inherit all stdio so the user can converse.
function spawnInteractive(bin, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

// Render a would-run line for --dry-run without dumping the (possibly huge)
// injected prompt.
function preview(bin, args, promptArg) {
  const shown = args.map((a) => (a === promptArg ? '"<prompt>"' : /\s/.test(a) ? '"…"' : a));
  return `${bin} ${shown.join(' ')}`;
}
function dryRun(ctx, bin, args, promptArg) {
  ctx.log(chalk.dim(`      would run: ${preview(bin, args, promptArg)}`));
  return Promise.resolve({ code: 0, text: 'VERDICT: PASS\n(dry run)' });
}
function dryInteractive(ctx, bin) {
  ctx.log(chalk.dim(`      would run interactive intake (${bin})`));
  return Promise.resolve({ code: 0 });
}

// --- agent-instruction injection (codex/pi) --------------------------------
//
// Codex and Pi cannot start a headless session AS a named agent, so we read the
// agent's fully-composed instruction body from the file the installer wrote and
// inject it ahead of the stage prompt. That body IS the agent (the build inlines
// the persona for these targets), so a plain headless run becomes that agent.

function stripFrontmatter(md) {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/);
  return (m ? md.slice(m[0].length) : md).trim();
}

// developer_instructions = '''…''' in a Codex agent TOML (buildCodexAgent).
function codexInstructions(toml) {
  const m = toml.match(/developer_instructions\s*=\s*'''\n?([\s\S]*?)'''/);
  return m ? m[1].trim() : '';
}

async function readInjectedAgent(cwd, relPath, extract) {
  let raw;
  try {
    raw = await readFile(join(cwd, relPath), 'utf-8');
  } catch {
    throw new Error(`agent file not found: ${relPath} — install gspec for this engine first (gspec install)`);
  }
  const body = extract(raw);
  if (!body) throw new Error(`could not read agent instructions from ${relPath}`);
  return body;
}

// The agent's instructions become the operating brief; the stage prompt follows.
function inject(instructions, prompt) {
  return `${instructions}\n\n---\n\nYour task for this run:\n\n${prompt}`;
}

// --- engine adapters -------------------------------------------------------

export const ENGINES = {
  claude: {
    name: 'claude',
    binary: 'claude',
    // Where `gspec install -t claude` puts an agent definition. Claude may also
    // get its agents from the gspec plugin, so a missing file here is a hint,
    // not proof the agent is unavailable (see the build preflight).
    agentFile: (name) => join('.claude', 'agents', `${name}.md`),
    // Native agent selection: --agent loads the whole definition (skills/tools/
    // model), so we don't inject anything or pass --model.
    async runAgent(agentName, prompt, ctx, { needsBash } = {}) {
      const args = ['-p', prompt, '--agent', agentName, '--output-format', 'text', '--permission-mode', ctx.permissionMode];
      if (needsBash) args.push('--allowedTools', 'Bash');
      if (ctx.model) args.push('--model', ctx.model);
      if (ctx.dryRun) return dryRun(ctx, 'claude', args, prompt);
      return spawnCapture('claude', args, { cwd: ctx.cwd });
    },
    runInteractive(prompt, ctx) {
      if (ctx.dryRun) return dryInteractive(ctx, 'claude');
      return spawnInteractive('claude', [prompt], { cwd: ctx.cwd });
    },
  },

  codex: {
    name: 'codex',
    binary: 'codex',
    agentFile: (name) => join('.codex', 'agents', `${name}.toml`),
    async runAgent(agentName, prompt, ctx, { needsBash } = {}) {
      // workspace-write auto-approves edits + in-workspace commands but blocks
      // network; stages that run installs/tests (needsBash) get full access.
      const sandbox = needsBash ? 'danger-full-access' : 'workspace-write';
      const head = ['exec', '--sandbox', sandbox, ...(ctx.model ? ['--model', ctx.model] : [])];
      if (ctx.dryRun) return dryRun(ctx, 'codex', [...head, `<${agentName}>`], `<${agentName}>`);
      const instructions = await readInjectedAgent(ctx.cwd, this.agentFile(agentName), codexInstructions);
      const full = inject(instructions, prompt);
      // codex exec streams progress to stderr, final message to stdout.
      return spawnCapture('codex', [...head, full], { cwd: ctx.cwd });
    },
    runInteractive(prompt, ctx) {
      if (ctx.dryRun) return dryInteractive(ctx, 'codex');
      return spawnInteractive('codex', [prompt], { cwd: ctx.cwd });
    },
  },

  pi: {
    name: 'pi',
    binary: 'pi',
    agentFile: (name) => join('.pi', 'agents', `${name}.md`),
    async runAgent(agentName, prompt, ctx, { needsBash } = {}) { // eslint-disable-line no-unused-vars
      // -p = print/headless; -a trusts project-local files (skills/agents) for
      // this run. Base Pi does not document a print-mode tool auto-approve flag,
      // so if a stage stalls on a tool prompt, set PI_PERMISSION_LEVEL (via
      // ctx.piPermissionLevel) or install a permission extension. See the
      // build runtime docs (§8) for the current status of this gap.
      const head = ['-p', '-a', ...(ctx.model ? ['--model', ctx.model] : [])];
      if (ctx.dryRun) return dryRun(ctx, 'pi', [...head, `<${agentName}>`], `<${agentName}>`);
      const instructions = await readInjectedAgent(ctx.cwd, this.agentFile(agentName), stripFrontmatter);
      const full = inject(instructions, prompt);
      const env = ctx.piPermissionLevel ? { PI_PERMISSION_LEVEL: ctx.piPermissionLevel } : undefined;
      return spawnCapture('pi', [...head, full], { cwd: ctx.cwd, env });
    },
    runInteractive(prompt, ctx) {
      if (ctx.dryRun) return dryInteractive(ctx, 'pi');
      return spawnInteractive('pi', [prompt], { cwd: ctx.cwd });
    },
  },
};

export const ENGINE_NAMES = Object.keys(ENGINES);

export function getEngine(name = 'claude') {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`unknown engine "${name}" — valid: ${ENGINE_NAMES.join(', ')}`);
  return engine;
}
