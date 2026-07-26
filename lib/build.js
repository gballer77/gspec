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
import { writeFile, mkdir, stat, readdir, readFile, rm, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import chalk from 'chalk';
import { getEngine, ENGINE_NAMES } from './engines.js';
import { readProjectConfig } from './config.js';

const BUILD_DIR = join('.gspec', 'build');
const MANIFEST_PATH = join(BUILD_DIR, 'run.json');
const BRIEF_PATH = join(BUILD_DIR, 'brief.md');
const LAST_FAILURE_PATH = join(BUILD_DIR, 'last-failure.md');
// Cumulative, append-only QA failure log. Unlike last-failure.md (the single
// latest TERMINAL failure, overwritten by the next one and removed when a build
// completes), this file records EVERY failing QA verdict a run observes — in
// full, including ones a self-heal revision later recovered from — and is never
// auto-removed. It's the durable channel for studying and tuning the build loop
// across runs. See docs/gspec-v2-design.md §13.
const QA_LOG_PATH = join(BUILD_DIR, 'qa-failures.md');
const QA_LOG_PREAMBLE = [
  '# gspec build — QA failure log',
  '',
  'Every QA verdict that failed during a build run, in full, oldest first (newest',
  'appended last). An entry tagged `rev N` was a failure a self-heal revision then',
  'tried to fix — it was recovered unless a later `TERMINAL` entry for the same',
  'stage appears; a `TERMINAL` entry is where the run actually paused. An `ADVISORY`',
  'entry did NOT block: the validator returned FAIL but every finding was',
  '[minor]/[nit], so the driver passed the spec per the severity contract and kept',
  'the notes here for you. This file is cumulative across runs and is never',
  'auto-removed — delete it once you have mined it. (The single latest terminal',
  'failure also lives in last-failure.md, which IS removed when a build completes.)',
  '',
  '',
].join('\n');
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

// Research-stage fan-out ceiling (--research): the planner is told to keep the
// competitor list tight, but the plan is model output — cap it so a runaway
// list can't spawn unbounded web-research agents. Drops are logged, not silent.
const MAX_COMPETITORS = 6;

// Features-stage fan-out ceiling: the feature-planner is told to lean toward
// fewer features, but the breakdown is model output — cap it so a runaway plan
// can't spawn unbounded feature-writer agents. Drops are logged, not silent.
// The ceiling is decoupled from concurrency: writers run at most
// FEATURE_WRITER_CONCURRENCY at a time (each is a real headless engine
// subprocess), so a large but legitimate breakdown gets all its PRDs without a
// thundering herd of simultaneous agents / API calls.
const MAX_FEATURES = 24;
const FEATURE_WRITER_CONCURRENCY = 5;

// The build stage graph (design §8). Foundation stages are skip-if-present.
// `outputs` lets the driver detect an already-present spec and skip it.
export const STAGES = [
  { id: 'profile',      title: 'Product profile',  type: 'foundation', writer: 'profile-writer',      validator: 'profile-validator',      outputs: ['gspec/profile.md'] },
  // Opt-in (--research): competitive research right after the profile, so the
  // feature stage starts from a richer requirements set. Headless variant of
  // /gspec-research — planner (competitor list) → per-competitor fan-out →
  // writer; the interactive accept/reject review is replaced by auto-accept,
  // and the spec-review pause is where a human prunes the result.
  { id: 'research',     title: 'Competitive research', type: 'research', planner: 'research-planner', researcher: 'competitor-researcher', writer: 'research-writer', outputs: ['gspec/research.md'] },
  { id: 'stack',        title: 'Technology stack',  type: 'foundation', writer: 'stack-writer',        validator: 'stack-validator',        outputs: ['gspec/stack.md'] },
  { id: 'practices',    title: 'Practices',         type: 'foundation', writer: 'practices-writer',    validator: 'practices-validator',    outputs: ['gspec/practices.md'] },
  { id: 'style',        title: 'Style guide',       type: 'foundation', writer: 'style-writer',        validator: 'style-validator',        outputs: ['gspec/style.md', 'gspec/style.html'] },
  { id: 'features',     title: 'Feature PRDs',      type: 'features',   planner: 'feature-planner',    writer: 'feature-writer',      validator: 'feature-validator' },
  { id: 'architecture', title: 'Architecture',      type: 'gated',      writer: 'architecture-writer', validator: 'architecture-validator', outputs: ['gspec/architecture.md'] },
  { id: 'plan',         title: 'Plans',             type: 'plan',       writer: 'plan-decomposer',     validator: 'plan-validator' },
  // The human gate (design: second interactive touchpoint). Every spec now
  // exists but no code does — the run pauses (exit 0) so the user can review
  // and edit gspec/ before implementation; `--resume` approves and continues,
  // `--no-review` skips the pause entirely. Handled in the driver loop, not
  // runStage: approval depends on the resume flag + prior manifest status.
  { id: 'review',       title: 'Spec review',       type: 'review' },
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
    // Sorted: a stable per-run order makes the validation loop (and its
    // content-hash memoization) deterministic across resumes.
    return entries.filter((f) => f.endsWith('.md') && !f.endsWith('.plan.md')).sort();
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

// Map `fn` over `items` with at most `limit` calls in flight, preserving input
// order in the result. A worker pool (not fixed batches) so a slow item doesn't
// stall the ones behind it. Used to bound how many headless writer subprocesses
// the features stage spawns at once — see FEATURE_WRITER_CONCURRENCY.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
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

// "one revision" / "3 revisions" — gate messages scale with --qa-retries.
function countNoun(n, noun) { return n === 1 ? `one ${noun}` : `${n} ${noun}s`; }

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
    log(chalk.dim(`    Every failing verdict this run — in full, even the recovered ones — is in ${QA_LOG_PATH}.`));
  }
}

