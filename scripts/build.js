#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from '../bin/emitters.js';
import { V2_SKILLS, V2_AGENTS, V2_COMMANDS, V2_TARGETS, DEGRADE_CAPABILITIES } from '../manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const DIST_DIR = join(ROOT, 'dist');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));

// Version placeholder — replaced before platform-specific transforms
const VERSION_RE = /<<<VERSION>>>/g;
const SPEC_VERSION = 'v1';
const SPEC_VERSION_RE = /<<<SPEC_VERSION>>>/g;

// Metadata for each command, keyed by source filename
const COMMANDS = {
  'gspec.profile.md': {
    name: 'gspec-profile',
    description: 'Generate or update gspec/profile.md — what the product is, who it serves, and why. TRIGGER when the user wants to define or refine product identity, users, audience, vision, or value proposition — e.g. "define my product", "what is this app".',
  },
  'gspec.feature.md': {
    name: 'gspec-feature',
    description: 'Generate PRDs for features in gspec/features/. TRIGGER when the user wants to plan, spec, propose, or document a feature before coding — e.g. "add a feature for X", "write a PRD", "spec out Y", "plan this feature", "draft requirements".',
  },
  'gspec.plan.md': {
    name: 'gspec-plan',
    description: 'Decompose a feature PRD into an ordered, dependency-aware plan with parallel-execution markers, written to <feature>.plan.md. Runs between gspec-feature and gspec-implement. TRIGGER when the user wants to sequence work or build a plan from a PRD.',
  },
  'gspec.style.md': {
    name: 'gspec-style',
    description: 'Generate or update the visual style guide (gspec/style.html or gspec/style.md) — tokens, palette, typography, spacing, components. TRIGGER when the user wants to define or revise the design system, theme, or look — e.g. "pick brand colors".',
  },
  'gspec.stack.md': {
    name: 'gspec-stack',
    description: 'Define or update gspec/stack.md — frameworks, libraries, databases, hosting, CI/CD, and infrastructure. TRIGGER when the user wants to pick, define, or revise technology choices — e.g. "what stack should I use", "pick a framework".',
  },
  'gspec.practices.md': {
    name: 'gspec-practices',
    description: 'Define or update gspec/practices.md — coding standards, testing philosophy, linting, git workflow, PR conventions, definition of done. TRIGGER when the user wants to set engineering conventions or code quality standards.',
  },
  'gspec.architect.md': {
    name: 'gspec-architect',
    description: 'Define or update gspec/architecture.md — project structure, data model, API design, component hierarchy, and environment/config. TRIGGER when the user wants to design or document codebase structure before implementation.',
  },
  'gspec.analyze.md': {
    name: 'gspec-analyze',
    description: 'Analyze gspec/ for cross-spec contradictions across profile, stack, style, practices, architecture, features. With a feature slug, narrows to that PRD plus an ambiguity sweep. TRIGGER to cross-check or reconcile specs, or find gaps in a PRD.',
  },
  'gspec.audit.md': {
    name: 'gspec-audit',
    description: 'Audit gspec/ against the codebase to find drift, then reconcile each discrepancy. Detects orphan capabilities (features the code implements with no PRD). TRIGGER to check specs against code, sync with reality, or find unspecced features.',
  },
  'gspec.research.md': {
    name: 'gspec-research',
    description: 'Research competitors from gspec/profile.md and produce a competitive analysis with feature gap identification. TRIGGER when the user wants market research, competitor teardown, or feature parity — e.g. "research competitors", "find feature gaps".',
  },
  'gspec.implement.md': {
    name: 'gspec-implement',
    description: 'Implement software defined by gspec/ specs — phased build with tests and checkpoints. STRONGLY TRIGGER when the user asks to build, implement, code, scaffold, or ship specced work, or references an unchecked capability in gspec/features/*.md.',
  },
  'gspec.migrate.md': {
    name: 'gspec-migrate',
    description: 'Migrate gspec/ files to the current spec format when upgrading gspec. TRIGGER when the user sees an outdated-version warning or asks to upgrade specs — e.g. "migrate my specs", "my specs are outdated", "fix the spec-version warning".',
  },
};

