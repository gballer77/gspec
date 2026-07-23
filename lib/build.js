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
import { getEngine, ENGINE_NAMES } from './engines.js';
import { readProjectConfig } from './config.js';

const BUILD_DIR = join('.gspec', 'build');
const MANIFEST_PATH = join(BUILD_DIR, 'run.json');
const BRIEF_PATH = join(BUILD_DIR, 'brief.md');
// Agent memory silos (the learning loop) — the project-scoped dir or the
// local/gitignored variant; only one is active per install, but we scan both.
// A `## ` lesson heading that appears in an agent's MEMORY.md between run start
// and finish is a learning this run recorded. See plugin/skills/conventions/gspec-memory.md.
const AGENT_MEMORY_DIRS = ['.claude/agent-memory', '.claude/agent-memory-local'];

// Implement-stage continuation loop (design §13). A single implementer run has a
// finite context window; on a small model a large scope can exhaust it mid-build.
// Because progress is durable in the filesystem (plan `- [ ]` checkboxes; checked
// tasks are immutable — see implementer.md), we don't try to detect exhaustion —
// we watch the unchecked count and, while it keeps dropping, spawn a FRESH agent
// to resume from the reduced set. MAX_SCOPE_RUNS caps total attempts per scope;
// MAX_STALLS stops once runs stop making progress (genuinely stuck, not merely
// out of room) so a scope the model can't finish falls through to the QA gate.
const MAX_SCOPE_RUNS = 6;
const MAX_STALLS = 2;

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

// Every plan file under gspec/tasks/ (repo-relative) — the monolithic implement
// fallback tracks progress across all of them.
async function listPlanFiles(cwd) {
  try {
    const entries = await readdir(join(cwd, 'gspec', 'tasks'));
    return entries.filter((f) => f.endsWith('.md')).map((f) => join('gspec', 'tasks', f));
  } catch { return []; }
}

// Count unfinished plan tasks ("- [ ]") across the given repo-relative files;
// missing files count as zero. This is the durable, engine-agnostic progress
// signal the implement continuation loop watches.
async function countUnchecked(cwd, files) {
  let n = 0;
  for (const rel of files) {
    let text;
    try { text = await readFile(join(cwd, rel), 'utf-8'); } catch { continue; }
    n += (text.match(/^\s*[-*]\s*\[ \]/gm) || []).length;
  }
  return n;
}

// --- learnings capture (the learning loop's build channel) -----------------
//
// "Learnings" the build reports come from two sources: (1) durable lessons an
// agent wrote to its per-agent memory silo mid-run (the silo diff), and (2) the
// QA FAIL verdicts the driver itself observed and self-healed from (recorded in
// the manifest — reliable even where the SubagentStop capture hook doesn't fire
// for headless subprocesses). Both are model-free to gather here.

