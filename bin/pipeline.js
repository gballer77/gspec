// gspec pipeline — deterministic orchestration runtime.
//
// Drives "idea -> built" by running each stage as an ISOLATED, headless Claude
// Code run (`claude -p --agent <name>`). The filesystem (the gspec/ documents)
// is the shared state between stages; this driver holds only control state in a
// run manifest (.gspec/pipeline/run.json), so nothing accumulates in a context
// window and a run is resumable after a crash or pause. See
// docs/gspec-v2-design.md §8 (Layer 4 — Runtime).
//
// Model: the pipeline is its own orchestrator. It invokes the AGENTS directly
// (writers, validators, transformers) and performs the orchestration the
// interactive commands normally do (writing plans, fanning out, gating) here in
// code — because the autonomous run has no human to converse with. The upfront
// intake is the one interactive step; everything after it runs unattended.

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';

const PIPELINE_DIR = join('.gspec', 'pipeline');
const MANIFEST_PATH = join(PIPELINE_DIR, 'run.json');
const BRIEF_PATH = join(PIPELINE_DIR, 'brief.md');

// The pipeline stage graph (design §8). Foundation stages are skip-if-present.
// `outputs` lets the driver detect an already-present spec and skip it.
export const STAGES = [
  { id: 'profile',      title: 'Product profile',  type: 'foundation', writer: 'profile-writer',      validator: 'profile-validator',      outputs: ['gspec/profile.md'] },
  { id: 'stack',        title: 'Technology stack',  type: 'foundation', writer: 'stack-writer',        validator: 'stack-validator',        outputs: ['gspec/stack.md'] },
  { id: 'practices',    title: 'Practices',         type: 'foundation', writer: 'practices-writer',    validator: 'practices-validator',    outputs: ['gspec/practices.md'] },
  { id: 'style',        title: 'Style guide',       type: 'foundation', writer: 'style-writer',        validator: 'style-validator',        outputs: ['gspec/style.md', 'gspec/style.html'] },
  { id: 'features',     title: 'Feature PRDs',      type: 'features',   writer: 'feature-writer',      validator: 'feature-validator' },
  { id: 'architecture', title: 'Architecture',      type: 'gated',      writer: 'architecture-writer', validator: 'architecture-validator', outputs: ['gspec/architecture.md'] },
  { id: 'plan',         title: 'Plans',             type: 'plan',       writer: 'plan-decomposer',     validator: 'plan-validator' },
  { id: 'implement',    title: 'Implementation',    type: 'implement',  agent: 'implementer' },
  { id: 'reconcile',    title: 'Reconcile audit',   type: 'audit',      agent: 'codebase-inspector' },
];

// --- small fs helpers -----------------------------------------------------

async function pathExists(cwd, rel) {
  try { await stat(join(cwd, rel)); return true; } catch { return false; }
}