// Frontmatter description cap.
//
// Claude Code is the tightest constraint we ship to: descriptions are
// truncated to 250 characters when injected into the system prompt for
// skill selection (anything past char 250 is silently dropped when Claude
// decides whether to invoke a skill). The documented hard caps for
// Claude Code and OpenCode are both 1024, but 250 is the *effective* limit
// for trigger matching, so we enforce it as the hard cap to keep all our
// skill descriptions within the window where Claude actually reads them.
const DESCRIPTION_MAX = 250;

function validateCommands(commands) {
  const errors = [];
  for (const [file, meta] of Object.entries(commands)) {
    if (!meta.name) errors.push(`${file}: missing name`);
    if (!meta.description) {
      errors.push(`${file}: missing description`);
      continue;
    }
    const len = meta.description.length;
    if (len > DESCRIPTION_MAX) {
      errors.push(`${file}: description is ${len} chars, exceeds cap of ${DESCRIPTION_MAX} (Claude Code truncates to ${DESCRIPTION_MAX} for skill selection — content past that is dropped when Claude decides whether to invoke the skill)`);
    }
  }
  return errors;
}

// v2 manifest validation — skill/command descriptions share the same effective
// cap as legacy (auto-invocation truncation); agents have no cap but must carry
// name/description and a non-empty skills[] preload list.
function validateV2() {
  const errors = [];
  for (const meta of [...V2_SKILLS, ...V2_COMMANDS]) {
    if (!meta.name) errors.push(`v2 ${meta.source || '?'}: missing name`);
    if (!meta.description) { errors.push(`v2 ${meta.name || meta.source}: missing description`); continue; }
    if (meta.description.length > DESCRIPTION_MAX) {
      errors.push(`v2 ${meta.name}: description is ${meta.description.length} chars, exceeds cap of ${DESCRIPTION_MAX}`);
    }
  }
  for (const meta of V2_AGENTS) {
    if (!meta.name) errors.push(`v2 agent ${meta.source || '?'}: missing name`);
    if (!meta.description) errors.push(`v2 agent ${meta.name || meta.source}: missing description`);
    if (!meta.skills || meta.skills.length === 0) errors.push(`v2 agent ${meta.name}: missing skills[] preload list`);
  }
  return errors;
}

async function readSource(relPath) {
  const raw = await readFile(join(ROOT, relPath), 'utf-8');
  return raw.replace(VERSION_RE, pkg.version).replace(SPEC_VERSION_RE, SPEC_VERSION);
}

// Emit the v2 artifact classes for a v2-enabled target. Skills reuse the skill
// emitter; agents and commands use their dedicated emitters.
async function emitV2(target, outDir) {
  let skills = 0, agents = 0, commands = 0;
  // Persona/convention skill catalog. Skipped where commands share the skills
  // namespace (Codex) — there the persona is inlined into agents, so a standalone
  // catalog would only collide with the command-skills.
  if (target.emitSkills !== false) {
    for (const meta of V2_SKILLS) { await target.emitSkill(outDir, await readSource(meta.source), meta); skills++; }
  }
  for (const meta of V2_AGENTS) {
    // Claude preloads skills via `skills:` frontmatter; targets that can't (e.g.
    // OpenCode) get the persona inlined into the agent body.
    const body = target.preloadsSkills ? await readSource(meta.source) : await composeAgentBody(meta);
    await target.emitAgent(outDir, body, meta);
    agents++;
  }
  for (const meta of V2_COMMANDS) { await target.emitCommand(outDir, await readSource(meta.source), meta); commands++; }
  console.log(`  + v2: ${skills} skills, ${agents} agents, ${commands} commands → dist/${target.distSubdir}/`);
}