// Append one failing QA verdict to the cumulative log (QA_LOG_PATH). Called for
// every QA FAIL — the intermediate ones a self-heal recovered from (via
// ctx.recordFeedback) AND the terminal one that paused the run (via
// reportFailure) — so the file is the complete chronological record. `text` is
// the FULL verdict/output (never the manifest's compact excerpt). Best-effort:
// a log-write failure must never derail an actual build.
async function appendQaFailure(cwd, { stage, checker, target, attempt, retries, terminal, advisory, resolution, reason, text }) {
  try {
    const when = new Date().toISOString();
    const status = terminal ? 'terminal — run paused here'
      : advisory ? 'advisory notes only — did not block (driver passed the spec per the severity contract: no blocker/major finding)'
      : resolution ? resolution
      : `failed QA → revision ${attempt}${retries != null ? `/${retries}` : ''} triggered`;
    const tag = terminal ? 'TERMINAL' : advisory ? 'ADVISORY' : resolution ? 'note' : `rev ${attempt}`;
    const entry = [
      `## ${when} · ${stage.id} · ${tag}`,
      '',
      `- when: ${when}`,
      `- stage: ${stage.title} (${stage.id})`,
      `- checker: ${checker}`,
      target ? `- target: ${target}` : null,
      reason ? `- reason: ${reason}` : null,
      `- status: ${status}`,
      '',
      '```',
      String(text).trim(),
      '```',
      '',
      '',
    ].filter((l) => l !== null).join('\n');
    await mkdir(join(cwd, BUILD_DIR), { recursive: true });
    if (!(await pathExists(cwd, QA_LOG_PATH))) await writeFile(join(cwd, QA_LOG_PATH), QA_LOG_PREAMBLE, 'utf-8');
    await appendFile(join(cwd, QA_LOG_PATH), entry, 'utf-8');
  } catch { /* logging a failure must not itself fail the run */ }
}