async function listFeaturePrds(cwd) {
  try {
    const entries = await readdir(join(cwd, 'gspec', 'features'));
    return entries.filter((f) => f.endsWith('.md') && !f.endsWith('.plan.md'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// --- run manifest (control state) -----------------------------------------

async function loadManifest(cwd) {
  try {
    return JSON.parse(await readFile(join(cwd, MANIFEST_PATH), 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function saveManifest(cwd, manifest) {
  manifest.updatedAt = new Date().toISOString();
  await mkdir(join(cwd, PIPELINE_DIR), { recursive: true });
  await writeFile(join(cwd, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

function initManifest(idea, opts) {
  const stages = {};
  for (const s of STAGES) stages[s.id] = { status: 'pending', attempts: 0, verdict: null };
  return {
    idea,
    noQa: !!opts.noQa,
    permissionMode: opts.permissionMode || 'acceptEdits',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages,
  };
}

// --- Claude CLI invocation (the integration boundary) ---------------------
//
// Run the installed Claude Code CLI headlessly as a named agent. The agent's
// system prompt, preloaded skills, tools, and model come from its definition in
// .claude/agents/<name>.md; `prompt` is the brief/instruction for this run.
// Resolves { code, text } where text is the agent's final message (stdout).
//
// Verified against current Claude Code docs (headless.md, permission-modes.md,
// cli-reference.md): `-p` is print/headless; `--agent <name>` runs the session
// AS that agent (loading its .claude/agents/<name>.md prompt, skills, tools, and
// model — so we don't pass --model); `--permission-mode acceptEdits` auto-approves
// file edits (needed for writers). acceptEdits does NOT auto-approve arbitrary
// Bash, so stages whose agent runs commands (implement, audit) also pass
// `--allowedTools Bash`. Exit code 0 = success, non-zero = failure.

function buildAgentArgs(agentName, prompt, { permissionMode, model, allowedTools }) {
  const args = ['-p', prompt, '--agent', agentName, '--output-format', 'text', '--permission-mode', permissionMode];
  if (allowedTools) args.push('--allowedTools', allowedTools);
  if (model) args.push('--model', model);
  return args;
}

function runAgent(agentName, prompt, ctx, extra = {}) {
  const args = buildAgentArgs(agentName, prompt, {
    permissionMode: ctx.permissionMode,
    model: ctx.model || extra.model,
    allowedTools: extra.allowedTools,
  });
  return new Promise((resolve, reject) => {
    if (ctx.dryRun) {
      log(chalk.dim(`      would run: claude ${args.map((a) => (a === prompt ? '"<prompt>"' : a)).join(' ')}`));
      return resolve({ code: 0, text: 'VERDICT: PASS\n(dry run)' });
    }
    const child = spawn('claude', args, { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (d) => { text += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, text }));
  });
}

// Intake runs INTERACTIVELY (the user answers) — inherit stdio so they can
// converse. The intake session writes the resolved brief to brief.md.
function runIntake(idea, ctx) {
  if (ctx.dryRun) { log(chalk.dim('      would run interactive intake (claude)')); return Promise.resolve({ code: 0 }); }
  const prompt = [
    'You are the intake step of the gspec build pipeline.',
    `The idea to build: ${idea}`,
    'Interview the user ONCE to resolve the decisions the whole autonomous build pivots on:',
    'product type & primary audience, technology lean, visual style direction (or "no UI"), and scope boundaries.',
    'Offer 2-3 concrete suggestions per question. When everything load-bearing is resolved,',
    `write a concise brief — the idea plus every decision — to ${BRIEF_PATH}, then stop.`,
  ].join(' ');
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [prompt], { cwd: ctx.cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

function parseVerdict(text) {
  const m = String(text).match(/VERDICT:\s*(PASS|FAIL)/i);
  return m ? m[1].toUpperCase() : null;
}

// --- stage prompts --------------------------------------------------------

function stageBrief(stage, brief, extra = '') {
  return [
    `You are the "${stage.title}" stage of an autonomous gspec build. You cannot ask the user questions.`,
    'Use this resolved brief:',
    '',
    brief || '(no brief file found — infer reasonable decisions from the specs already present)',
    '',
    extra,
    'Produce your deliverable per your agent instructions. Make reasonable, clearly-labeled assumptions and record any deferred decisions; do not block.',
  ].join('\n');
}

function validatorPrompt(stage, target = '') {
  return `Validate ${target || `the ${stage.title}`} against its quality bar and return the structured verdict (first line "VERDICT: PASS" or "VERDICT: FAIL", then findings).`;
}

// --- the self-healing writer -> validator gate ----------------------------

async function gate(stage, writerPrompt, validatorTarget, ctx) {
  let out = await runAgent(stage.writer, writerPrompt, ctx);
  if (out.code !== 0) return { status: 'failed', reason: `${stage.writer} exited ${out.code}` };
  if (ctx.noQa || !stage.validator) return { status: 'done', verdict: ctx.noQa ? 'skipped' : null };

  let v = await runAgent(stage.validator, validatorPrompt(stage, validatorTarget), ctx);
  if (parseVerdict(v.text) === 'PASS') return { status: 'done', verdict: 'PASS' };

  // one self-heal revision from the verdict
  log(chalk.yellow(`      QA flagged issues — one revision…`));
  const revise = `${writerPrompt}\n\nA prior draft failed QA. Revise to address this verdict:\n${v.text}`;
  out = await runAgent(stage.writer, revise, ctx);
  if (out.code !== 0) return { status: 'failed', reason: `${stage.writer} (revision) exited ${out.code}` };
  v = await runAgent(stage.validator, validatorPrompt(stage, validatorTarget), ctx);
  if (parseVerdict(v.text) === 'PASS') return { status: 'done', verdict: 'PASS' };
  return { status: 'failed', reason: 'QA gate did not pass after one revision', verdict: parseVerdict(v.text) || 'unknown' };
}

// --- per-type stage handlers ----------------------------------------------

async function runStage(stage, ctx) {
  const brief = ctx.brief;
  switch (stage.type) {
    case 'foundation': {
      for (const out of stage.outputs) {
        if (await pathExists(ctx.cwd, out)) return { status: 'skipped', reason: `${out} already exists` };
      }
      return gate(stage, stageBrief(stage, brief), '', ctx);
    }
    case 'gated':
      return gate(stage, stageBrief(stage, brief), '', ctx);

    case 'features': {
      const w = await runAgent(stage.writer, stageBrief(stage, brief, 'Write the feature PRD(s) for this idea into gspec/features/.'), ctx);
      if (w.code !== 0) return { status: 'failed', reason: `${stage.writer} exited ${w.code}` };
      if (ctx.noQa) return { status: 'done', verdict: 'skipped' };
      const prds = await listFeaturePrds(ctx.cwd);
      for (const prd of prds) {
        const target = `gspec/features/${prd}`;
        const v = await runAgent(stage.validator, validatorPrompt(stage, target), ctx);
        if (parseVerdict(v.text) === 'FAIL') {
          const revise = `${stageBrief(stage, brief)}\n\nThe PRD ${target} failed QA. Revise it to address:\n${v.text}`;
          await runAgent(stage.writer, revise, ctx);
          const v2 = await runAgent(stage.validator, validatorPrompt(stage, target), ctx);
          if (parseVerdict(v2.text) !== 'PASS') return { status: 'failed', reason: `QA gate failed for ${target}` };
        }
      }
      return { status: 'done', verdict: 'PASS' };
    }

    case 'plan': {
      const prds = await listFeaturePrds(ctx.cwd);
      if (prds.length === 0) return { status: 'skipped', reason: 'no feature PRDs to plan' };
      for (const prd of prds) {
        const slug = prd.replace(/\.md$/, '');
        if (await pathExists(ctx.cwd, `gspec/features/${slug}.plan.md`)) continue;
        // plan-decomposer returns the plan draft body; the driver writes it
        // (autonomous mode auto-approves — no interactive plan-mode gate).
        const d = await runAgent(stage.writer, `Decompose the feature "${slug}" (gspec/features/${slug}.md) into an ordered plan. Return ONLY the plan file body (frontmatter + ## Plan).`, ctx);
        if (d.code !== 0) return { status: 'failed', reason: `${stage.writer} exited ${d.code}` };
        if (!ctx.dryRun) await writeFile(join(ctx.cwd, 'gspec', 'features', `${slug}.plan.md`), extractPlanBody(d.text), 'utf-8');
        if (!ctx.noQa) {
          const v = await runAgent(stage.validator, validatorPrompt(stage, `gspec/features/${slug}.plan.md`), ctx);
          if (parseVerdict(v.text) === 'FAIL') log(chalk.yellow(`      plan for ${slug} has QA notes (continuing)`));
        }
      }
      return { status: 'done', verdict: ctx.noQa ? 'skipped' : 'PASS' };
    }

    case 'implement': {
      const out = await runAgent(stage.agent, stageBrief(stage, brief, 'Implement all in-scope, unchecked work. Scaffold if greenfield; write and run tests; flip checkboxes as you go.'), ctx, { allowedTools: 'Bash' });
      // code isn't a spec — the checker is tests + the DoD, run inside the agent.
      return { status: out.code === 0 ? 'done' : 'failed', verdict: 'n/a', reason: out.code === 0 ? undefined : `${stage.agent} exited ${out.code}` };
    }

    case 'audit': {
      const out = await runAgent(stage.agent, 'Inspect the codebase for drift vs the specs and orphan capabilities; return an impact-ordered findings report. Do not modify anything.', ctx, { allowedTools: 'Bash' });
      return { status: out.code === 0 ? 'done' : 'failed', verdict: 'report', reason: out.code === 0 ? undefined : `${stage.agent} exited ${out.code}` };
    }

    default:
      return { status: 'failed', reason: `unknown stage type ${stage.type}` };
  }
}

// The decomposer returns the plan body possibly wrapped in prose/fences; keep
// from the first frontmatter/heading onward.
function extractPlanBody(text) {
  const fence = text.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/^---\s*$|^#\s|^##\s+Plan/m);
  return (start >= 0 ? body.slice(start) : body).trim() + '\n';
}

// --- driver ---------------------------------------------------------------

function log(msg) { console.log(msg); }

export async function runPipeline({ idea, cwd = process.cwd(), noQa = false, resume = false, dryRun = false, permissionMode = 'acceptEdits' }) {
  let manifest = await loadManifest(cwd);

  if (manifest && !resume && !dryRun) {
    console.error(chalk.red('\n  A pipeline run already exists (.gspec/pipeline/run.json).'));
    console.error(chalk.dim('  Re-run with --resume to continue it, or remove that file to start over.\n'));
    process.exit(1);
  }
  if (!manifest) {
    if (!idea) { console.error(chalk.red('\n  An idea is required to start: gspec pipeline "<idea>"\n')); process.exit(1); }
    manifest = initManifest(idea, { noQa, permissionMode });
    await saveManifest(cwd, manifest);
  }

  const ctx = { cwd, noQa: manifest.noQa, permissionMode: manifest.permissionMode, dryRun, brief: '' };

  log(chalk.bold(`\n  gspec pipeline — ${chalk.cyan(manifest.idea)}`));
  log(chalk.dim(`  QA gates: ${manifest.noQa ? 'off (--no-qa)' : 'on'} · resumable · ${dryRun ? 'DRY RUN' : 'autonomous after intake'}\n`));

  // Intake (once) — interactive; writes the brief the autonomous run consumes.
  if (!(await pathExists(cwd, BRIEF_PATH))) {
    log(chalk.bold('  ▸ Intake') + chalk.dim(' (one interview, then unattended)'));
    const r = await runIntake(manifest.idea, ctx);
    if (r.code !== 0 && !dryRun) { console.error(chalk.red('  Intake did not complete — aborting.')); process.exit(1); }
  }
  ctx.brief = await readBrief(cwd);

  // Stage loop — resume skips done/skipped stages.
  for (const stage of STAGES) {
    const st = manifest.stages[stage.id];
    if (st.status === 'done' || st.status === 'skipped') { log(chalk.dim(`  ✓ ${stage.title} — ${st.status}`)); continue; }

    log(chalk.bold(`  ▸ ${stage.title}`));
    st.status = 'running'; st.attempts += 1; await saveManifest(cwd, manifest);

    let result;
    try {
      result = await runStage(stage, ctx);
    } catch (e) {
      result = { status: 'failed', reason: e.message };
    }

    Object.assign(st, result);
    await saveManifest(cwd, manifest);

    if (result.status === 'failed') {
      log(chalk.red(`  ✗ ${stage.title} — ${result.reason || 'failed'}`));
      log(chalk.yellow('\n  Paused. Fix the issue, then re-run with --resume to continue from here.\n'));
      process.exit(1);
    }
    log(chalk[result.status === 'skipped' ? 'dim' : 'green'](`  ${result.status === 'skipped' ? '↷' : '✓'} ${stage.title} — ${result.verdict || result.status}`));
  }

  log(chalk.bold.green('\n  ✓ Pipeline complete.'));
  log(chalk.dim(`  Specs + code are in place; see .gspec/pipeline/run.json for the run record.\n`));
}

async function readBrief(cwd) {
  try { return await readFile(join(cwd, BRIEF_PATH), 'utf-8'); } catch { return ''; }
}