// The `## ` lesson headings in a MEMORY.md (one heading per lesson, per gspec-memory).
export function lessonHeadings(md) {
  return String(md).split('\n')
    .filter((l) => /^##\s+\S/.test(l))
    .map((l) => l.replace(/^##\s+/, '').trim());
}

// { agentName -> [lesson heading, …] } across every present memory silo.
async function snapshotMemory(cwd) {
  const snap = {};
  for (const dir of AGENT_MEMORY_DIRS) {
    let entries;
    try { entries = await readdir(join(cwd, dir), { withFileTypes: true }); }
    catch { continue; } // silo dir absent (non-Claude engine, or nothing captured yet)
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      let text;
      try { text = await readFile(join(cwd, dir, ent.name, 'MEMORY.md'), 'utf-8'); }
      catch { continue; }
      snap[ent.name] = (snap[ent.name] || []).concat(lessonHeadings(text));
    }
  }
  return snap;
}

// Lesson headings present in `after` but not in `before` — the net-new lessons.
export function diffLessons(before = {}, after = {}) {
  const added = [];
  for (const [agent, headings] of Object.entries(after)) {
    const base = new Set(before[agent] || []);
    for (const h of headings) if (!base.has(h)) added.push({ agent, lesson: h });
  }
  return added;
}

// Compact a (possibly multi-line) verdict into a one-line report excerpt.
function summarize(text, maxLines = 2, maxLen = 200) {
  const s = String(text).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, maxLines).join(' / ');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// Print the end-of-run learnings report (durable memory lessons + QA feedback).
async function reportLearnings(cwd, manifest) {
  const added = diffLessons(manifest.learningsBaseline || {}, await snapshotMemory(cwd));
  const feedback = manifest.learnings || [];

  log('');
  log(chalk.bold('  Learnings recorded this run'));
  if (added.length === 0 && feedback.length === 0) {
    log(chalk.dim('  None — no QA gate flagged an issue and no lesson was written to agent memory.'));
    return;
  }
  if (added.length) {
    log(chalk.green(`  ✎ ${added.length} lesson(s) captured to agent memory:`));
    for (const a of added) log(`      · [${a.agent}] ${a.lesson}`);
    log(chalk.dim('    Review and promote them into the source skills with /gspec-distill.'));
  } else {
    log(chalk.dim('  ✎ No new lessons written to agent memory this run.'));
  }
  if (feedback.length) {
    log(chalk.yellow(`  ⚠ ${feedback.length} QA feedback event(s) drove a self-heal:`));
    for (const f of feedback) log(chalk.dim(`      · ${f.stage} — ${f.agent}: ${f.excerpt}`));
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
    learnings: [],           // QA feedback events the driver observes this run
    learningsBaseline: null, // memory-silo snapshot, taken just before stage 1
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
    `write a concise brief — the idea plus every decision — to ${BRIEF_PATH}.`,
    'Then tell the user the brief is written and that they must EXIT this session (/exit or Ctrl+C) —',
    'the build runtime is waiting for this session to end and will run every remaining stage itself, unattended.',
    'Do NOT run the build, any gspec command, or any implementation yourself; your only deliverable is the brief.',
    'If the user says "go", "ready", or similar after the brief is written, remind them to exit the session.',
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
  ctx.recordFeedback(stage, stage.validator, v.text);
  log(chalk.yellow(`      QA flagged issues — one revision…`));
  const revise = `${writerPrompt}\n\nA prior draft failed QA. Revise to address this verdict:\n${v.text}`;
  out = await runAgent(stage.writer, revise, ctx);
  if (out.code !== 0) return { status: 'failed', reason: `${stage.writer} (revision) exited ${out.code}` };
  v = await runAgent(stage.validator, validatorPrompt(stage, validatorTarget), ctx);
  if (parseVerdict(v.text) === 'PASS') return { status: 'done', verdict: 'PASS' };
  return { status: 'failed', reason: 'QA gate did not pass after one revision', verdict: parseVerdict(v.text) || 'unknown' };
}

// Run one implementer scope to completion across FRESH agents. Each run is an
// isolated subprocess with a new context window; the plan checkboxes are the
// state shared between them. While boxes keep flipping we spawn the next agent to
// resume from the reduced unchecked set — so a run that exhausts a small context
// window mid-scope is transparently continued rather than lost. We stop when none
// remain, after MAX_STALLS no-progress runs (stuck, not out of room), or at
// MAX_SCOPE_RUNS. Returns the last { code, text } so the caller's gates apply as
// before. A scope with no trackable plan file (e.g. scaffold) runs exactly once.
async function runImplementScope(stage, scope, basePrompt, ctx) {
  const files = scope.plan || [];
  const promptFor = (run) => run === 1 ? basePrompt
    : `${basePrompt}\n\nA prior implementer run on this scope stopped before finishing (likely a context limit). Continue the REMAINING unchecked tasks only; never redo, uncheck, or renumber completed tasks.`;

  if (!files.length) return runAgent(stage.agent, promptFor(1), ctx, { allowedTools: 'Bash' });

  let out, stalls = 0;
  let remaining = await countUnchecked(ctx.cwd, files);
  for (let run = 1; run <= MAX_SCOPE_RUNS; run++) {
    out = await runAgent(stage.agent, promptFor(run), ctx, { allowedTools: 'Bash' });
    const after = await countUnchecked(ctx.cwd, files);
    if (after === 0) return out;                    // scope complete
    if (after < remaining) {                        // progress → a fresh agent continues
      stalls = 0; remaining = after;
      if (run < MAX_SCOPE_RUNS) log(chalk.dim(`      "${scope.label}": ${after} task(s) left — continuing on a fresh agent…`));
      continue;
    }
    if (out.code !== 0) return out;                 // no progress AND errored → surface the failure
    if (++stalls >= MAX_STALLS) {                   // no progress but exit 0 → let the QA gate judge what remains
      log(chalk.yellow(`      "${scope.label}": ${after} task(s) still unchecked after ${run} run(s) with no progress — handing to QA.`));
      return out;
    }
  }
  return out;
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
          ctx.recordFeedback(stage, stage.validator, v.text);
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
          if (parseVerdict(v.text) === 'FAIL') {
            ctx.recordFeedback(stage, stage.validator, v.text);
            log(chalk.yellow(`      plan for ${slug} has QA notes (continuing)`));
          }
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
          // Each scope runs to completion across fresh agents (continuation loop);
          // file-disjoint scopes within a wave still fan out in parallel.
          const runs = await Promise.all(wave.map((scope) => {
            const basePrompt = stageBrief(stage, brief, `Build ONLY this scope (one isolated implementer run): ${scope.instruction}\nGenerate/maintain verify.sh; write and run tests; flip checkboxes for the work you complete.`);
            return runImplementScope(stage, scope, basePrompt, ctx);
          }));
          const bad = runs.findIndex((r) => r.code !== 0);
          if (bad >= 0) return { status: 'failed', reason: `implementer scope "${wave[bad].label}" (wave ${i + 1}/${plan.length}) exited ${runs[bad].code}` };
        }
      } else {
        // No usable wave plan → one scope covering all in-scope work, still with
        // the continuation loop so a small context window doesn't cap the build.
        const scope = { label: 'all in-scope work', plan: await listPlanFiles(ctx.cwd) };
        out = await runImplementScope(stage, scope, buildPrompt, ctx);
        if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} exited ${out.code}` };
      }
      if (ctx.noQa) return { status: 'done', verdict: 'skipped' };

      // Gate part 1 — deterministic build+test. The driver runs verify.sh; a
      // non-zero exit re-delegates the implementer once with the exact failure.
      if (await pathExists(ctx.cwd, 'verify.sh')) {
        let v = await runVerify(ctx);
        if (v.code !== 0) {
          ctx.recordFeedback(stage, 'verify.sh', `build/test failed (exit ${v.code}) / ${tail(v.output, 300)}`);
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
      ctx.recordFeedback(stage, stage.validator, jv.text);
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
      .map((s) => ({ label: String(s.label || 'scope').trim(), instruction: s.instruction.trim(), plan: normalizePlanFiles(s.plan) }));
    if (scopes.length) norm.push(scopes);
  }
  return norm.length ? norm : null;
}

// A scope's `plan` — the file(s) whose checkboxes track the scope's progress —
// may arrive as a string or an array (or be absent, e.g. a scaffold scope).
// Normalize to a clean string[] the continuation loop can count.
function normalizePlanFiles(v) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : []);
  return arr.map((f) => String(f).trim()).filter(Boolean);
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

export async function runBuild({ idea, cwd = process.cwd(), engine, noQa = false, resume = false, dryRun = false, permissionMode = 'acceptEdits', piPermissionLevel } = {}) {
  let manifest = await loadManifest(cwd);

  if (manifest && !resume && !dryRun) {
    console.error(chalk.red('\n  A build run already exists (.gspec/build/run.json).'));
    console.error(chalk.dim('  Re-run with --resume to continue it, or remove that file to start over.\n'));
    process.exit(1);
  }
  // --resume continues an existing run, so it never needs an idea — but there
  // must be a run to continue.
  if (!manifest && resume) {
    console.error(chalk.red('\n  No build run to resume (.gspec/build/run.json not found).'));
    console.error(chalk.dim('  Start one with: gspec build "<idea>"\n'));
    process.exit(1);
  }
  if (!manifest && !idea) { console.error(chalk.red('\n  An idea is required to start: gspec build "<idea>"\n')); process.exit(1); }

  // Resolve the engine BEFORE any manifest is written, so a wrong engine never
  // gets pinned into the run. A run is pinned to the engine it started on
  // (recorded in the manifest); a resume ignores a conflicting --engine so
  // stages stay consistent. Fresh runs pick: explicit --engine, else the target
  // this project was installed for (.gspec/config.json), else claude.
  let engineName;
  let engineExplicit = false; // user named the engine (flag or pinned manifest)
  if (manifest) {
    engineName = manifest.engine || 'claude';
    engineExplicit = true;
    if (engine && engine !== engineName) {
      log(chalk.yellow(`  Note: this run started on "${engineName}" — ignoring --engine ${engine}.`));
    }
  } else if (engine) {
    engineName = engine;
    engineExplicit = true;
  } else {
    const config = await readProjectConfig(cwd);
    if (config.target && ENGINE_NAMES.includes(config.target)) {
      engineName = config.target;
      log(chalk.dim(`  Using engine "${engineName}" (this project's install target).`));
    } else if (config.target) {
      console.error(chalk.red(`\n  This project is installed for "${config.target}", which the autonomous build cannot drive.`));
      console.error(chalk.dim(`  Pick an engine explicitly: gspec build --engine <${ENGINE_NAMES.join('|')}> "<idea>"\n`));
      process.exit(1);
    } else {
      engineName = 'claude';
    }
  }
  let selectedEngine;
  try {
    selectedEngine = getEngine(engineName);
  } catch (e) {
    console.error(chalk.red(`\n  ${e.message}\n`));
    process.exit(1);
  }

  // Preflight: verify this project is actually installed for the engine, while
  // aborting is still free (no manifest written, no stage run). Codex/Pi stages
  // read the installed agent file directly, so a missing file is always fatal.
  // Claude may get its agents from the gspec plugin instead of .claude/agents/,
  // so only an IMPLICIT fall-back to claude is fatal; an engine the user named
  // gets a warning and the benefit of the doubt.
  if (!dryRun) {
    const probe = selectedEngine.agentFile(STAGES[0].writer);
    if (!(await pathExists(cwd, probe))) {
      if (engineName !== 'claude') {
        console.error(chalk.red(`\n  gspec is not installed for engine "${engineName}" here (${probe} not found).`));
        console.error(chalk.dim(`  Install it first: npx gspec -t ${engineName}\n`));
        process.exit(1);
      }
      if (!engineExplicit) {
        console.error(chalk.red(`\n  gspec is not installed for Claude Code here (${probe} not found).`));
        console.error(chalk.dim(`  Install it (npx gspec -t claude), or name this project's engine: gspec build --engine <${ENGINE_NAMES.join('|')}> "<idea>"\n`));
        process.exit(1);
      }
      log(chalk.yellow(`  Note: ${probe} not found — assuming Claude Code gets its gspec agents from the plugin.`));
    }
  }

  if (!manifest) {
    manifest = initManifest(idea, { engine: engineName, noQa, permissionMode });
    await saveManifest(cwd, manifest);
  }

  // Ensure a memory-silo baseline exists (fresh run, or an older manifest being
  // resumed). Taken before any stage runs, so the end-of-run diff is net-new.
  manifest.learnings = manifest.learnings || [];
  if (!manifest.learningsBaseline) {
    manifest.learningsBaseline = await snapshotMemory(cwd);
    await saveManifest(cwd, manifest);
  }

  const ctx = { cwd, engine: selectedEngine, noQa: manifest.noQa, permissionMode: manifest.permissionMode, piPermissionLevel, dryRun, brief: '', log };
  // Record a QA FAIL the driver observed (the feedback signal a lesson comes
  // from). Pushes onto the manifest's array so each saveManifest persists it.
  ctx.recordFeedback = (stage, agent, text) => {
    manifest.learnings.push({ at: new Date().toISOString(), stage: stage.id, agent, excerpt: summarize(text) });
  };

  log(chalk.bold(`\n  gspec build — ${chalk.cyan(manifest.idea)}`));
  log(chalk.dim(`  engine: ${engineName} · QA gates: ${manifest.noQa ? 'off (--no-qa)' : 'on'} · resumable · ${dryRun ? 'DRY RUN' : 'autonomous after intake'}\n`));

  // Intake (once) — interactive; writes the brief the autonomous run consumes.
  if (!(await pathExists(cwd, BRIEF_PATH))) {
    log(chalk.bold('  ▸ Intake') + chalk.dim(' (one interview, then unattended)'));
    log(chalk.dim('    When the interview ends and the brief is written, exit the session — the build continues automatically.'));
    await runIntake(manifest.idea, ctx);
    // The brief on disk is the completion signal, not the exit code — quitting
    // an interactive session (Ctrl+C, /exit) often exits non-zero even after a
    // successful interview.
    if (!dryRun && !(await pathExists(cwd, BRIEF_PATH))) {
      console.error(chalk.red('  Intake ended without writing the brief — aborting.'));
      console.error(chalk.dim(`  Re-run to retry the interview, or write ${BRIEF_PATH} yourself and re-run with --resume.`));
      process.exit(1);
    }
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
      await reportLearnings(cwd, manifest);
      log(chalk.yellow('\n  Paused. Fix the issue, then re-run with --resume to continue from here.\n'));
      process.exit(1);
    }
    log(chalk[result.status === 'skipped' ? 'dim' : 'green'](`  ${result.status === 'skipped' ? '↷' : '✓'} ${stage.title} — ${result.verdict || result.status}`));
  }

  log(chalk.bold.green('\n  ✓ Build complete.'));
  log(chalk.dim(`  Specs + code are in place; see .gspec/build/run.json for the run record.`));
  await reportLearnings(cwd, manifest);
  log('');
}

async function readBrief(cwd) {
  try { return await readFile(join(cwd, BRIEF_PATH), 'utf-8'); } catch { return ''; }
}