// A failed stage pauses the whole run, so the WHY must survive the terminal
// (detached runs only have a log file). Print the failing verdict/output in
// full-enough form, and write it to last-failure.md; the manifest keeps it too,
// via the failed stage's `detail`. Overwritten by the next failure; removed
// when a build completes. The verdict is ALSO folded into the cumulative
// qa-failures.md, which outlives a later successful resume.
async function reportFailure(cwd, stage, result, dryRun) {
  if (result.detail) {
    log(chalk.red('\n  Why it failed:'));
    for (const line of tail(result.detail, 2000).trim().split('\n')) log(chalk.red(`    ${line}`));
  }
  if (dryRun) return;
  const body = [
    `# Build paused: ${stage.title} (${stage.id}) failed`,
    '',
    `- when: ${new Date().toISOString()}`,
    `- reason: ${result.reason || 'failed'}`,
    ...(result.verdict ? [`- verdict: ${result.verdict}`] : []),
    ...(result.detail ? ['', '## Full verdict / output', '', String(result.detail).trim()] : []),
    '',
    'Fix the issue, then continue the run from this stage: `gspec build --resume`',
    '',
  ].join('\n');
  await mkdir(join(cwd, BUILD_DIR), { recursive: true });
  await writeFile(join(cwd, LAST_FAILURE_PATH), body, 'utf-8');
  // A QA-produced terminal failure carries the failing verdict in `detail`;
  // record it in the durable log too (it survives a later successful resume,
  // which clears last-failure.md).
  if (result.detail) {
    await appendQaFailure(cwd, {
      stage,
      checker: stage.validator || stage.agent || 'qa gate',
      target: (stage.outputs || []).join(', ') || undefined,
      reason: result.reason,
      terminal: true,
      text: result.detail,
    });
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
    noReview: !!opts.noReview,
    research: !!opts.research,
    qaRetries: opts.qaRetries ?? 1,
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
// agent runs commands (implement, audit); 'Web' marks the research agents that
// need web search/fetch; each engine maps these onto its own permission
// surface. Resolves { code, text } where text is the agent's final message
// (stdout); exit code 0 = success, non-zero = failure.
function runAgent(agentName, prompt, ctx, extra = {}) {
  return ctx.engine.runAgent(agentName, prompt, ctx, {
    needsBash: extra.allowedTools === 'Bash',
    needsWeb: extra.allowedTools === 'Web',
  });
}

// Intake runs INTERACTIVELY (the user answers) — the engine inherits stdio so
// they can converse. The intake session writes the resolved brief to brief.md.
function runIntake(idea, ctx) {
  const prompt = [
    'You are the intake step of the gspec build.',
    `The idea to build: ${idea}`,
    'Interview the user ONCE to resolve the decisions the whole autonomous build pivots on:',
    'product type & primary audience, technology lean, visual style direction (or "no UI"), and scope boundaries.',
    ...(ctx.research ? ['This build includes the competitive-research stage, so also ask for known competitors (names or URLs) and note them in the brief.'] : []),
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

// The validator sees the deliverable fresh each pass. On a RE-validation (after a
// surgical revision) it also gets the verdict it is re-checking, so it confirms
// which findings the revision resolved BEFORE raising new ones and holds the bar
// steady — the counter to the observed "every revision surfaces a fresh nit,
// budget drains" non-convergence (feedback §2).
function validatorPrompt(stage, target = '', priorVerdict = '') {
  const base = `Validate ${target || `the ${stage.title}`} against its quality bar and return the structured verdict (first line "VERDICT: PASS" or "VERDICT: FAIL", then findings).`;
  if (!priorVerdict) return base;
  return [
    base,
    '',
    'This is a RE-validation after a surgical revision. First, for each finding in the prior verdict below, state whether it is RESOLVED — only then raise any finding that remains. Judge against the SAME quality bar as before; do not raise it. A concern you notice only in text the writer added to address a prior finding is at most a [minor] unless it is a genuine blocker/major defect — do not invent fresh precision nits to justify another FAIL. Per the verdict contract, FAIL only if a blocker or major finding stands.',
    '',
    '--- Prior verdict being re-checked ---',
    priorVerdict,
  ].join('\n');
}

// Grade a validator verdict by severity, ENFORCING the gspec-qa contract that a
// spec FAILs only on a blocker/major finding (feedback §1 — the loop had no
// reachable exit because validators over-failed on minor/nit polish). Verdicts
// tag findings `[blocker] / [major] / [minor] / [nit]`. A FAIL whose findings are
// all minor/nit (and at least one exists) is DOWNGRADED to an effective PASS
// that carries advisory notes. Conservative: if the verdict names any
// blocker/major finding, or has no gradeable `[severity]` tags at all, the
// validator's FAIL stands unchanged — the driver never invents a pass where it
// cannot positively see that nothing blocking was found.
export function gradeVerdict(text) {
  const raw = parseVerdict(text);            // PASS | FAIL | null
  if (raw !== 'FAIL') return { verdict: raw, downgraded: false };
  const s = String(text);
  const hasBlocking = /\[\s*(blocker|major)\s*\]/i.test(s);
  const hasAdvisory = /\[\s*(minor|nit)\s*\]/i.test(s);
  if (!hasBlocking && hasAdvisory) return { verdict: 'PASS', downgraded: true };
  return { verdict: 'FAIL', downgraded: false };
}

// Human-friendly elapsed time for the per-stage cost signal (feedback §8).
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// sha256 of a repo-relative file's contents (content-addressed memoization,
// feedback §5), or null if it can't be read.
async function hashFile(cwd, rel) {
  try { return createHash('sha256').update(await readFile(join(cwd, rel), 'utf-8')).digest('hex'); }
  catch { return null; }
}

// True only if every listed output exists and is non-empty — the "did the writer
// actually produce its artifact?" check behind the crash-vs-gate distinction.
async function outputsPresent(cwd, outputs = []) {
  if (!outputs.length) return false;
  for (const rel of outputs) {
    try { if (!(await stat(join(cwd, rel))).size) return false; } catch { return false; }
  }
  return true;
}

// A feature PRD that exists, has real content, and opens with frontmatter or a
// heading — "complete and well-formed enough to let QA judge it" (feedback §7).
async function looksCompletePrd(cwd, prd) {
  try {
    const t = (await readFile(join(cwd, 'gspec', 'features', prd), 'utf-8')).trim();
    return t.length > 40 && (t.startsWith('---') || /^#/m.test(t));
  } catch { return false; }
}

// Run a writer agent, distinguishing a transient process crash from a genuine
// failure to produce the deliverable (feedback §7: a complete, well-formed PRD
// was discarded because the agent exited 1 on a post-write crash). On a non-zero
// exit, retry once; if it still exits non-zero but the expected artifact is now
// present (and, where checkable, parses), accept it and let the QA gate judge
// quality rather than restarting the whole stage. `artifactOk` is an async
// predicate; omit it to just retry once.
async function runWriterResilient(agentName, prompt, ctx, extra, artifactOk) {
  let out = await runAgent(agentName, prompt, ctx, extra);
  if (out.code === 0) return out;
  log(chalk.dim(`      ${agentName} exited ${out.code} — retrying once (may be a transient post-write crash)…`));
  out = await runAgent(agentName, prompt, ctx, extra);
  if (out.code === 0) return out;
  if (artifactOk && await artifactOk()) {
    log(chalk.dim(`      ${agentName} exited ${out.code} again, but its artifact is present and well-formed — accepting and letting QA judge it.`));
    return { ...out, code: 0, recovered: true };
  }
  return out;
}

// --- the self-healing writer -> validator gate ----------------------------

// A QA revision is a repair, not a rewrite. Re-sending the full authoring
// prompt with a verdict stapled on biases a fresh agent toward generating more
// material (drafts were observed growing while "fixing" contradictions in what
// they already had). So the revision prompt names the deliverable, carries
// EVERY verdict so far (attempt N sees what N-1 was told), and restricts the
// writer to the edits the findings name. The failed verdict is also the
// trigger of the memory-capture convention (gspec-memory), so capture is a
// stated step of the run — conditional, since only some engines have a silo.
export function revisePrompt(stage, target, verdicts) {
  const history = verdicts.map((v, i) =>
    `--- Verdict ${i + 1} of ${verdicts.length}${i === verdicts.length - 1 ? ' (current — fix this one)' : ' (an earlier attempt already tried to fix this)'} ---\n${v}`).join('\n\n');
  return [
    `You are the "${stage.title}" stage of an autonomous gspec build. You cannot ask the user questions.`,
    `A prior draft of ${target} failed QA. This is a surgical revision, not a rewrite: read the existing document and make ONLY the edits the findings below name, preserving everything else byte-for-byte. Do not add sections or material no finding asks for.`,
    'Resolve each finding in place. Growing the document by more than ~10% while resolving no blocker/major finding is itself a defect — precision comes from tightening what is there, not from appending prose (which only gives the next QA pass new text to fault).',
    ...(verdicts.length > 1 ? ['Every verdict so far is included below, oldest first. A finding that reappears in a later verdict means the earlier fix did not land — fix it differently rather than repeating it.'] : []),
    'This failed verdict is corrective feedback: if the gspec-memory convention is in your instructions, record the generalizable lesson (or state in your summary why the finding was purely project-specific) before returning.',
    '',
    history,
  ].join('\n');
}

// `opts.revalidate` (feedback §4): resuming a stage that FAILED QA re-validates
// the deliverable on disk FIRST instead of regenerating it — so a hand-edit the
// user made to unblock is honored, and the gate is re-enforced rather than
// skipped. The initial writer pass is run only for a genuine first authoring.
async function gate(stage, writerPrompt, validatorTarget, ctx, opts = {}) {
  const target = validatorTarget || (stage.outputs || []).join(' or ') || `the ${stage.title} deliverable`;
  const outputsOk = () => outputsPresent(ctx.cwd, stage.outputs || (validatorTarget ? [validatorTarget] : []));

  if (opts.revalidate) {
    log(chalk.dim('      resumed after a QA failure — re-validating the current draft (any hand-edits preserved) instead of regenerating.'));
  } else {
    const out = await runWriterResilient(stage.writer, writerPrompt, ctx, {}, outputsOk);
    if (out.code !== 0) return { status: 'failed', reason: `${stage.writer} exited ${out.code}` };
  }
  if (ctx.noQa || !stage.validator) return { status: 'done', verdict: ctx.noQa ? 'skipped' : null };

  let v = await runAgent(stage.validator, validatorPrompt(stage, validatorTarget), ctx);
  let g = gradeVerdict(v.text);
  if (g.verdict === 'PASS') return finishPass(stage, target, v, g, ctx);

  // self-heal revisions from the verdict, up to ctx.qaRetries (--qa-retries)
  const verdicts = [v.text];
  for (let r = 1; r <= ctx.qaRetries; r++) {
    await ctx.recordFeedback(stage, stage.validator, v.text, { target, attempt: r });
    log(chalk.yellow(`      QA flagged issues — revision ${r}/${ctx.qaRetries}… (${summarize(v.text)})`));
    const addressed = v.text; // the verdict this revision is trying to resolve
    const out = await runWriterResilient(stage.writer, revisePrompt(stage, target, verdicts), ctx, {}, outputsOk);
    if (out.code !== 0) return { status: 'failed', reason: `${stage.writer} (revision ${r}) exited ${out.code}` };
    v = await runAgent(stage.validator, validatorPrompt(stage, validatorTarget, addressed), ctx);
    g = gradeVerdict(v.text);
    if (g.verdict === 'PASS') return finishPass(stage, target, v, g, ctx);
    verdicts.push(v.text);
  }
  // `detail` carries the verdict that ended the run; the driver prints it and
  // persists it (manifest + last-failure.md) so the pause is actionable.
  return { status: 'failed', reason: `QA gate did not pass after ${countNoun(ctx.qaRetries, 'revision')}`, verdict: g.verdict || 'unknown', detail: v.text };
}

// A gate passed. If the pass was a driver DOWNGRADE (validator said FAIL but only
// minor/nit findings stood — feedback §1), surface it and keep the advisory notes
// in the durable log so nothing is silently swallowed.
async function finishPass(stage, target, v, g, ctx) {
  if (g.downgraded) {
    log(chalk.dim(`      QA returned only minor/nit findings — passing per the severity contract; notes kept in ${QA_LOG_PATH} (${summarize(v.text)})`));
    await ctx.recordAdvisory(stage, target, v.text);
    return { status: 'done', verdict: 'PASS (advisory notes)' };
  }
  return { status: 'done', verdict: 'PASS' };
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

async function runStage(stage, ctx, opts = {}) {
  const brief = ctx.brief;
  // Resuming a stage this run already recorded `failed` (or crashed mid-run,
  // `running`) must re-enforce its QA gate, not skip it because the failed draft
  // exists (feedback §4). Skip-if-present is reserved for a genuinely pre-existing
  // spec on a stage that never ran.
  const rerunning = opts.priorStatus === 'failed' || opts.priorStatus === 'running';
  switch (stage.type) {
    case 'foundation': {
      let present = null;
      for (const out of stage.outputs) if (await pathExists(ctx.cwd, out)) { present = out; break; }
      if (present && !rerunning) return { status: 'skipped', reason: `${present} already exists` };
      return gate(stage, stageBrief(stage, brief), '', ctx, { revalidate: !!present && rerunning });
    }
    case 'gated': {
      const present = await outputsPresent(ctx.cwd, stage.outputs);
      return gate(stage, stageBrief(stage, brief), '', ctx, { revalidate: present && rerunning });
    }

    // Opt-in (--research). Headless /gspec-research: the planner turns the
    // profile + brief into a competitor list (fenced JSON, like the
    // build-orchestrator's wave plan), one researcher per competitor fans out
    // in parallel, and the writer synthesizes gspec/research.md — auto-accepting
    // findings, since there is no human to walk the accept/reject review.
    case 'research': {
      if (!ctx.research) return { status: 'skipped', reason: 'not requested (--research)' };
      for (const out of stage.outputs) {
        if (await pathExists(ctx.cwd, out)) return { status: 'skipped', reason: `${out} already exists` };
      }

      const p = await runAgent(stage.planner, stageBrief(stage, brief, 'Plan this research run: read gspec/profile.md (Market & Competition, Value Proposition) and the brief above, and return ONLY the research-plan JSON (focus + competitors).'), ctx);
      if (p.code !== 0) return { status: 'failed', reason: `${stage.planner} exited ${p.code}` };
      if (ctx.dryRun) {
        log(chalk.dim('      would fan out one competitor-researcher per planned competitor, then research-writer → gspec/research.md'));
        return { status: 'done', verdict: 'report' };
      }
      const plan = parseResearchPlan(p.text);
      if (!plan || plan.competitors.length === 0) return { status: 'skipped', reason: 'no competitors identified in the profile or brief' };
      if (plan.competitors.length > MAX_COMPETITORS) {
        log(chalk.yellow(`      ${plan.competitors.length} competitors planned — researching the first ${MAX_COMPETITORS} (dropping: ${plan.competitors.slice(MAX_COMPETITORS).map((c) => c.name).join(', ')}).`));
        plan.competitors = plan.competitors.slice(0, MAX_COMPETITORS);
      }

      log(chalk.dim(`      researching ${plan.competitors.length} competitor(s): ${plan.competitors.map((c) => c.name).join(', ')}`));
      const runs = await Promise.all(plan.competitors.map((c) => {
        const prompt = `You are one research fan-out of an autonomous gspec build; you cannot ask the user questions. Research this one competitor and return the structured teardown: ${c.name}${c.context ? ` (${c.context})` : ''}. Research focus: ${plan.focus || 'core capabilities, UX patterns, strengths and weaknesses'}.`;
        return runAgent(stage.researcher, prompt, ctx, { allowedTools: 'Web' });
      }));
      const bad = runs.findIndex((r) => r.code !== 0);
      if (bad >= 0) return { status: 'failed', reason: `${stage.researcher} ("${plan.competitors[bad].name}") exited ${runs[bad].code}` };

      const teardowns = runs.map((r, i) => `### ${plan.competitors[i].name}\n\n${String(r.text).trim()}`).join('\n\n');
      const w = await runAgent(stage.writer, stageBrief(stage, brief, [
        'Synthesize the competitor teardowns below into gspec/research.md yourself — no interactive review happened:',
        'build the competitive feature matrix, categorize findings (table-stakes / differentiating / white-space), run the gap',
        'analysis against the profile and brief, and decide the accepted list on your own product judgment — accept',
        'table-stakes findings and those clearly aligned with the profile, and label every accepted finding "auto-accepted by the build".',
        '',
        `Research focus: ${plan.focus || '(none stated)'}`,
        '',
        '## Competitor teardowns',
        '',
        teardowns,
      ].join('\n')), ctx);
      if (w.code !== 0) return { status: 'failed', reason: `${stage.writer} exited ${w.code}` };
      return { status: 'done', verdict: 'report' };
    }

    case 'features': {
      // If the research stage ran, its accepted findings feed the PRDs — that
      // is the whole point of --research.
      const researchExists = await pathExists(ctx.cwd, 'gspec/research.md');
      const researchNote = researchExists
        ? ' Competitive research exists at gspec/research.md — read it and cover its accepted findings as features (noting each one\'s competitive origin).'
        : '';

      // Decompose first (design §8: the features stage is feature-writer ×N).
      // The feature-planner turns the brief (+ research.md) into a right-sized
      // set of features; the driver then fans out one feature-writer per feature
      // — the headless counterpart of /gspec-feature's scope-assessment step,
      // both drawing on the same decomposition heuristic in gspec-product. No
      // usable breakdown → one monolithic feature-writer call (a single-feature
      // idea, or a planner that couldn't split), so the stage never yields zero.
      let plan = null;
      if (stage.planner) {
        const p = await runAgent(stage.planner, stageBrief(stage, brief, `Plan the feature breakdown for this idea: read the brief above${researchExists ? ', gspec/research.md,' : ''} and any existing gspec/features/, then return ONLY the feature-plan JSON (slug, title, brief, priority, dependencies).`), ctx);
        plan = p.code === 0 ? parseFeaturePlan(p.text) : null;
      }

      if (ctx.dryRun) {
        log(chalk.dim('      would decompose the brief (feature-planner), then fan out one feature-writer per planned feature and validate each PRD'));
        return { status: 'done', verdict: 'PASS' };
      }

      if (plan && plan.length > MAX_FEATURES) {
        log(chalk.yellow(`      ${plan.length} features planned — writing the first ${MAX_FEATURES} (dropping: ${plan.slice(MAX_FEATURES).map((f) => f.slug).join(', ')}).`));
        plan = plan.slice(0, MAX_FEATURES);
      }

      if (plan) {
        log(chalk.dim(`      decomposed into ${plan.length} feature(s): ${plan.map((f) => f.slug).join(', ')}`));
        // File-disjoint slugs (dedup guarantees it) → fan out, at most
        // FEATURE_WRITER_CONCURRENCY writers in flight so a big breakdown doesn't
        // spawn a thundering herd of headless agents. The planner already
        // resolved overlap and named dependencies, so each writer cross-links
        // siblings by slug without needing to read a not-yet-written sibling file.
        const runs = await mapLimit(plan, FEATURE_WRITER_CONCURRENCY, async (f) => {
          // Checkpoint the writing fan-out on resume: a sibling PRD already
          // written and well-formed is NOT regenerated when we re-enter this
          // stage after a failure — so one writer dying (e.g. token exhaustion)
          // doesn't re-spend the token cost of every other feature, and a PRD
          // hand-edited during the pause is preserved. Only on a re-run
          // (priorStatus failed/running); a fresh run always writes. The skipped
          // PRD is still re-checked by the validation loop below, so a truncated
          // draft that slips the well-formed check is caught there.
          if (rerunning && await looksCompletePrd(ctx.cwd, `${f.slug}.md`)) {
            log(chalk.dim(`      ✓ ${f.slug}.md — already written; skipping regeneration (QA re-checks it below)`));
            return { code: 0, skipped: true };
          }
          const deps = f.dependencies.filter((d) => d !== f.slug);
          const scope = [
            `Write ONE feature of a decomposed set into gspec/features/${f.slug}.md (use this exact slug as the filename).`,
            `Feature: ${f.title}${f.priority ? ` (${f.priority})` : ''}.`,
            f.brief ? `Scope: ${f.brief}` : '',
            deps.length ? `Depends on these sibling features — cross-link them by slug: ${deps.join(', ')}.` : '',
            researchNote.trim(),
          ].filter(Boolean).join('\n');
          // A post-write crash must not discard a complete PRD (feedback §7): accept
          // a non-zero exit whose PRD file is present and well-formed.
          return runWriterResilient(stage.writer, stageBrief(stage, brief, scope), ctx, {}, () => looksCompletePrd(ctx.cwd, `${f.slug}.md`));
        });
        const bad = runs.findIndex((r) => r.code !== 0);
        if (bad >= 0) return { status: 'failed', reason: `${stage.writer} ("${plan[bad].slug}") exited ${runs[bad].code}` };
      } else {
        // No usable breakdown → one PRD from the whole brief (single-feature idea).
        const w = await runWriterResilient(stage.writer, stageBrief(stage, brief, `Write the feature PRD for this idea into gspec/features/.${researchNote}`), ctx, {}, async () => (await listFeaturePrds(ctx.cwd)).length > 0);
        if (w.code !== 0) return { status: 'failed', reason: `${stage.writer} exited ${w.code}` };
      }
      if (ctx.noQa) return { status: 'done', verdict: 'skipped' };
      const prds = await listFeaturePrds(ctx.cwd);
      let advisory = 0;
      for (const prd of prds) {
        const target = `gspec/features/${prd}`;
        // A PRD unchanged since it last passed QA is not re-gated (feedback §5):
        // the features stage restarts over the whole PRD list on every resume, so
        // without this an already-passing PRD burns a fresh budget each time — and
        // its verdict was observed to be unstable across re-gates.
        if (await ctx.isMemoized('features', prd, target)) {
          log(chalk.dim(`      ✓ ${target} — unchanged since it passed; skipping re-validation`));
          continue;
        }
        let v = await runAgent(stage.validator, validatorPrompt(stage, target), ctx);
        let g = gradeVerdict(v.text);
        if (g.verdict === 'FAIL') {
          const verdicts = [v.text];
          for (let r = 1; r <= ctx.qaRetries; r++) {
            await ctx.recordFeedback(stage, stage.validator, v.text, { target, attempt: r });
            log(chalk.yellow(`      QA flagged issues in ${target} — revision ${r}/${ctx.qaRetries}… (${summarize(v.text)})`));
            const addressed = v.text;
            await runWriterResilient(stage.writer, revisePrompt(stage, target, verdicts), ctx, {}, () => looksCompletePrd(ctx.cwd, prd));
            v = await runAgent(stage.validator, validatorPrompt(stage, target, addressed), ctx);
            g = gradeVerdict(v.text);
            if (g.verdict === 'PASS') break;
            verdicts.push(v.text);
          }
          if (g.verdict !== 'PASS') return { status: 'failed', reason: `QA gate failed for ${target}`, detail: v.text };
        }
        if (g.downgraded) {
          advisory++;
          log(chalk.dim(`      ${target} — passed with only minor/nit findings (per the severity contract); notes kept in ${QA_LOG_PATH}`));
          await ctx.recordAdvisory(stage, target, v.text);
        }
        await ctx.memoize('features', prd, target); // record the passing content hash
      }
      return { status: 'done', verdict: advisory ? `PASS (${advisory} with advisory notes)` : 'PASS' };
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
            await ctx.recordFeedback(stage, stage.validator, v.text, { target: `gspec/tasks/${slug}.md`, resolution: 'non-blocking QA note — run continued without a revision' });
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
      // non-zero exit re-delegates the implementer with the exact failure, up
      // to ctx.qaRetries times (--qa-retries).
      if (await pathExists(ctx.cwd, 'verify.sh')) {
        let v = await runVerify(ctx);
        for (let r = 1; v.code !== 0 && r <= ctx.qaRetries; r++) {
          await ctx.recordFeedback(stage, 'verify.sh', `build/test failed (exit ${v.code}) / ${tail(v.output, 300)}`, { target: 'verify.sh', attempt: r, full: `build/test failed (exit ${v.code})\n\n${v.output}` });
          log(chalk.yellow(`      verify.sh failed — self-heal ${r}/${ctx.qaRetries}…`));
          const fix = `${buildPrompt}\n\nverify.sh failed (exit ${v.code}). Fix the code so build+test pass; do not weaken the tests to make them pass. Output:\n${tail(v.output)}`;
          out = await runAgent(stage.agent, fix, ctx, { allowedTools: 'Bash' });
          if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (verify self-heal ${r}) exited ${out.code}` };
          v = await runVerify(ctx);
        }
        if (v.code !== 0) return { status: 'failed', reason: `verify.sh still failing after ${countNoun(ctx.qaRetries, 'self-heal')}`, verdict: 'FAIL', detail: v.output };
      }

      // Gate part 2 — judgment. implementation-validator checks the in-scope
      // acceptance criteria + Definition of Done; up to ctx.qaRetries
      // self-heals on FAIL (--qa-retries).
      if (!stage.validator) return { status: 'done', verdict: 'PASS' };
      const jvTarget = 'the implemented scope';
      let jv = await runAgent(stage.validator, validatorPrompt(stage, jvTarget), ctx, { allowedTools: 'Bash' });
      let jg = gradeVerdict(jv.text);
      if (jg.verdict === 'PASS') return finishPass(stage, jvTarget, jv, jg, ctx);
      for (let r = 1; r <= ctx.qaRetries; r++) {
        await ctx.recordFeedback(stage, stage.validator, jv.text, { target: jvTarget, attempt: r });
        log(chalk.yellow(`      implementation QA flagged issues — revision ${r}/${ctx.qaRetries}… (${summarize(jv.text)})`));
        const addressed = jv.text;
        const revise = `${buildPrompt}\n\nThe implementation failed QA. Address this verdict, then ensure verify.sh still passes:\n${jv.text}`;
        out = await runAgent(stage.agent, revise, ctx, { allowedTools: 'Bash' });
        if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (QA revision ${r}) exited ${out.code}` };
        jv = await runAgent(stage.validator, validatorPrompt(stage, jvTarget, addressed), ctx, { allowedTools: 'Bash' });
        jg = gradeVerdict(jv.text);
        if (jg.verdict === 'PASS') return finishPass(stage, jvTarget, jv, jg, ctx);
      }
      return { status: 'failed', reason: `implementation QA gate did not pass after ${countNoun(ctx.qaRetries, 'revision')}`, verdict: jg.verdict || 'unknown', detail: jv.text };
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

// Parse the research-planner's plan (a fenced JSON block: { focus, competitors:
// [{ name, context }] }). Returns { focus, competitors } with malformed entries
// dropped, or null if nothing usable — the caller then skips the stage.
// Defensive for the same reason as parseBuildPlan: the plan is model output.
function parseResearchPlan(text) {
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  const competitors = (Array.isArray(obj?.competitors) ? obj.competitors : [])
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
    .map((c) => ({ name: c.name.trim(), context: typeof c.context === 'string' ? c.context.trim() : '' }));
  return { focus: typeof obj?.focus === 'string' ? obj.focus.trim() : '', competitors };
}

// A scope's `plan` — the file(s) whose checkboxes track the scope's progress —
// may arrive as a string or an array (or be absent, e.g. a scaffold scope).
// Normalize to a clean string[] the continuation loop can count.
function normalizePlanFiles(v) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : []);
  return arr.map((f) => String(f).trim()).filter(Boolean);
}

// A planner-proposed slug becomes a filename (gspec/features/<slug>.md), so
// sanitize it to a safe kebab-case token — model output must not be able to
// escape the features dir (e.g. "../x") or carry spaces/uppercase.
function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'feature';
}

// Parse the feature-planner's plan (a fenced JSON block: { features: [{ slug,
// title, brief, priority, dependencies }] }). Returns a normalized, slug-deduped
// array of features with malformed entries dropped, or null if nothing usable —
// the caller then falls back to a single monolithic feature-writer call.
// Defensive for the same reason as parseBuildPlan: the plan is model output.
function parseFeaturePlan(text) {
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  const seen = new Set();
  const features = [];
  for (const f of Array.isArray(obj?.features) ? obj.features : []) {
    if (!f || typeof f.slug !== 'string' || !f.slug.trim()) continue;
    const slug = slugify(f.slug);
    if (seen.has(slug)) continue; // disjoint filenames for a safe parallel fan-out
    seen.add(slug);
    features.push({
      slug,
      title: typeof f.title === 'string' && f.title.trim() ? f.title.trim() : slug,
      brief: typeof f.brief === 'string' ? f.brief.trim() : '',
      priority: typeof f.priority === 'string' ? f.priority.trim() : '',
      dependencies: normalizePlanFiles(f.dependencies).map(slugify),
    });
  }
  return features.length ? features : null;
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

export async function runBuild({ idea, cwd = process.cwd(), engine, noQa = false, noReview = false, research = false, qaRetries, resume = false, dryRun = false, permissionMode = 'acceptEdits', piPermissionLevel } = {}) {
  let manifest = await loadManifest(cwd);

  // --qa-retries: how many self-heal revisions each QA gate may attempt before
  // pausing the run (default 1, the original behavior; 0 = fail on first
  // verdict). Validated here, while aborting is still free.
  let explicitQaRetries;
  if (qaRetries !== undefined) {
    explicitQaRetries = Number.parseInt(qaRetries, 10);
    if (!Number.isInteger(explicitQaRetries) || explicitQaRetries < 0 || String(explicitQaRetries) !== String(qaRetries).trim()) {
      console.error(chalk.red(`\n  --qa-retries must be a whole number >= 0 (got "${qaRetries}").\n`));
      process.exit(1);
    }
  }

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
  // this project was installed for (.gspec/config.json), else the one engine
  // whose agent files are installed here (pre-2.0.1 installs recorded no
  // target), else claude.
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
      const installed = [];
      for (const name of ENGINE_NAMES) {
        if (await pathExists(cwd, getEngine(name).agentFile(STAGES[0].writer))) installed.push(name);
      }
      if (installed.length === 1) {
        engineName = installed[0];
        log(chalk.dim(`  Using engine "${engineName}" (its gspec agents are installed here).`));
      } else if (installed.length > 1) {
        console.error(chalk.red(`\n  gspec is installed for more than one engine here (${installed.join(', ')}).`));
        console.error(chalk.dim(`  Pick one explicitly: gspec build --engine <${installed.join('|')}> "<idea>"\n`));
        process.exit(1);
      } else {
        engineName = 'claude'; // preflight below reports "no engine installed"
      }
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
        // Nothing chose claude — it's the last-resort default, and the probe
        // above already ruled out every engine's installed agents.
        console.error(chalk.red('\n  gspec is not installed for any build engine in this project'));
        console.error(chalk.red(`  (checked ${ENGINE_NAMES.map((n) => dirname(getEngine(n).agentFile('x'))).join(', ')}).`));
        console.error(chalk.dim(`  Install it for the harness you build on first: npx gspec -t <${ENGINE_NAMES.join('|')}>`));
        console.error(chalk.dim(`  Then re-run: gspec build "<idea>" (or pass --engine explicitly).\n`));
        process.exit(1);
      }
      log(chalk.yellow(`  Note: ${probe} not found — assuming Claude Code gets its gspec agents from the plugin.`));
    }
  }

  if (!manifest) {
    manifest = initManifest(idea, { engine: engineName, noQa, noReview, research, qaRetries: explicitQaRetries, permissionMode });
    await saveManifest(cwd, manifest);
  } else if (research && !manifest.research) {
    // --research is pinned at run start (like engine/noQa, unlike --no-review):
    // enabling it mid-run would hand later stages a research.md the stages that
    // already ran never saw.
    log(chalk.yellow('  Note: this run started without --research — ignoring it (research is pinned at run start).'));
  }

  // Ensure a memory-silo baseline exists (fresh run, or an older manifest being
  // resumed). Taken before any stage runs, so the end-of-run diff is net-new.
  manifest.learnings = manifest.learnings || [];
  if (!manifest.learningsBaseline) {
    manifest.learningsBaseline = await snapshotMemory(cwd);
    await saveManifest(cwd, manifest);
  }

  // A --qa-retries at resume time is honored for this invocation (like
  // --no-review): the retried stage reruns from scratch anyway, so a different
  // revision budget never makes past stages inconsistent. Otherwise the run
  // keeps the count it started with (pre-flag manifests default to 1).
  const qaRetryCount = explicitQaRetries ?? manifest.qaRetries ?? 1;

  const ctx = { cwd, engine: selectedEngine, noQa: manifest.noQa, research: !!manifest.research, qaRetries: qaRetryCount, permissionMode: manifest.permissionMode, piPermissionLevel, dryRun, brief: '', log };
  // Record a QA FAIL the driver observed (the feedback signal a lesson comes
  // from). Two durable channels: (1) a compact excerpt on the manifest's array
  // (each saveManifest persists it; drives the end-of-run learnings report),
  // and (2) the FULL verdict appended to qa-failures.md so the failure is
  // reviewable later even if the self-heal recovers. `meta.full` overrides the
  // log text when the summarizable form differs from what's worth keeping
  // verbatim (e.g. verify.sh: a tidy excerpt vs. the whole build/test output).
  ctx.recordFeedback = async (stage, agent, text, meta = {}) => {
    manifest.learnings.push({ at: new Date().toISOString(), stage: stage.id, agent, excerpt: summarize(text) });
    if (dryRun) return;
    const { full, ...rest } = meta;
    await appendQaFailure(cwd, { stage, checker: agent, retries: ctx.qaRetries, text: full ?? text, ...rest });
  };
  // A gate PASS the driver produced by downgrading a minor/nit-only FAIL (§1).
  // Not a self-heal event (no revision happened), so it stays off the manifest's
  // learnings list; it is kept in the durable log so the advisory notes survive.
  ctx.recordAdvisory = async (stage, target, text) => {
    if (dryRun) return;
    await appendQaFailure(cwd, { stage, checker: stage.validator, target, advisory: true, text });
  };
  // Content-addressed memoization (§5). A stage's manifest record carries a
  // `passed` map of { key -> sha256 } for deliverables that passed QA; a key whose
  // file hash is unchanged is skipped on the next pass. Persisted so it survives a
  // resume, which is exactly when re-gating unchanged specs wastes the most time.
  ctx.isMemoized = async (stageId, key, filePath) => {
    const stored = manifest.stages[stageId]?.passed?.[key];
    if (!stored) return false;
    return stored === await hashFile(cwd, filePath);
  };
  ctx.memoize = async (stageId, key, filePath) => {
    if (dryRun) return;
    const h = await hashFile(cwd, filePath);
    if (!h) return;
    const st = (manifest.stages[stageId] ??= { status: 'pending', attempts: 0, verdict: null });
    (st.passed ??= {})[key] = h;
    await saveManifest(cwd, manifest);
  };

  // A --no-review at resume time is honored too (unlike engine/noQa, which stay
  // pinned): it only widens what runs unattended, never changes how a stage ran.
  const skipReview = !!(manifest.noReview || noReview);

  log(chalk.bold(`\n  gspec build — ${chalk.cyan(manifest.idea)}`));
  const qaMode = manifest.noQa ? 'off (--no-qa)' : qaRetryCount === 1 ? 'on' : `on (qa-retries: ${qaRetryCount})`;
  const researchMode = manifest.research ? ' · competitive research: on' : '';
  log(chalk.dim(`  engine: ${engineName} · QA gates: ${qaMode}${researchMode} · spec review: ${skipReview ? 'off (--no-review)' : 'pauses before implementation'} · resumable · ${dryRun ? 'DRY RUN' : 'autonomous after intake'}\n`));

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

  // Stage loop — resume skips done/skipped stages. A manifest written before a
  // stage existed (e.g. pre-review-gate runs) has no entry for it: default one
  // so an in-flight run survives a gspec upgrade.
  for (const stage of STAGES) {
    const st = (manifest.stages[stage.id] ??= { status: 'pending', attempts: 0, verdict: null });
    if (st.status === 'done' || st.status === 'skipped') { log(chalk.dim(`  ✓ ${stage.title} — ${st.status}`)); continue; }

    // The spec-review human gate: pause (exit 0) on first arrival; a --resume
    // that lands on the paused gate is the approval and continues into
    // implementation. Reached with status "pending" (e.g. resuming from an
    // earlier stage failure) it still pauses — the user hasn't reviewed yet.
    if (stage.type === 'review') {
      if (skipReview) {
        st.status = 'skipped'; st.reason = '--no-review'; await saveManifest(cwd, manifest);
        log(chalk.dim(`  ↷ ${stage.title} — skipped (--no-review)`));
        continue;
      }
      if (dryRun) {
        log(chalk.dim(`  ▸ ${stage.title} — would pause here for review (continue with --resume; skip with --no-review)`));
        continue;
      }
      if (st.status === 'paused' && resume) {
        st.status = 'done'; st.verdict = 'approved'; await saveManifest(cwd, manifest);
        log(chalk.green(`  ✓ ${stage.title} — approved (resumed after review)`));
        continue;
      }
      st.status = 'paused'; st.attempts += 1; await saveManifest(cwd, manifest);
      log(chalk.bold.yellow('\n  ⏸ Paused for spec review — the specs are written; no code has been generated yet.'));
      log(chalk.yellow('  Review (and freely edit) the specs: gspec/profile.md, stack.md, practices.md, style.*, architecture.md (+ architecture/), features/, tasks/'));
      log(chalk.yellow('  When they look right, continue into implementation with: gspec build --resume'));
      log(chalk.dim('  (Skip this pause with --no-review — on the resume, or on a future fresh run.)\n'));
      process.exit(0);
    }

    log(chalk.bold(`  ▸ ${stage.title}`));
    // The status BEFORE this attempt drives §4's resume behavior: a `failed`
    // (or crashed `running`) stage re-validates its draft rather than skipping.
    const priorStatus = st.status;
    const startedAt = Date.now();
    st.status = 'running'; st.attempts += 1; await saveManifest(cwd, manifest);

    let result;
    try {
      result = await runStage(stage, ctx, { priorStatus });
    } catch (e) {
      result = { status: 'failed', reason: e.message };
    }

    // Per-stage cost signal (§8): accumulate elapsed across resumes, and keep a
    // running total on the manifest so the tradeoff is visible while it matters.
    const elapsedMs = Date.now() - startedAt;
    st.elapsedMs = (st.elapsedMs || 0) + elapsedMs;
    manifest.totalElapsedMs = (manifest.totalElapsedMs || 0) + elapsedMs;

    // Clear failure fields from a prior attempt so a clean retry doesn't keep
    // carrying a stale reason/detail in the manifest.
    delete st.reason; delete st.detail;
    Object.assign(st, result);
    await saveManifest(cwd, manifest);

    if (result.status === 'failed') {
      log(chalk.red(`  ✗ ${stage.title} — ${result.reason || 'failed'}`));
      await reportFailure(cwd, stage, result, dryRun);
      await reportLearnings(cwd, manifest);
      log(chalk.yellow(`\n  ⚠ Action required: the build is paused at "${stage.title}".`));
      log(chalk.yellow(`  Review the failure above (kept in ${LAST_FAILURE_PATH} and the stage's "detail" in ${MANIFEST_PATH};`));
      log(chalk.yellow(`  every QA failure this run, including recovered ones, is in ${QA_LOG_PATH}),`));
      log(chalk.yellow('  fix it, then re-run with --resume to continue from exactly here.\n'));
      process.exit(1);
    }
    const took = result.status === 'skipped' ? '' : chalk.dim(` (${fmtDuration(elapsedMs)})`);
    log(chalk[result.status === 'skipped' ? 'dim' : 'green'](`  ${result.status === 'skipped' ? '↷' : '✓'} ${stage.title} — ${result.verdict || result.status}`) + took);
  }

  if (!dryRun) await rm(join(cwd, LAST_FAILURE_PATH), { force: true }); // a completed run has no live failure
  log(chalk.bold.green('\n  ✓ Build complete.') + (manifest.totalElapsedMs ? chalk.dim(` (${fmtDuration(manifest.totalElapsedMs)} of stage time across all runs)`) : ''));
  log(chalk.dim(`  Specs + code are in place; see .gspec/build/run.json for the run record.`));
  await reportLearnings(cwd, manifest);
  log('');
}

async function readBrief(cwd) {
  try { return await readFile(join(cwd, BRIEF_PATH), 'utf-8'); } catch { return ''; }
}