// Inline an agent's persona/convention skills into its body, for targets whose
// agents can't preload skills (OpenCode). Claude uses the `skills:` field instead.
async function composeAgentBody(agent) {
  const names = agent.skills || [];
  if (names.length === 0) return readSource(agent.source);
  const parts = ['> **Persona & conventions** (inlined — this platform does not preload skills; apply all of the following throughout your work).'];
  for (const name of names) {
    const s = V2_SKILLS.find((x) => x.name === name);
    if (s) parts.push(`\n## ${name}\n\n${await readSource(s.source)}`);
  }
  parts.push('\n---\n\n# Your task\n');
  parts.push(await readSource(agent.source));
  return parts.join('\n');
}

// --- degrade (non-Claude targets) -----------------------------------------
//
// Targets without sub-agents get ONE self-contained composed file per
// capability, assembled from the v2 sources so there's a single source of truth.

const DEGRADE_PREAMBLE = `> **Single-file mode.** On this platform gspec runs as one self-contained prompt — there are no separate sub-agents. Perform the whole flow yourself: where a step says "delegate to the … agent," do that work directly using the **task & output** reference below; where it describes a **QA gate**, self-review your result against the **quality self-review** reference (there is no separate validator). Apply the **persona & conventions** reference throughout.`;

const dedup = (arr) => [...new Set(arr)];

// Compose one degraded artifact: command flow + its persona/convention skills +
// the primary agent's task + (folded in as self-review) its validator.
async function composeDegraded(cap) {
  const cmd = V2_COMMANDS.find((c) => c.name === cap.command);
  const produce = cap.produce ? V2_AGENTS.find((a) => a.name === cap.produce) : null;
  const check = cap.check ? V2_AGENTS.find((a) => a.name === cap.check) : null;
  const also = cap.also ? V2_AGENTS.find((a) => a.name === cap.also) : null;
  const skillNames = cap.skills || dedup([...(produce?.skills || []), ...(check?.skills || [])]);

  const parts = [DEGRADE_PREAMBLE, '', await readSource(cmd.source)];

  if (skillNames.length) {
    parts.push('\n---\n\n# Reference — persona & conventions');
    for (const name of skillNames) {
      const s = V2_SKILLS.find((x) => x.name === name);
      if (s) parts.push(`\n## ${name}\n\n${await readSource(s.source)}`);
    }
  }

  const taskAgents = [produce, also].filter(Boolean);
  if (taskAgents.length) {
    parts.push('\n---\n\n# Reference — task & output');
    for (const a of taskAgents) parts.push(`\n## ${a.name}\n\n${await readSource(a.source)}`);
  }

  if (check) parts.push(`\n---\n\n# Reference — quality self-review\n\n${await readSource(check.source)}`);

  return parts.join('\n');
}

async function build(targetNames) {
  const errors = [...validateCommands(COMMANDS), ...validateV2()];
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`);
    process.exit(1);
  }

  for (const targetName of targetNames) {
    const target = TARGETS[targetName];
    if (!target) {
      console.error(`Unknown target: ${targetName}`);
      process.exit(1);
    }

    const outDir = join(DIST_DIR, target.distSubdir);

    if (V2_TARGETS.has(targetName)) {
      // Full v2 split: skills + agents + commands (Claude Code).
      await emitV2(target, outDir);
      console.log(`Built v2 split → dist/${targetName}/`);
    } else {
      // Degrade: one self-contained composed file per capability, emitted in the
      // target's native format by its existing emit().
      let count = 0;
      for (const cap of DEGRADE_CAPABILITIES) {
        const meta = V2_COMMANDS.find((c) => c.name === cap.command);
        await target.emit(outDir, await composeDegraded(cap), { name: meta.name, description: meta.description });
        count++;
      }
      console.log(`Built ${count} composed capabilities → dist/${targetName}/ (degrade)`);
    }
  }
}

// Build all targets by default, or specific ones via CLI args
const requested = process.argv.slice(2);
const targetNames = requested.length > 0 ? requested : Object.keys(TARGETS);

build(targetNames).catch(err => {
  console.error(err);
  process.exit(1);
});
