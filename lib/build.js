// gspec build — deterministic orchestration runtime.
//
// Drives "idea -> built" by running each stage as an ISOLATED, headless agent
// run. WHICH CLI performs that run (Claude Code, Codex, or Pi) is abstracted
// behind an engine adapter (lib/engines.js); this driver is engine-agnostic.
// The filesystem (the gspec/ documents) is the shared state between stages;
// this driver holds only control state in a run manifest
// (.gspec/build/run.json), so nothing accumulates in a context window and a
// run is resumable after a crash or pause. See docs/gspec-v2-design.md §8
// (Layer 4 — Runtime).
//
// Model: the build is its own orchestrator. It invokes the AGENTS directly
// (writers, validators, transformers) and performs the orchestration the
// interactive commands normally do (writing plans, fanning out, gating) here in
// code — because the autonomous run has no human to converse with. The upfront
// intake is the one interactive step; everything after it runs unattended.

import { spawn } from 'node:child_process';
import { writeFile, mkdir, stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { getEngine } from './engines.js';

const BUILD_DIR = join('.gspec', 'build');
const MANIFEST_PATH = join(BUILD_DIR, 'run.json');
const BRIEF_PATH = join(BUILD_DIR, 'brief.md');

// The build stage graph (design §8). Foundation stages are skip-if-present.
// `outputs` lets the driver detect an already-present spec and skip it.
export const STAGES = [
  { id: 'profile',      title: 'Product profile',  type: 'foundation', writer: 'profile-writer',      validator: 'profile-validator',      outputs: ['gspec/profile.md'] },
  { id: 'stack',        title: 'Technology stack',  type: 'foundation', writer: 'stack-writer',        validator: 'stack-validator',        outputs: ['gspec/stack.md'] },
  { id: 'practices',    title: 'Practices',         type: 'foundation', writer: 'practices-writer',    validator: 'practices-validator',    outputs: ['gspec/practices.md'] },
  { id: 'style',        title: 'Style guide',       type: 'foundation', writer: 'style-writer',        validator: 'style-validator',        outputs: ['gspec/style.md', 'gspec/style.html'] },
  { id: 'features',     title: 'Feature PRDs',      type: 'features',   writer: 'feature-writer',      validator: 'feature-validator' },
  { id: 'architecture', title: 'Architecture',      type: 'gated',      writer: 'architecture-writer', validator: 'architecture-validator', outputs: ['gspec/architecture.md'] },
  { id: 'plan',         title: 'Plans',             type: 'plan',       writer: 'plan-decomposer',     validator: 'plan-validator' },
  { id: 'implement',    title: 'Implementation',    type: 'implement',  agent: 'implementer', orchestrator: 'build-orchestrator', validator: 'implementation-validator' },
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
  await mkdir(join(cwd, BUILD_DIR), { recursive: true });
  await writeFile(join(cwd, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

function initManifest(idea, opts) {
  const stages = {};
  for (const s of STAGES) stages[s.id] = { status: 'pending', attempts: 0, verdict: null };
  return {
    idea,
    engine: opts.engine || 'claude',
    noQa: !!opts.noQa,
    permissionMode: opts.permissionMode || 'acceptEdits',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages,
  };
}

// --- agent invocation (the integration boundary) --------------------------
//
// Run one stage as a named gspec agent on the selected engine. The engine
// adapter (ctx.engine) knows how to become that agent — Claude via native
// `--agent`, Codex/Pi by injecting the installed agent's instruction body — and
// how to gate tools. `extra.allowedTools === 'Bash'` marks the stages whose
// agent runs commands (implement, audit), which each engine maps onto its own
// permission surface. Resolves { code, text } where text is the agent's final
// message (stdout); exit code 0 = success, non-zero = failure.
function runAgent(agentName, prompt, ctx, extra = {}) {
  return ctx.engine.runAgent(agentName, prompt, ctx, { needsBash: extra.allowedTools === 'Bash' });
}

// Intake runs INTERACTIVELY (the user answers) — the engine inherits stdio so
// they can converse. The intake session writes the resolved brief to brief.md.
function runIntake(idea, ctx) {
  const prompt = [
    'You are the intake step of the gspec build.',
    `The idea to build: ${idea}`,
    'Interview the user ONCE to resolve the decisions the whole autonomous build pivots on:',
    'product type & primary audience, technology lean, visual style direction (or "no UI"), and scope boundaries.',
    'Offer 2-3 concrete suggestions per question. When everything load-bearing is resolved,',
    `write a concise brief — the idea plus every decision — to ${BRIEF_PATH}, then stop.`,
  ].join(' ');
  return ctx.engine.runInteractive(prompt, ctx);
}

function parseVerdict(text) {
  const m = String(text).match(/VERDICT:\s*(PASS|FAIL)/i);
  return m ? m[1].toUpperCase() : null;
}

// Deterministic build+test gate: the driver runs verify.sh ITSELF (no model
// judgment) — its exit code IS the gate. See docs/gspec-v2-design.md §13
// (implementation-validator, deterministic part). Captures stdout+stderr so the
// failure can be fed back to the implementer.
function runVerify(ctx) {
  return new Promise((resolve) => {
    if (ctx.dryRun) { log(chalk.dim('      would run: bash verify.sh')); return resolve({ code: 0, output: '(dry run)' }); }
    const child = spawn('bash', ['verify.sh'], { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('error', (e) => resolve({ code: 1, output: `verify.sh could not run: ${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

// Keep the tail of large tool output when feeding a failure back into a prompt.
function tail(text, n = 4000) {
  const s = String(text);
  return s.length > n ? '…\n' + s.slice(-n) : s;
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
        if (await pathExists(ctx.cwd, `gspec/tasks/${slug}.md`)) continue;
        // plan-decomposer returns the plan draft body; the driver writes it
        // (autonomous mode auto-approves — no interactive plan-mode gate).
        const d = await runAgent(stage.writer, `Decompose the feature "${slug}" (gspec/features/${slug}.md) into an ordered plan. Return ONLY the plan file body (frontmatter + ## Plan).`, ctx);
        if (d.code !== 0) return { status: 'failed', reason: `${stage.writer} exited ${d.code}` };
        if (!ctx.dryRun) {
          await mkdir(join(ctx.cwd, 'gspec', 'tasks'), { recursive: true });
          await writeFile(join(ctx.cwd, 'gspec', 'tasks', `${slug}.md`), extractPlanBody(d.text), 'utf-8');
        }
        if (!ctx.noQa) {
          const v = await runAgent(stage.validator, validatorPrompt(stage, `gspec/tasks/${slug}.md`), ctx);
          if (parseVerdict(v.text) === 'FAIL') log(chalk.yellow(`      plan for ${slug} has QA notes (continuing)`));
        }
      }
      return { status: 'done', verdict: ctx.noQa ? 'skipped' : 'PASS' };
    }

    case 'implement': {
      // The monolithic brief — the fallback build, and the self-heal prompt (a
      // full "fix whatever's broken" pass) used by the gates below.
      const buildPrompt = stageBrief(stage, brief, 'Implement all in-scope, unchecked work. Scaffold if greenfield; generate/maintain verify.sh from the architecture Deployables table; write and run tests; flip checkboxes as you go.');

      // Orchestrate (design §13 T3): the build-orchestrator turns the specs into
      // an ordered wave plan; the driver runs it, fanning out file-disjoint
      // scopes within a wave. No usable plan → one monolithic implement call.
      let plan = null;
      if (stage.orchestrator) {
        const p = await runAgent(stage.orchestrator, stageBrief(stage, brief, 'Plan this implementation run: read the in-scope features/plans and return ONLY the ordered wave build-plan JSON.'), ctx);
        plan = p.code === 0 ? parseBuildPlan(p.text) : null;
      }

      let out;
      if (plan) {
        log(chalk.dim(`      orchestrated: ${plan.length} wave(s), ${plan.reduce((n, w) => n + w.length, 0)} scope(s)`));
        for (let i = 0; i < plan.length; i++) {
          const wave = plan[i];
          const runs = await Promise.all(wave.map((scope) =>
            runAgent(stage.agent, stageBrief(stage, brief, `Build ONLY this scope (one isolated implementer run): ${scope.instruction}\nGenerate/maintain verify.sh; write and run tests; flip checkboxes for the work you complete.`), ctx, { allowedTools: 'Bash' })));
          const bad = runs.findIndex((r) => r.code !== 0);
          if (bad >= 0) return { status: 'failed', reason: `implementer scope "${wave[bad].label}" (wave ${i + 1}/${plan.length}) exited ${runs[bad].code}` };
        }
      } else {
        out = await runAgent(stage.agent, buildPrompt, ctx, { allowedTools: 'Bash' });
        if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} exited ${out.code}` };
      }
      if (ctx.noQa) return { status: 'done', verdict: 'skipped' };

      // Gate part 1 — deterministic build+test. The driver runs verify.sh; a
      // non-zero exit re-delegates the implementer once with the exact failure.
      if (await pathExists(ctx.cwd, 'verify.sh')) {
        let v = await runVerify(ctx);
        if (v.code !== 0) {
          log(chalk.yellow('      verify.sh failed — one self-heal…'));
          const fix = `${buildPrompt}\n\nverify.sh failed (exit ${v.code}). Fix the code so build+test pass; do not weaken the tests to make them pass. Output:\n${tail(v.output)}`;
          out = await runAgent(stage.agent, fix, ctx, { allowedTools: 'Bash' });
          if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (verify self-heal) exited ${out.code}` };
          v = await runVerify(ctx);
          if (v.code !== 0) return { status: 'failed', reason: 'verify.sh still failing after one self-heal', verdict: 'FAIL' };
        }
      }

      // Gate part 2 — judgment. implementation-validator checks the in-scope
      // acceptance criteria + Definition of Done; one self-heal on FAIL.
      if (!stage.validator) return { status: 'done', verdict: 'PASS' };
      const jvTarget = 'the implemented scope';
      let jv = await runAgent(stage.validator, validatorPrompt(stage, jvTarget), ctx, { allowedTools: 'Bash' });
      if (parseVerdict(jv.text) === 'PASS') return { status: 'done', verdict: 'PASS' };
      log(chalk.yellow('      implementation QA flagged issues — one revision…'));
      const revise = `${buildPrompt}\n\nThe implementation failed QA. Address this verdict, then ensure verify.sh still passes:\n${jv.text}`;
      out = await runAgent(stage.agent, revise, ctx, { allowedTools: 'Bash' });
      if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (QA revision) exited ${out.code}` };
      jv = await runAgent(stage.validator, validatorPrompt(stage, jvTarget), ctx, { allowedTools: 'Bash' });
      if (parseVerdict(jv.text) === 'PASS') return { status: 'done', verdict: 'PASS' };
      return { status: 'failed', reason: 'implementation QA gate did not pass after one revision', verdict: parseVerdict(jv.text) || 'unknown' };
    }

    case 'audit': {
      const out = await runAgent(stage.agent, 'Inspect the codebase for drift vs the specs and orphan capabilities; return an impact-ordered findings report. Do not modify anything.', ctx, { allowedTools: 'Bash' });
      return { status: out.code === 0 ? 'done' : 'failed', verdict: 'report', reason: out.code === 0 ? undefined : `${stage.agent} exited ${out.code}` };
    }

    default:
      return { status: 'failed', reason: `unknown stage type ${stage.type}` };
  }
}

// Parse the build-orchestrator's plan (a fenced JSON block of ordered waves,
// each a list of {label, instruction} scopes). Returns a normalized array of
// waves (arrays of scopes), or null if nothing usable — the caller then falls
// back to a single monolithic implement call. Defensive: the plan is model
// output, so tolerate a stray fence/prose and drop malformed scopes.
function parseBuildPlan(text) {
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  const waves = Array.isArray(obj?.waves) ? obj.waves : null;
  if (!waves) return null;
  const norm = [];
  for (const wave of waves) {
    const scopes = (Array.isArray(wave) ? wave : [])
      .filter((s) => s && typeof s.instruction === 'string' && s.instruction.trim())
      .map((s) => ({ label: String(s.label || 'scope').trim(), instruction: s.instruction.trim() }));
    if (scopes.length) norm.push(scopes);
  }
  return norm.length ? norm : null;
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

export async function runBuild({ idea, cwd = process.cwd(), engine = 'claude', noQa = false, resume = false, dryRun = false, permissionMode = 'acceptEdits', piPermissionLevel } = {}) {
  let manifest = await loadManifest(cwd);

  if (manifest && !resume && !dryRun) {
    console.error(chalk.red('\n  A build run already exists (.gspec/build/run.json).'));
    console.error(chalk.dim('  Re-run with --resume to continue it, or remove that file to start over.\n'));
    process.exit(1);
  }
  if (!manifest) {
    if (!idea) { console.error(chalk.red('\n  An idea is required to start: gspec build "<idea>"\n')); process.exit(1); }
    manifest = initManifest(idea, { engine, noQa, permissionMode });
    await saveManifest(cwd, manifest);
  }

  // A run is pinned to the engine it started on (recorded in the manifest); a
  // resume ignores a conflicting --engine so stages stay consistent.
  const engineName = manifest.engine || 'claude';
  if (resume && engine !== engineName && engine !== 'claude') {
    log(chalk.yellow(`  Note: this run started on "${engineName}" — ignoring --engine ${engine}.`));
  }
  let selectedEngine;
  try {
    selectedEngine = getEngine(engineName);
  } catch (e) {
    console.error(chalk.red(`\n  ${e.message}\n`));
    process.exit(1);
  }

  const ctx = { cwd, engine: selectedEngine, noQa: manifest.noQa, permissionMode: manifest.permissionMode, piPermissionLevel, dryRun, brief: '', log };

  log(chalk.bold(`\n  gspec build — ${chalk.cyan(manifest.idea)}`));
  log(chalk.dim(`  engine: ${engineName} · QA gates: ${manifest.noQa ? 'off (--no-qa)' : 'on'} · resumable · ${dryRun ? 'DRY RUN' : 'autonomous after intake'}\n`));

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

  log(chalk.bold.green('\n  ✓ Build complete.'));
  log(chalk.dim(`  Specs + code are in place; see .gspec/build/run.json for the run record.\n`));
}

async function readBrief(cwd) {
  try { return await readFile(join(cwd, BRIEF_PATH), 'utf-8'); } catch { return ''; }
}
