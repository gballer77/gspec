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
// Sync counterparts, used ONLY on the crash path: a handler that must finish
// before process.exit cannot await anything.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import chalk from 'chalk';
import { getEngine, ENGINE_NAMES } from './engines.js';

// This driver's own version, for the installed-agents freshness check below.
const GSPEC_VERSION = createRequire(fileURLToPath(import.meta.url))('../package.json').version;
import { readProjectConfig, readGlobalConfig, resolveModel, modelSelectors } from './config.js';
import { parseModulesTable, moduleSpecPaths, droppedModules } from '../plugin/hooks/floors/modules.mjs';
import { archLintViolations, designLintViolations, planLintViolations, parallelismViolations, coversViolations, anchorModules, anchorRefs, originAnchors, duplicateOrigins, containedAnchors, slugifyAnchor } from '../plugin/hooks/floors/plan-lint.mjs';
import { appliesToTokenLiterals, tokenLiteralViolations } from '../plugin/hooks/floors/token-literals.mjs';
import { filesNamedByCheckedTasks, missingWorkViolations, stubViolations, checkboxConsistency } from '../plugin/hooks/floors/implementation-lint.mjs';
import { accumulate, waste, lintVsQa } from './usage.js';
import { lintFixPrompt } from './lint-fix.js';
import { remainingTaskBrief, formatRemainingBrief, firstRunGroupBrief } from './scope-brief.js';
import { partialWorkBrief, partialWorkEvidence } from './partial-work.js';
import { anchoredRevisionBlocks, summarizeRounds } from './revision-brief.js';
import { disjointnessTable, formatOverlapTable, mergeWaves, PARALLEL_CAP } from './wave-merge.js';
import { notify, notifySync, NOTIFY_STATES } from './notify.js';
import { routesFromArch, primaryFontFamily, renderAvailable, renderEnabled, renderChecks } from '../plugin/hooks/floors/render-lint.mjs';

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
// Where an orchestrator answer the parser could not read is kept verbatim. It
// has to go SOMEWHERE a person can read: the parser has now been wrong about
// three distinct shapes this agent legitimately emits, and each diagnosis cost
// a manual reproduction because the output was gone the moment it was rejected.
const UNPARSED_PLAN_PATH = join(BUILD_DIR, 'unparsed-plan.md');
// Where the resolve barrier records which anchor ended up in which module tier,
// and which stayed local. A BUILD PRODUCT, deliberately: it is bookkeeping the
// elaborate pass reads and nothing else needs, so it earns no spec path and no
// paths.mjs predicate. The specs it describes — the module tiers — are the
// source of truth, and this file is derived by reading them back.
const RESOLUTION_PATH = join(BUILD_DIR, 'resolution.json');
// Where the reconcile audit's findings go. The audit produces nothing BUT a
// report, and the driver used to keep its text only when the stage failed — so
// the one run that produced a usable report was the one where the agent
// crashed. A 4-minute, ~3M-token stage ended in the word "report".
const AUDIT_REPORT_PATH = join(BUILD_DIR, 'audit-report.md');
// One PNG per declared route, per feature, from the render floor — the
// validator compares them against design.html.
const SCREENS_DIR = join(BUILD_DIR, 'screens');
// The machine-readable terminal state of a run. run.json is the CONTROL state
// (per-stage bookkeeping the driver resumes from); this is the ANSWER to "how
// did the run end?", written at every transition and readable by anything
// watching — `gspec build --status`, a wrapper script, or the agent that
// launched the build. It exists because the log is prose and the exit code
// alone was ambiguous: a run that paused for spec review and a run that
// finished both exited 0, so a watcher could not tell success from a pause, and
// a hard crash wrote nothing at all. See docs/gspec-v2-design.md §8.
const STATUS_PATH = join(BUILD_DIR, 'status.json');

// The exit-code contract. Distinct codes so a watcher never has to parse prose
// to learn what happened. Anything non-zero left the run unfinished.
export const EXIT = {
  COMPLETE: 0,       // every stage done/skipped
  FAILED: 1,         // a stage failed a gate, or the run could not start
  PAUSED_REVIEW: 2,  // paused at the spec-review human gate (expected, resumable)
  CRASHED: 3,        // died without reporting: uncaught error, or killed
};

// The terminal states, and how each is phrased in a one-line status report.
const STATE_LABEL = {
  running: 'running',
  complete: 'complete',
  paused_review: 'paused for spec review',
  failed: 'failed',
  crashed: 'crashed',
};
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
// The pending tier of the learning loop: one file per memory, under a per-agent
// directory. A file that appears here between run start and finish is something
// this run learned. See plugin/skills/conventions/gspec-memory.md.
const PENDING_MEMORY_DIR = '.gspec/memory/pending';

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
// Rounds a MECHANICAL lint gets to converge. Deliberately its own number rather
// than borrowing ctx.qaRetries, which is sized for expensive judgment revisions:
// a lint fix costs one writer run and no validator, and its findings name
// exactly what to change.
//
// One round is too few because a targeted fix can resolve precisely what it was
// told and introduce something else — seen twice on one dogfood run, once when
// renaming an anchor collided with an existing origin, once when restructuring
// a deferred task named an anchor that did not exist. Both times the writer was
// making real progress and the budget ran out anyway.
//
// Bounded two ways: a hard cap, and a stop the moment a round reproduces
// findings already seen — a writer going in circles will not converge, and more
// rounds only spend money.
const MAX_LINT_ROUNDS = 4;

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
// The anchor-producing stage runs one feature at a time. PRDs are file- AND
// content-disjoint, so they fan out safely; feature architectures are only
// file-disjoint. Two concurrent writers both grep for `### Entity: User`, both
// find no origin, and both declare themselves one — a race that produces two
// origins for the same anchor, which is a blocker finding after the fact.
// Named so raising it is a one-line change if it proves too slow; the cost is
// the same N sequential runs the plan stage already had.
// Was 1, and pinned there deliberately: feature-arch was the only stage that
// minted anchors, so two concurrent writers could both grep for
// `### Entity: User`, both find nothing, and both declare themselves its origin.
//
// Under declare → resolve → elaborate nobody consumes another writer's output in
// either pass, so ordering buys nothing and this is a throughput dial rather
// than a correctness one. The stage was the run's wall-clock floor: 2h 39m
// serial for five features, against 13m for the parallel design stage.
const FEATURE_ARCH_CONCURRENCY = FEATURE_WRITER_CONCURRENCY;
// How long to wait before retrying a transient agent failure. Long enough for a
// server-side overload to clear, negligible against an implement run that takes
// tens of minutes.
const TRANSIENT_BACKOFF_MS = 30_000;
// Retries for a transient engine error, each waiting longer than the last
// (30s, 120s, 270s). Bounded: a genuinely broken prompt must still surface
// rather than being retried until the run looks hung.
export const MAX_TRANSIENT_RETRIES = 3;

// --parallel modes. `auto` merges provably file-disjoint single-scope waves
// (lib/wave-merge.js); `off` runs the orchestrator's waves exactly as emitted.
export const PARALLEL_MODES = ['auto', 'off'];
// The wait before retry n (0-based): 30s, 120s, 270s. Exported so the schedule
// is asserted rather than described in a comment.
export function transientBackoffMs(n) {
  return TRANSIENT_BACKOFF_MS * (n + 1) ** 2;
}
// Scales every transient wait. Exists so the retry LOOPS can be exercised in a
// test without the test sleeping for seven minutes — the reason the validator
// retry went unwaited for so long is that adding a real wait to it would have
// made the suite unrunnable, so nobody did. Operators can also use it to make a
// flaky network more patient. Unset means the real schedule.
const BACKOFF_SCALE = Number.parseFloat(process.env.GSPEC_BACKOFF_SCALE ?? '1');
const backoffFor = (n) => Math.round(transientBackoffMs(n) * (Number.isFinite(BACKOFF_SCALE) && BACKOFF_SCALE >= 0 ? BACKOFF_SCALE : 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The four files of a feature folder. Declared with the constants because the
// STAGES table below names them at module-evaluation time.
export const FEATURE_FILES = { prd: 'prd.md', arch: 'arch.md', design: 'design.html', tasks: 'tasks.md' };

// --- spec size budgets (feedback §1) ---------------------------------------
//
// Nothing bounded specification volume, and volume became the whole cost of a
// run: writers optimize the only axis they are graded on (thoroughness), and
// validators grade THAT on precision, which rewards more text. Every
// downstream agent then pays to read the result — a decomposer reading a 42 KB
// PRD plus the foundation specs is what process death looks like from outside.
//
// The bound itself lives in the WRITER's context (gspec-conventions → "Size
// budgets", preloaded by every spec writer and validator). These numbers are
// the driver's copy, used only to MEASURE what was actually produced — a model
// asked to self-limit reports compliance while producing lines twice as long.
// CANONICAL SOURCE: plugin/skills/conventions/gspec-conventions.md.
// test/build-budgets.test.mjs parses that table and fails if the two disagree.
//
// Advisory by design: an over-budget spec is logged and noted for QA, never a
// stage failure. Word counts for a `standard`-scope product; SCOPE_FACTOR
// scales them by the tier the brief states.
// Keyed by the skill table's LABEL, not by path, so the comparison in
// test/build-budgets.test.mjs is an identity rather than a translation. The
// path→label classification lives in budgetLabel below — one place that knows
// the layout, so adding a deliverable is a row here plus a branch there.
export const SPEC_BUDGETS = {
  'profile.md': 2000,
  'stack.md': 2000,
  'practices.md': 2000,
  // Tokens only since v3.2: palette, type scale, spacing, radius, elevation,
  // themes, icons, accessibility target. Component styling and usage examples
  // moved to each feature's design.html, and the budget has to move with them
  // or nothing measures whether the split actually happened.
  'style.md': 900,
  // Prose only, and deliberately the loosest budget here: a rendered style
  // guide has no known-good baseline to calibrate against, so it is set to
  // flag the pathological case (a 175 KB guide) without nagging a legitimate
  // one whose specimen labels all count as visible text.
  'style.html': 700,
  'research.md': 2000,
  // The architecture is now HIGH-LEVEL: system context, module boundaries, the
  // shared data model at the name level, inter-module contracts, and the Modules
  // table. Entity fields, endpoint signatures, and algorithms belong to the
  // feature that introduces them, not here — which is what makes this budget a
  // ceiling the spec stops growing toward rather than one it outgrows.
  // 1,500 = the system tier alone. It used to be 2,100 — a 1,500-word system
  // tier plus the 600-word module tier a single-module project carried in the
  // same file — but every project now gets its own module-tier file, so that
  // 600 moved out with it.
  'architecture.md': 1500,
  // Was 600, when the tier held prose only and minted zero anchors. It now owns
  // the module's SPINE: the anchors two or more features reference — the core
  // loop, the data model those anchors pass around, the global invariants, the
  // main surfaces. Measured on two dogfood builds the spine is 5 anchors of 47
  // and 10 of 107, so this is sized as prose plus roughly ten anchor blocks,
  // and it is a CEILING — the periphery stays in the feature folders.
  'architecture/<name>.md': 2000,
  'features/<slug>/prd.md': 1800,
  // The enriched siblings. Deliberately generous relative to their subject: they
  // inline stack and style decisions on purpose, so measuring them against a
  // "state each fact once" budget would penalize exactly what they are for.
  // Raised from 2,400 after a real run put SIX of six features over it (1.1–1.8x).
  // That was a calibration error, not six writers failing: this is the one file
  // whose job is to restate the stack and architecture so nothing downstream has
  // to, and a ceiling that every honest draft breaks teaches writers to ignore
  // the ceiling. 3,000 is above the observed median and still well under the
  // outlier — the outlier was mostly a mockup written in prose, which the
  // appearance boundary now sends to design.html instead.
  'features/<slug>/arch.md': 3000,
  // Prose only — the markup, tokens, and rendered screens ARE the artifact.
  'features/<slug>/design.html': 600,
  // tasks.md carries no word budget: plans are bounded in TASKS (<= 25), which
  // the plan quality bar enforces and a word count would only distort.
};
export const SCOPE_FACTOR = { small: 0.6, standard: 1, large: 1.5 };
export const SCOPE_TIERS = Object.keys(SCOPE_FACTOR);
const DEFAULT_SCOPE = 'standard';
// How far over budget is worth saying anything about — measurement is
// approximate (the writer counts words no more precisely than we do), so a
// draft inside this band is reported as simply on-budget.
const BUDGET_TOLERANCE = 1.1;

// Count the words a budget counts: everything the file contains — prose AND
// tables — except frontmatter and the practices `Enforcement` block (a hook
// parses that, so it is exempt). For style.html, prose only: the tokens,
// markup, and rendered specimens ARE the artifact, not the specification.
export function countSpecWords(text, rel = '') {
  let s = String(text).replace(/^---\n[\s\S]*?\n---\n?/, '');
  if (rel.endsWith('practices.md')) s = s.replace(/^##\s+Enforcement\b[\s\S]*$/m, '');
  if (/\.html?$/.test(rel)) {
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  // Markdown structure isn't content: table pipes and separator rows would
  // otherwise make a table-heavy spec measure several times its real length,
  // and the budget explicitly counts what tables SAY, not how they're drawn.
  return (s
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')       // heading markers
    .replace(/^\s*[-*+]\s+/gm, '')            // list bullets
    .replace(/^[\s|:-]*\|[\s|:-]*$/gm, ' ')   // table separator rows
    .replace(/\|/g, ' ')                      // table cell delimiters
    .match(/\S+/g) || []).length;
}

// Classify a repo-relative spec path into the SPEC_BUDGETS / skill-table label
// it is measured against, or null when the path carries no word budget (plans
// are budgeted in tasks). The single place that maps layout → budget row.
export function budgetLabel(rel) {
  const r = String(rel).replace(/\\/g, '/');
  if (!r.startsWith('gspec/')) return null;
  const tail = r.slice('gspec/'.length);
  // A feature folder file is keyed by its BASENAME — the four have different
  // jobs and different budgets.
  const inFolder = tail.match(/^features\/[^/]+\/([^/]+\.(?:md|html))$/);
  if (inFolder) return `features/<slug>/${inFolder[1]}`;
  // The flat PRD, until a project migrates.
  if (/^features\/[^/]+\.md$/.test(tail)) return 'features/<slug>/prd.md';
  if (/^architecture\/[^/]+\.md$/.test(tail)) return 'architecture/<name>.md';
  if (!tail.includes('/')) return tail;  // a root spec: profile.md, style.html, …
  return null;
}

// The budget for a repo-relative spec path at this run's scope tier, or null
// when the deliverable carries no word budget.
export function budgetFor(rel, scope = DEFAULT_SCOPE) {
  const base = SPEC_BUDGETS[budgetLabel(rel)];
  return base ? Math.round(base * (SCOPE_FACTOR[scope] ?? 1)) : null;
}

// The scope tier for this run: an explicit --scope wins, then the tier pinned
// on the manifest, then whatever the intake recorded in the brief, then
// standard. Model output, so anything unrecognized falls back rather than
// scaling a budget by NaN.
export function scopeFromBrief(brief) {
  const m = String(brief).match(/^\s*(?:[-*]\s*)?(?:\*\*)?scope(?:\s*tier)?(?:\*\*)?\s*[:=]\s*(\w+)/im);
  const tier = m && m[1].toLowerCase();
  return SCOPE_TIERS.includes(tier) ? tier : null;
}

// What the architecture writer is told when the file it is about to write
// already exists. The amend floor (lintArchitectureAmend) holds the Modules
// table; this holds everything a regex cannot judge — the decisions, the gap
// analysis, the prose a human reviewed and kept. Declared here rather than
// beside that floor because the STAGES initializer below runs at module load,
// and a `const` defined later would still be in its temporal dead zone.
const ARCHITECTURE_AMEND_NOTE = [
  'gspec/architecture.md ALREADY EXISTS, and so does its module tier under gspec/architecture/.',
  'You are AMENDING a reviewed architecture, not authoring a new one. Read every existing file first, then make the smallest change that accommodates the feature PRDs not yet reflected in it.',
  '- PRESERVE the existing module names exactly. The Modules & Verification table derives gspec/architecture/<name>.md, and the feature specs reference those paths — a renamed or deleted row orphans the tier and dangles every reference to it. Adding a row is fine; changing or removing one is not.',
  '- PRESERVE the recorded decisions, the Technical Gap Analysis entries and the assumptions already written down. They were reviewed. Do not re-litigate a resolved gap, and do not drop one because you would have decided it differently.',
  '- ADD what the new features need — a new module row (with its gspec/architecture/<name>.md), a new contract between modules, a new entity in the name-level data model, a new spine anchor.',
  '- Anything you do change that was already there, record under Technical Gap Analysis as a revision with its reason, so the diff is reviewable rather than archaeological.',
].join('\n');

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
  {
    id: 'style', title: 'Style guide', type: 'foundation',
    writer: 'style-writer', validator: 'style-validator',
    outputs: ['gspec/style.md', 'gspec/style.html'],
    // The style writer takes the format from the brief and treats it as
    // authoritative — but an autonomous run has no interview to settle it, so
    // the choice fell to whatever the model preferred, and it picked Markdown.
    // That is not a neutral default any more: each feature's design.html copies
    // the guide's CSS custom-property block verbatim, so a Markdown guide leaves
    // it with nothing to copy and drops the token check from an exact comparison
    // to a best-effort transcription. State the preference where the writer is
    // actually looking.
    note: 'Write gspec/style.html — the renderable format, and the one the rest of the system depends on: each feature\'s design.html copies this guide\'s CSS custom-property block verbatim, which only the HTML form provides. Write gspec/style.md only if this project already has one (update it in place) or the brief explicitly asks for Markdown. Tokens only — palette, type scale, spacing, radius, elevation, themes, icons, accessibility. Component styling and usage examples belong to each feature\'s design.html, not here.',
  },
  { id: 'features',     title: 'Feature PRDs',      type: 'features',   planner: 'feature-planner',    writer: 'feature-writer',      validator: 'feature-validator' },
  // `deliverables` (not `outputs`) because the architecture's deliverable is a
  // SET whose membership the writer decides: the system tier plus one file per
  // Modules-table row. `outputs` still names the root for the skip/resume checks.
  // Not skip-if-present, unlike the foundation stages: a new feature routinely
  // needs a new module, contract or spine anchor, and skipping would leave its
  // arch.md pointing at a tier that never learned about it. So on a project that
  // already has an architecture the stage AMENDS — `note` reaches the writer and
  // `amendLint` holds the one invariant a regex can (the Modules table only
  // grows), measured against `snapshot`, taken before the writer runs.
  {
    id: 'architecture', title: 'Architecture', type: 'gated',
    writer: 'architecture-writer', validator: 'architecture-validator',
    outputs: ['gspec/architecture.md'], deliverables: architectureDeliverables,
    note: ARCHITECTURE_AMEND_NOTE, snapshot: architectureSnapshot, amendLint: lintArchitectureAmend,
  },
  // Three per-feature stages, one handler. Separate stage ids (not sub-phases of
  // one stage) because the manifest already keys status/attempts/passed BY STAGE
  // ID — three entries buy three resume points and three memo namespaces for
  // free. `plan` keeps its id and title so a manifest from an in-flight run
  // still resolves. Writer-outer order (every feature gets arch.md, THEN every
  // feature gets design.html) means a crash never leaves one feature straddling
  // two writers.
  // Feature architecture is THREE stages, and the middle one is a barrier.
  //
  // It used to be one serial stage: each architect grepped its siblings for an
  // anchor and amended on a hit, with concurrency pinned to 1 so the greps could
  // see prior work. That did not hold — the fifth writer of five had sight of all
  // four predecessors and still minted a fifth name for one rule — and it cost
  // the run's wall-clock floor to buy a guarantee that failed.
  //
  // Declaring first makes the anchor graph exist BEFORE any prose does, so the
  // "are these the same concept?" judgment is made once, with everything in view,
  // over one-line intents instead of full definitions. Both writer passes are
  // then fully parallel, because neither consumes another writer's output.
  {
    id: 'feature-arch-declare', title: 'Feature architecture — declare', type: 'feature-plan',
    writer: 'feature-architect',
    file: FEATURE_FILES.arch,
    // No agent validator: the artifact is a heading list, and the floor decides
    // everything a regex can about it. Spending a validator run here would be
    // paying twice for the same file.
    wellFormed: looksDeclared,
    lint: lintFeatureArchDeclare,
    prompt: async (ctx, slug, rel) => featureArchDeclarePrompt(ctx, slug, rel),
  },
  {
    id: 'arch-resolve', title: 'Shared architecture', type: 'arch-resolve',
    writer: 'architecture-writer',
    outputs: [RESOLUTION_PATH],
  },
  {
    id: 'feature-arch', title: 'Feature architecture', type: 'feature-plan',
    writer: 'feature-architect', validator: 'feature-architecture-validator',
    file: FEATURE_FILES.arch,
    // Parallel now. Every anchor has one known owner and one known home before
    // this pass starts, so no writer can race another into an origin.
    concurrency: FEATURE_ARCH_CONCURRENCY,
    lint: lintFeatureArch,
    report: reportArchResidue,
    prompt: async (ctx, slug, rel) => featureArchPrompt(ctx, slug, rel),
  },
  {
    id: 'feature-design', title: 'Feature design', type: 'feature-plan',
    writer: 'feature-designer', validator: 'feature-design-validator',
    file: FEATURE_FILES.design,
    // Applicability is a CONTENT question, not a file-existence one: a feature
    // has a design iff its arch.md declares an applicable UI section.
    appliesWhen: hasApplicableUiSection,
    lint: lintFeatureDesign,
    prompt: async (ctx, slug, rel) => featureDesignPrompt(ctx, slug, rel),
  },
  {
    id: 'plan',         title: 'Plans',             type: 'feature-plan',
    writer: 'plan-decomposer',     validator: 'plan-validator',
    file: FEATURE_FILES.tasks,
    // A plan without task checkboxes is an engine error wearing a plan's name.
    wellFormed: looksCompletePlan,
    lint: lintFeaturePlan,
    prompt: async (ctx, slug, rel) => featurePlanPrompt(ctx, slug, rel),
  },
  // The human gate (design: second interactive touchpoint). Every spec now
  // exists but no code does — the run pauses (exit 0) so the user can review
  // and edit gspec/ before implementation; `--resume` approves and continues,
  // `--no-review` skips the pause entirely. Handled in the driver loop, not
  // runStage: approval depends on the resume flag + prior manifest status.
  { id: 'review',       title: 'Spec review',       type: 'review' },
  { id: 'implement',    title: 'Implementation',    type: 'implement',  agent: 'implementer', orchestrator: 'build-orchestrator', validator: 'implementation-validator' },
  { id: 'reconcile',    title: 'Reconcile audit',   type: 'audit',      agent: 'codebase-inspector' },
];

// --- the user's template library (~/.gspec) --------------------------------
//
// A personal library of saved specs a new one can be seeded from — the
// `gspec-templates` convention, preloaded by the stack/style/practices/feature
// writers. The INTERACTIVE commands resolve the library with a shell and hand
// the chosen template's ABSOLUTE path to the writer in its brief, precisely
// because "~" is not expanded by file tools.
//
// An autonomous build has no such command, and those writers have no Bash — so
// they were told to consult a folder they had no way to name, and a build
// silently ignored every saved template (indistinguishable from having none).
// The driver is a node process, so it resolves the library here and names the
// candidates, with absolute paths, in the stage brief. Which template to adopt
// is still the writer's judgment, per the convention.
//
// Only these four spec types have a library: profile.md and architecture.md are
// inherently project-specific and must never be seeded from one.
const TEMPLATE_FOLDER = { stack: 'stacks', style: 'styles', practices: 'practices', features: 'features' };
// A ceiling on how many candidates one brief lists — the library is the user's
// and can grow without bound; drops are logged, not silent.
const MAX_TEMPLATES_LISTED = 12;

// `name` / `description` from a saved spec's YAML frontmatter (the fields the
// convention says to match on). Anything missing degrades to the filename.
export function templateMeta(text, fallbackName = '') {
  const fm = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const field = (key) => {
    const m = (fm ? fm[1] : '').match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  return { name: field('name') || fallbackName, description: field('description') };
}

// Every saved spec in one library folder as { path (absolute), name, description }.
async function readTemplateFolder(root, folder) {
  const dir = join(root, folder);
  let entries;
  try { entries = await readdir(dir); } catch { return []; }  // no folder = no templates
  const files = entries.filter((f) => !f.startsWith('.') && /\.(md|html?)$/i.test(f)).sort();
  const found = [];
  for (const f of files) {
    let text;
    try { text = await readFile(join(dir, f), 'utf-8'); } catch { continue; }
    found.push({ path: join(dir, f), ...templateMeta(text, f.replace(/\.[^.]+$/, '')) });
  }
  return found;
}

// { folder -> [template, …] } across the library, or {} when there is none.
async function loadTemplateLibrary(home = homedir()) {
  const root = join(home, '.gspec');
  const library = {};
  for (const folder of new Set(Object.values(TEMPLATE_FOLDER))) {
    const found = await readTemplateFolder(root, folder);
    if (found.length) library[folder] = found;
  }
  return library;
}

// The block appended to a stage's brief listing what this stage could seed
// from. Empty for a stage with no library (profile, architecture, …) and for a
// user who keeps none — in which case nothing about templates is said at all.
export function templateNote(stage, library = {}) {
  const folder = TEMPLATE_FOLDER[stage.id];
  const all = folder ? (library[folder] || []) : [];
  if (!all.length) return '';
  const shown = all.slice(0, MAX_TEMPLATES_LISTED);
  return [
    '',
    `## Saved templates you may seed from (${folder} library)`,
    'The user keeps reusable specs of this type. These are ABSOLUTE paths — read one directly; you have no shell, so a "~" path will not resolve.',
    ...shown.map((t) => `- ${t.path} — ${t.name}${t.description ? `: ${t.description}` : ''}`),
    '',
    'Per the gspec-templates convention, this is an autonomous run with nobody to ask: if exactly one clearly fits this project, read it and adapt it to the brief above — reconcile every choice against the brief, keep it profile-agnostic, and bring its frontmatter current. If none clearly fits, write fresh; a poor template is worse than none. State in your summary which template seeded the spec, or that you wrote fresh.',
  ].join('\n');
}

// --- small fs helpers -----------------------------------------------------

async function pathExists(cwd, rel) {
  try { await stat(join(cwd, rel)); return true; } catch { return false; }
}

// --- the feature folder ----------------------------------------------------
//
// Everything about one feature lives in gspec/features/<slug>/:
//   prd.md       the PRD — product-agnostic, the capability checkboxes
//   arch.md      this feature's own architecture (## Data / ## API / ## UI / ## Logic)
//   design.html  a renderable mockup, when the feature has UI
//   tasks.md     the ordered plan
//
// prd.md and its three siblings sit on opposite sides of the agnosticism
// boundary on purpose: the PRD stays free of product identity, while the
// siblings are deliberately ENRICHED — an implementer reading only that folder
// must not need the stack, the style guide, or the architecture.

export const featureDir = (slug) => `gspec/features/${slug}`;
export const featureFile = (slug, name) => `${featureDir(slug)}/${name}`;
// Where a PRD lived before v3.2. Read (never written) so a project mid-migration
// still plans and builds.
const legacyPrdPath = (slug) => `gspec/features/${slug}.md`;
const legacyPlanPath = (slug) => `gspec/tasks/${slug}.md`;

// The PRD path in use for a slug — the folder form, else the flat legacy one.
export async function prdPath(cwd, slug) {
  const folder = featureFile(slug, FEATURE_FILES.prd);
  if (await pathExists(cwd, folder)) return folder;
  if (await pathExists(cwd, legacyPrdPath(slug))) return legacyPrdPath(slug);
  return folder; // not written yet: this is where it goes
}

// Likewise for the plan, which the implement stage counts checkboxes in.
export async function planPath(cwd, slug) {
  const folder = featureFile(slug, FEATURE_FILES.tasks);
  if (await pathExists(cwd, folder)) return folder;
  if (await pathExists(cwd, legacyPlanPath(slug))) return legacyPlanPath(slug);
  return folder;
}

// Every feature slug in the project, from either layout. Sorted: a stable
// per-run order keeps the fan-outs (and their content-hash memoization)
// deterministic across resumes.
export async function listFeatureSlugs(cwd) {
  const slugs = new Set();
  try {
    for (const e of await readdir(join(cwd, 'gspec', 'features'), { withFileTypes: true })) {
      if (e.isDirectory()) slugs.add(e.name);
      // Flat legacy PRD; `.plan.md` was the pre-v2 plan location.
      else if (e.name.endsWith('.md') && !e.name.endsWith('.plan.md')) slugs.add(e.name.replace(/\.md$/, ''));
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return [...slugs].sort();
}

// Every plan file in the project (repo-relative) — what the monolithic implement
// fallback would track. Covers both layouts.
async function listPlanFiles(cwd) {
  const out = [];
  for (const slug of await listFeatureSlugs(cwd)) {
    const p = await planPath(cwd, slug);
    if (await pathExists(cwd, p)) out.push(p);
  }
  return out;
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

// --- memory + feedback (the learning loop's build channel) -----------------
//
// What the build reports it learned comes from two sources: (1) memories agents
// recorded to .gspec/memory/pending/ mid-run (the directory diff), and (2) the
// QA FAIL verdicts the driver itself observed and self-healed from (recorded in
// the manifest — reliable even where the SubagentStop capture hook doesn't fire
// for headless subprocesses). Both are model-free to gather here.

// The `## ` headings in a markdown body (one heading per memory).
export function memoryHeadings(md) {
  return String(md).split('\n')
    .filter((l) => /^##\s+\S/.test(l))
    .map((l) => l.replace(/^##\s+/, '').trim());
}

// { agentName -> [heading, …] } across the pending tier. Keyed by FILE, not by
// heading text: one memory per file means a rewritten heading is the same
// memory, and two agents learning the same thing are still two memories.
async function snapshotPending(cwd) {
  const snap = {};
  const root = join(cwd, PENDING_MEMORY_DIR);
  let agents;
  try { agents = await readdir(root, { withFileTypes: true }); }
  catch { return snap; } // nothing recorded yet — the normal case on a clean run
  for (const ent of agents) {
    if (!ent.isDirectory()) continue;
    let files;
    try { files = (await readdir(join(root, ent.name))).filter((f) => f.endsWith('.md')); }
    catch { continue; }
    for (const file of files) {
      let text = '';
      try { text = await readFile(join(root, ent.name, file), 'utf-8'); } catch { /* mid-write; the filename still identifies it */ }
      const heading = memoryHeadings(text)[0] || file.replace(/\.md$/, '');
      snap[ent.name] = (snap[ent.name] || []).concat(`${file}\t${heading}`);
    }
  }
  return snap;
}

// Memories present in `after` but not in `before` — the net-new ones.
// Entries are the `file\theading` keys snapshotPending builds; the file is the
// identity and the heading is what a human reads, so split them back apart here
// rather than making every caller know the encoding.
export function diffMemories(before = {}, after = {}) {
  const added = [];
  for (const [agent, entries] of Object.entries(after)) {
    const base = new Set(before[agent] || []);
    for (const e of entries) {
      if (base.has(e)) continue;
      const [file, heading] = String(e).split('\t');
      added.push({ agent, file, memory: heading || file });
    }
  }
  return added;
}

// "one revision" / "3 revisions" — gate messages scale with --qa-retries.
function countNoun(n, noun) { return n === 1 ? `one ${noun}` : `${n} ${noun}s`; }

// Compact a (possibly multi-line) verdict into a one-line report excerpt.
// The one-line "why did QA fail?" shown in the run log.
//
// It cannot just take the first lines: a model often prefaces its verdict with
// reasoning ("Let me just return the verdict directly:"), and a run was observed
// reporting that preamble as the entire reason a stage failed — the finding
// itself scrolled past unseen. So skip ahead to the part that carries meaning:
// the SUMMARY line if there is one, else the first FINDING, else the verdict.
// Anything before the VERDICT line is throat-clearing by construction.
function summarize(text, maxLines = 2, maxLen = 200) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const verdictAt = lines.findIndex((l) => /^#*\s*\**VERDICT:/i.test(l));
  const body = verdictAt >= 0 ? lines.slice(verdictAt) : lines;

  const summaryAt = body.findIndex((l) => /^#*\s*\**\s*SUMMARY\b/i.test(l));
  const findingAt = body.findIndex((l) => /^\**\s*\[(blocker|major|minor|nit)\]/i.test(l) || /^\**\[/.test(l));
  // Failing both, skip the scaffolding a verdict opens with — bare headings,
  // rules, and the SPEC line are structure, not the reason. A validator that
  // writes "# VERDICT: FAIL" then "## Structured Verdict" would otherwise have
  // reported those two lines as the entire finding.
  // A findings TABLE is a shape validators legitimately use, and its first two
  // rows carry no finding at all. Observed live: a revision announced its reason
  // as "(| Severity | Finding | Fix | / |----------|---------|-----|)" — the one
  // line a person reads to learn why a revision is running, spent entirely on
  // column names. Skip the header and its rule so the first DATA row, which is
  // the actual finding, is what gets reported.
  const isTableRule = (l) => /^\|?[\s:|-]*-{2,}[\s:|-]*\|?$/.test(l) && l.includes('|');
  const isTableHeader = (l, i) => l.startsWith('|') && isTableRule(body[i + 1] || '');

  const proseAt = body.findIndex((l, i) => i > 0
    && !/^#{1,6}\s*$/.test(l) && !/^[-*_]{3,}$/.test(l)
    && !/^#*\s*\**\s*(SPEC|VERDICT)\b/i.test(l)
    && !/^#{1,6}\s+\S+(\s+\S+)?\s*$/.test(l)   // a short bare heading like "## Structured Verdict"
    && !isTableRule(l) && !isTableHeader(l, i)
    && l.replace(/[#*_`\s-]/g, '').length > 12);
  const start = summaryAt >= 0 ? summaryAt : (findingAt >= 0 ? findingAt : (proseAt >= 0 ? proseAt : 0));

  // Strip the label BEFORE joining, then drop whatever that empties. A verdict
  // that puts "**SUMMARY:**" on its own line would otherwise render as " / the
  // actual text" — a separator with nothing on one side of it.
  const s = body.slice(start, start + maxLines)
    .map((l, i) => (i === 0 ? l.replace(/^#*\s*\**\s*SUMMARY:?\**\s*/i, '') : l))
    .map((l) => l.replace(/^[-*_]{3,}$/, '').trim())
    .filter(Boolean)
    .join(' / ');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// Print what the run COST, per agent, biggest first.
//
// Reading is the expense, not writing — a measured run spent 79M input-equivalent
// tokens against 2M of output — so the useful view is which agents pulled the
// most in, and how many turns it took them. That is what tells you where to
// tier down and, more usefully, whose read scope is too wide.
function reportUsage(manifest) {
  const usage = manifest.usage;
  if (!usage || !Object.keys(usage).length) return;
  const rows = Object.entries(usage)
    .map(([agent, u]) => ({ agent, ...u, totalIn: u.in + u.cacheRead + u.cacheWrite }))
    .sort((a, b) => b.totalIn - a.totalIn);
  const totIn = rows.reduce((n, r) => n + r.totalIn, 0);
  const totOut = rows.reduce((n, r) => n + r.out, 0);
  const totCost = rows.reduce((n, r) => n + r.costUsd, 0);
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

  log('');
  log(chalk.bold('  Token usage'));
  for (const r of rows.slice(0, 8)) {
    const share = totIn ? Math.round((r.totalIn / totIn) * 100) : 0;
    log(chalk.dim(`    ${r.agent.padEnd(30)} ${String(r.runs).padStart(3)} run(s)  in ${k(r.totalIn).padStart(6)} (${String(share).padStart(2)}%)  out ${k(r.out).padStart(5)}  ${r.turns ? `${r.turns} turns` : ''}`));
  }
  if (rows.length > 8) log(chalk.dim(`    … and ${rows.length - 8} more`));
  log(chalk.dim(`    ${'total'.padEnd(30)} ${String(rows.reduce((n, r) => n + r.runs, 0)).padStart(3)} run(s)  in ${k(totIn).padStart(6)}         out ${k(totOut).padStart(5)}${totCost ? `  ~$${totCost.toFixed(2)}` : ''}`));
  log(chalk.dim('    Input dominates: a stage gets cheaper by reading less, not by writing less.'));

  // Authoring vs repairing, per run. A surgical revision is supposed to read
  // less than the run that wrote the thing; this is the line that says whether
  // it does. It is also the input to "should a resumed engine session replace a
  // fresh one" — a resume re-pays for the authoring context, so it only wins if
  // a revision's own reading is close to that anyway.
  const split = rows.filter((r) => r.byKind?.revision?.runs);
  if (split.length) {
    log('');
    log(chalk.bold('  Authoring vs revision') + chalk.dim(' (input per run)'));
    for (const r of split) {
      const per = (b) => (b?.runs ? k((b.in + b.cacheRead + b.cacheWrite) / b.runs) : '—');
      const init = r.byKind.initial;
      const rev = r.byKind.revision;
      const ratio = init?.runs && rev?.runs
        ? `${(((rev.in + rev.cacheRead + rev.cacheWrite) / rev.runs) / ((init.in + init.cacheRead + init.cacheWrite) / init.runs) * 100).toFixed(0)}%`
        : '—';
      log(chalk.dim(`    ${r.agent.padEnd(30)} initial ${String(init?.runs ?? 0).padStart(2)}×${per(init).padStart(6)}   revision ${String(rev.runs).padStart(2)}×${per(rev).padStart(6)}   (revision reads ${ratio} of an initial run)`));
    }
  }

  // Runs that moved nothing. On the run that motivated this, an estimated
  // four or five of twelve implementer runs checked zero tasks — every one a
  // full ~8M-token read — and the number could only be inferred from log
  // lines. Now it is a line of the report, per agent, with the kinds that
  // usually cause it (a retry after an engine error, a continuation that
  // stalled) called out beside it.
  const wasted = waste(usage);
  if (wasted.length) {
    log('');
    log(chalk.bold('  Waste') + chalk.dim(' (runs that made no progress: no task checked, no deliverable written)'));
    for (const w of wasted) {
      const kinds = Object.entries(w.byKind).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
      log(chalk.dim(`    ${w.agent.padEnd(30)} ${String(w.runs).padStart(3)} of ${String(w.totalRuns).padStart(3)} run(s)  in ${k(w.inputTokens).padStart(6)}${kinds ? `  (${kinds})` : ''}`));
    }
  }

  // Mechanical rounds against judgment rounds. Both spend a writer; only the
  // second also spent a validator. Six of ten self-heals on the measured run
  // were the mechanical kind — a one-line rename paid for with a full run —
  // and the headline counted them as QA feedback.
  const lq = lintVsQa(usage);
  if (lq.lint.runs || lq.qa.runs) {
    log('');
    log(chalk.bold('  Lint vs QA') + chalk.dim(` — mechanical fix rounds: ${lq.lint.runs} (in ${k(lq.lint.inputTokens)}, no validator spent) · QA revisions: ${lq.qa.runs} (in ${k(lq.qa.inputTokens)})`));
  }
}

// What stopped this run, and for how long.
//
// "Stage time" deliberately excludes the waiting, so a build that took thirteen
// hours of wall clock reports three of stage time and the difference goes
// unexplained. On a long build a usage limit is routine — it resets on a clock,
// gets continued hours later, and until this existed nothing kept a structured
// trace: last-failure.md is overwritten by the next failure and removed when
// the build completes, and a stage that eventually passes shows only a bare
// `attempts: 2`. A finished run could not say whether it had been interrupted.
function reportPauses(manifest) {
  const pauses = manifest.pauses || [];
  if (!pauses.length) return;
  const limits = pauses.filter((p) => p.limit);
  const waited = pauses.reduce((n, p) => n + (p.waitedMs || 0), 0);

  log('');
  log(chalk.bold('  Interruptions'));
  log(chalk.dim(`    ${countNoun(pauses.length, 'stop')}${limits.length ? ` (${limits.length} on a usage limit)` : ''}${waited ? ` · ${humanMs(waited)} spent waiting` : ''}`));
  for (const p of pauses) {
    const how = p.resumedAt ? `waited ${humanMs(p.waitedMs || 0)}` : 'not yet resumed';
    // Three kinds, not two. Calling a stopped driver a "failure" would report a
    // defect where there was none — the build was simply not running.
    const why = p.limit ? 'usage limit' : p.review ? 'spec review' : p.unattended ? 'not running' : 'failure';
    log(chalk.dim(`    · ${p.stage} — ${why}, ${how}`));
  }
}

// Print the end-of-run report (memories recorded + QA feedback).
async function reportLearnings(cwd, manifest) {
  const added = diffMemories(manifest.memoryBaseline || {}, await snapshotPending(cwd));
  // A lint round is recorded through the same channel as a verdict (so the
  // durable log is complete), but it is not QA feedback — nothing judged
  // anything. Counting the two together made a run with six rename fixes and
  // four real findings read as ten QA failures.
  const all = manifest.learnings || [];
  const mechanical = all.filter((f) => isLintFeedback(f.agent));
  const feedback = all.filter((f) => !isLintFeedback(f.agent));

  log('');
  log(chalk.bold('  Recorded this run'));
  if (added.length === 0 && feedback.length === 0 && mechanical.length === 0) {
    log(chalk.dim('  Nothing — no QA gate flagged an issue and no memory was recorded.'));
    return;
  }
  if (added.length) {
    log(chalk.green(`  ✎ ${added.length} memor${added.length === 1 ? 'y' : 'ies'} recorded to ${PENDING_MEMORY_DIR}/:`));
    for (const a of added) log(`      · [${a.agent}] ${a.memory}`);
    log(chalk.dim('    They change nothing until reviewed — commit them with /gspec-memorize.'));
  } else {
    log(chalk.dim('  ✎ No new memories recorded this run.'));
  }
  if (feedback.length) {
    log(chalk.yellow(`  ⚠ ${feedback.length} QA feedback event(s) drove a self-heal:`));
    for (const f of feedback) log(chalk.dim(`      · ${f.stage} — ${f.agent}: ${f.excerpt}`));
    log(chalk.dim(`    Every failing verdict this run — in full, even the recovered ones — is in ${QA_LOG_PATH}.`));
  }
  if (mechanical.length) {
    log(chalk.dim(`  ⚙ ${mechanical.length} mechanical lint round(s) — deterministic floors, no validator involved (each still spent a writer run):`));
    for (const f of mechanical) log(chalk.dim(`      · ${f.stage} — ${f.agent}: ${f.excerpt}`));
  }
}

// The checker names the driver records a deterministic round under: the
// per-stage `<stage>-lint` and the implement gate's own floor.
function isLintFeedback(agent = '') {
  return /-lint$/.test(String(agent));
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
    if (skipWrite()) return;
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

// --- terminal state (status.json) -----------------------------------------
//
// One small file that always answers "how did the run end?". Written at every
// transition — run start, each stage, and every exit path — so a watcher can
// read a fact instead of interpreting the log, and so a crash that never gets
// to print anything still leaves a mark.

function statusRecord(state, { manifest, engine, stage, reason, exitCode, startedAt, pid } = {}) {
  return {
    state,
    stage: stage?.id ?? null,
    stageTitle: stage?.title ?? null,
    reason: reason ?? null,
    // null while running: there is no exit code yet.
    exitCode: exitCode ?? null,
    // The OS process driving the run. A `running` record whose pid is gone is
    // how a SIGKILL (or a lost terminal) is detected after the fact — see
    // reportBuildStatus, which passes the DEAD run's pid through rather than
    // stamping its own over the forensics.
    pid: pid ?? process.pid,
    engine: engine ?? manifest?.engine ?? null,
    idea: manifest?.idea ?? null,
    startedAt: startedAt ?? manifest?.createdAt ?? null,
    updatedAt: new Date().toISOString(),
  };
}

async function writeStatus(cwd, state, opts = {}) {
  if (opts.dryRun) return;
  try {
    await mkdir(join(cwd, BUILD_DIR), { recursive: true });
    await writeFile(join(cwd, STATUS_PATH), JSON.stringify(statusRecord(state, opts), null, 2) + '\n', 'utf-8');
  } catch { /* a status write must never derail the build it is describing */ }
  // Tell someone. Every state a person needs to act on passes through here,
  // and 43% of a measured build's wall clock was a gate nobody knew had
  // opened. `opts.notify` is the user's command; `opts.limit` marks a failure
  // that is really a usage-limit pause, which wants "wait", not "fix".
  if (opts.notify) await runNotify(cwd, state, opts);
}

// The notification payload for a transition, and the log line for its result.
function notifyPayload(cwd, state, opts) {
  return {
    state: opts.limit ? 'paused_limit' : state,
    stage: opts.stage?.title ?? opts.stage?.id ?? '',
    reason: opts.reason ?? '',
    idea: opts.manifest?.idea ?? '',
    cwd,
  };
}
async function runNotify(cwd, state, opts) {
  const payload = notifyPayload(cwd, state, opts);
  if (!NOTIFY_STATES.has(payload.state)) return;
  const r = await notify(opts.notify, payload);
  if (r.ran && (r.timedOut || r.code)) log(chalk.dim(`      notify command ${r.timedOut ? 'timed out after 10s' : `exited ${r.code}`} (${payload.state}) — the build is unaffected.`));
}

// The crash path: process.exit will not wait for a promise, so the fatal
// handler writes synchronously or not at all.
function writeStatusSync(cwd, state, opts = {}) {
  if (skipWrite()) return;
  try {
    mkdirSync(join(cwd, BUILD_DIR), { recursive: true });
    writeFileSync(join(cwd, STATUS_PATH), JSON.stringify(statusRecord(state, opts), null, 2) + '\n', 'utf-8');
  } catch { /* nothing left to do if even this fails */ }
  if (opts.notify) {
    const payload = notifyPayload(cwd, state, opts);
    if (NOTIFY_STATES.has(payload.state)) notifySync(opts.notify, payload);
  }
}

function writeLastFailureSync(cwd, title, reason, detail) {
  if (skipWrite()) return;
  try {
    mkdirSync(join(cwd, BUILD_DIR), { recursive: true });
    writeFileSync(join(cwd, LAST_FAILURE_PATH), [
      `# ${title}`,
      '',
      `- when: ${new Date().toISOString()}`,
      `- reason: ${reason}`,
      ...(detail ? ['', '## Detail', '', String(detail).trim()] : []),
      '',
      'The run stopped without finishing. Continue it from where it stopped: `gspec build --resume`',
      '',
    ].join('\n'), 'utf-8');
  } catch { /* best effort */ }
}

async function readStatus(cwd) {
  try { return JSON.parse(await readFile(join(cwd, STATUS_PATH), 'utf-8')); }
  catch { return null; }
}

// Is that pid still ours to see? Signal 0 tests existence without delivering
// anything. EPERM means the process exists but belongs to someone else — still
// alive as far as we are concerned.
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

// Derive a terminal state from the manifest alone, for a run that predates
// status.json (started on an older gspec) — so `--status` degrades to "reads
// the control state" instead of "knows nothing".
function deriveState(manifest) {
  const stages = Object.entries(manifest.stages || {});
  const failed = stages.find(([, s]) => s.status === 'failed');
  if (failed) return { state: 'failed', stageId: failed[0], reason: failed[1].reason || 'a stage failed' };
  const paused = stages.find(([, s]) => s.status === 'paused');
  if (paused) return { state: 'paused_review', stageId: paused[0], reason: 'awaiting spec review' };
  const running = stages.find(([, s]) => s.status === 'running');
  if (running) return { state: 'running', stageId: running[0], reason: null };
  if (stages.length && stages.every(([, s]) => s.status === 'done' || s.status === 'skipped')) {
    return { state: 'complete', stageId: null, reason: null };
  }
  return { state: 'running', stageId: null, reason: null };
}

// `gspec build --status`: print the run's terminal state in one line and RETURN
// the exit code that describes it, so a watching agent can branch on a number
// instead of reading prose. Reconciles three sources, most authoritative first:
// a status.json whose process is still alive, a status.json whose process is
// gone (that is a crash — recorded, so the next read agrees), and the manifest
// alone for pre-2.7.0 runs.
export async function reportBuildStatus(cwd = process.cwd()) {
  const manifest = await loadManifest(cwd);
  let status = await readStatus(cwd);

  if (!status && !manifest) {
    log(chalk.dim('\n  No gspec build run here (.gspec/build/run.json not found).'));
    log(chalk.dim('  Start one with: gspec build "<idea>"\n'));
    return EXIT.FAILED;
  }

  // A run that says it is still going, whose process is not: it was killed
  // (SIGKILL, a lost machine) before any handler could record the ending.
  if (status && status.state === 'running' && !isAlive(status.pid)) {
    const crashed = {
      manifest,
      engine: status.engine,
      stage: status.stage ? { id: status.stage, title: status.stageTitle } : undefined,
      reason: `the build process (pid ${status.pid}) is gone — it died without reporting${status.stageTitle ? ` during "${status.stageTitle}"` : ''}`,
      exitCode: EXIT.CRASHED,
      startedAt: status.startedAt,
      pid: status.pid,
    };
    status = statusRecord('crashed', crashed);
    await writeStatus(cwd, 'crashed', crashed); // so the next reader agrees with this one
  }

  if (!status) {
    const d = deriveState(manifest);
    const stage = STAGES.find((s) => s.id === d.stageId);
    status = statusRecord(d.state, {
      manifest,
      stage,
      reason: d.reason,
      exitCode: { complete: EXIT.COMPLETE, failed: EXIT.FAILED, paused_review: EXIT.PAUSED_REVIEW, running: null }[d.state],
    });
  }

  // No recorded code (still running, or a derived pre-2.7.0 state) is reported
  // as unfinished — never as success.
  const code = status.exitCode ?? EXIT.FAILED;
  const where = status.stageTitle ? ` at "${status.stageTitle}"` : '';
  const color = { complete: 'green', paused_review: 'yellow', failed: 'red', crashed: 'red', running: 'cyan' }[status.state] || 'white';
  log('');
  log(chalk[color](`  gspec build — ${STATE_LABEL[status.state] || status.state}${where}${status.reason ? `: ${status.reason}` : ''}`));
  log(chalk.dim(`  state: ${status.state} · exit: ${status.state === 'running' ? '(still running)' : code} · engine: ${status.engine || 'unknown'} · updated: ${status.updatedAt}`));
  if (status.state === 'failed' || status.state === 'crashed') {
    log(chalk.dim(`  why: ${LAST_FAILURE_PATH} · run record: ${MANIFEST_PATH}`));
    log(chalk.yellow('  Fix the issue, then continue from exactly here: gspec build --resume'));
  } else if (status.state === 'paused_review') {
    log(chalk.dim(`  The specs are written and no code exists yet. Review gspec/, then: gspec build --resume`));
  } else if (status.state === 'running') {
    log(chalk.dim(`  pid ${status.pid} is still working. Re-check with: gspec build --status`));
  }
  // The wave plan the implement stage ran (or is running), when one was
  // recorded — so "what got serialized?" is answerable from here.
  const plan = manifest?.stages?.implement?.plan;
  if (Array.isArray(plan) && plan.length) {
    log(chalk.dim(`  implement plan: ${plan.length} wave(s)`));
    for (const line of formatWavePlan(plan)) log(chalk.dim(`    ${line}`));
  }
  log('');
  // A run still in flight is not a result: report it as unfinished so a caller
  // polling on the exit code keeps polling.
  return status.state === 'complete' ? EXIT.COMPLETE : code;
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

// A dry run is a PREVIEW: it must leave NOTHING behind in .gspec/build/.
//
// That intent was already here, but spelled out at each call site (`if (dryRun)
// return`) — and the call sites drifted. Six of them never got the guard, so
// `gspec build --dry-run` wrote a complete run.json with every stage marked
// done/PASS, plus audit-report.md and unparsed-plan.md. The damage was not the
// stray files: previewing the plan and then building for real hit "a build run
// already exists", and following that message's own advice (`--resume`) resumed
// the fake finished run and skipped every stage — a preview silently became a
// no-op build.
//
// One caller forgetting the guard is a bug; six is a sign the invariant was in
// the wrong place. It is cheaper to hold at the write boundary than at every
// caller, so it lives here and covers whatever gets written next.
let previewOnly = false;

// True when the current process is a --dry-run, i.e. nothing may touch the disk.
function skipWrite() { return previewOnly; }

async function saveManifest(cwd, manifest) {
  if (skipWrite()) return;
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
    scope: opts.scope || null,
    qaRetries: opts.qaRetries ?? 1,
    permissionMode: opts.permissionMode || 'acceptEdits',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages,
    learnings: [],           // QA feedback events the driver observes this run
    memoryBaseline: null, // pending-memory snapshot, taken just before stage 1
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
async function runAgent(agentName, prompt, ctx, extra = {}) {
  const out = await ctx.engine.runAgent(agentName, prompt, ctx, {
    needsBash: extra.allowedTools === 'Bash',
    needsWeb: extra.allowedTools === 'Web',
    // Per-agent model from the config `models` map (null → engine/CLI default).
    model: ctx.resolveModel ? ctx.resolveModel(agentName) : null,
  });
  // Account for the run. Engines that cannot report usage simply contribute
  // nothing, so this degrades to today's behavior rather than guessing.
  //
  // `kind` splits a first attempt from a repair. Without it the per-agent totals
  // answer "who reads the most" but not "does a revision read less than the
  // authoring run did" — and that second question is the one that decides
  // whether resuming an engine session is worth building, since a resumed
  // session carries the whole authoring context a targeted repair may not need.
  //
  // `progress` says whether the run MOVED the build — a task checked, a
  // deliverable written. It is a predicate rather than a value because the
  // caller only knows after the engine returns; evaluated here so the record
  // lands with the run it describes. A run with no progress is the waste the
  // report names (lib/usage.js).
  if (ctx.recordUsage) {
    let progress;
    if (typeof extra.progress === 'function') {
      try { progress = await extra.progress(out); } catch { progress = undefined; }
    } else progress = extra.progress;
    await ctx.recordUsage(agentName, out, extra.kind || 'initial', { progress });
  }
  return out;
}

// Intake runs INTERACTIVELY (the user answers) — the engine inherits stdio so
// they can converse. The intake session writes the resolved brief to brief.md.
function runIntake(idea, ctx) {
  const prompt = [
    'You are the intake step of the gspec build.',
    `The idea to build: ${idea}`,
    'Interview the user ONCE, in this session, to RESOLVE the decisions the whole autonomous build pivots on:',
    'product type & primary audience, technology lean, visual style direction, and scope boundaries.',
    // These are things that must END UP settled — not a fixed questionnaire.
    // Phrased as a bare list, a model asks one question per item and stops, so
    // every interview came out the same length whatever the idea needed: a CLI
    // tool still got asked about visual style, and a multi-module system with
    // integrations got one question about boundaries.
    'That list is what must be SETTLED, not a script to read out. Let the idea decide the number of questions:',
    'skip what the idea already answers and simply confirm it in one line (an idea that says "CLI tool" has settled visual direction — do not ask);',
    'and keep digging where a topic is genuinely open or has a lot riding on it, which may take several questions on its own.',
    'Ask nothing you can infer, and stop when the load-bearing decisions are settled rather than when the list runs out.',
    // The scope tier scales every spec's size budget, so the specs match the
    // product rather than the writers' appetite (feedback §1). Resolved here
    // because only the human knows how big this is meant to be.
    `Also settle how big this product is, and record it in the brief as a line "scope: <${SCOPE_TIERS.join('|')}>" —`,
    'small = a focused single-purpose tool, a prototype, a game with one level, a few screens;',
    'standard = a real product with several features and a normal amount of surface;',
    'large = a multi-module system, many integrations, or genuine scale. It scales how much specification gets written, so when in doubt pick the smaller tier.',
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

// The verdict word, however the validator dressed it up.
//
// Markdown emphasis around the word is the common case — `## VERDICT: **PASS**`
// — and a parser that demanded the bare word read that as NO VERDICT AT ALL. A
// correct plan was then failed as if QA had rejected it: a revision spent, then
// the build halted, on work the checker had just approved. Emphasis, backticks
// and quotes carry no meaning here, so step over them.
function parseVerdict(text) {
  // No \b — an underscore IS a word character, so `__PASS__` would never match
  // one. The lookahead does the real job: reject PASSABLE, accept any decoration.
  const m = String(text).match(/VERDICT:\s*[*_`"'\s]*(PASS|FAIL)(?![A-Za-z])/i);
  return m ? m[1].toUpperCase() : null;
}

// Deterministic build+test gate: the driver runs verify.sh ITSELF (no model
// judgment) — its exit code IS the gate. See docs/gspec-v2-design.md §13
// (implementation-validator, deterministic part). Captures stdout+stderr so the
// failure can be fed back to the implementer.
// IDLE, not total. A verify.sh that provisions a database and runs integration
// tests legitimately takes many minutes, so an absolute cap would kill working
// runs; what distinguishes hung from busy is whether it is still SAYING
// anything. That is exactly how a real stall was diagnosed by hand: a build sat
// for an hour on `docker info` against an unavailable daemon, and the only
// signal that a healthy run was healthy came from watching its child processes
// produce new output. Encode that signal instead of asking a person to watch.
const VERIFY_IDLE_MS = 10 * 60_000;   // silence this long means stuck, not slow
const VERIFY_MAX_MS = 60 * 60_000;    // backstop for a script that chatters forever

// How stale the manifest must be before a resume calls the gap an interruption.
// A live run rewrites it constantly, so anything past this means no driver was
// running — not that a stage was thinking. Same threshold as the verify gate's
// "silence means stuck", for the same reason.
const STOPPED_GAP_MS = 10 * 60_000;

// Minutes read naturally at these scales, but rounding a sub-minute value to
// "0 minutes" makes the one message a stuck user actually reads say nothing.
export function humanMs(ms) {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  const m = Math.round(ms / 60_000);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function runVerify(ctx) {
  return new Promise((resolve) => {
    if (ctx.dryRun) { log(chalk.dim('      would run: bash verify.sh')); return resolve({ code: 0, output: '(dry run)' }); }
    // detached: the child leads its own process group, so a hang in a grandchild
    // (the observed case) can be killed with it rather than left orphaned.
    const child = spawn('bash', ['verify.sh'], { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '';
    let done = false;
    let idle, hard;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(idle);
      clearTimeout(hard);
      resolve(result);
    };

    const abort = (why) => {
      if (done) return;
      // SIGTERM first so the script can tear down anything it provisioned (a
      // disposable database container is the common case); SIGKILL only if it
      // ignores that. Killing the process GROUP matters — the hang is usually in
      // a grandchild, and killing bash alone leaves it running.
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 10_000).unref?.();
      finish({ code: 1, timedOut: true, output: `${output}\n\nverify.sh ${why} — the driver stopped it. This is an environment problem, not a code failure: a step is waiting on something that never arrives (an unavailable Docker daemon and an interactive prompt are the two observed causes). Make every preflight non-blocking — fail fast with a message instead of waiting.` });
    };

    const bumpIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => abort(`produced no output for ${humanMs(VERIFY_IDLE_MS)}`), VERIFY_IDLE_MS);
      idle.unref?.();
    };

    hard = setTimeout(() => abort(`ran longer than ${humanMs(VERIFY_MAX_MS)}`), VERIFY_MAX_MS);
    hard.unref?.();
    bumpIdle();

    const take = (d) => { output += d.toString(); bumpIdle(); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => finish({ code: 1, output: `verify.sh could not run: ${e.message}` }));
    child.on('close', (code) => finish({ code: code ?? 1, output }));
  });
}

// Keep the tail of large tool output when feeding a failure back into a prompt.
function tail(text, n = 4000) {
  const s = String(text);
  return s.length > n ? '…\n' + s.slice(-n) : s;
}

// --- stage prompts --------------------------------------------------------

// `templates` is the saved-spec block from templateNote() — passed only to the
// WRITER prompts of the stages that have a library, never to a planner (which
// decides scope, not content) and never to profile/architecture.
function stageBrief(stage, brief, extra = '', templates = '') {
  return [
    `You are the "${stage.title}" stage of an autonomous gspec build. You cannot ask the user questions.`,
    'Use this resolved brief:',
    '',
    brief || '(no brief file found — infer reasonable decisions from the specs already present)',
    '',
    extra,
    templates,
    'Produce your deliverable per your agent instructions. Make reasonable, clearly-labeled assumptions and record any deferred decisions; do not block.',
  ].join('\n');
}

// The validator sees the deliverable fresh each pass. On a RE-validation (after a
// surgical revision) it also gets the verdict it is re-checking, so it confirms
// which findings the revision resolved BEFORE raising new ones and holds the bar
// steady — the counter to the observed "every revision surfaces a fresh nit,
// budget drains" non-convergence (feedback §2).
function validatorPrompt(stage, target = '', priorVerdict = '', scope = DEFAULT_SCOPE) {
  const base = [
    `Validate ${target || `the ${stage.title}`} against its quality bar and return the structured verdict (first line "VERDICT: PASS" or "VERDICT: FAIL", then findings).`,
    // The tier scales every size budget, and the validator grades against the
    // same table the writer wrote to (gspec-conventions → Size budgets).
    `This project's scope tier is ${scope} — scale the size budgets by it. An over-budget spec is at most a [minor] finding and never a reason to FAIL.`,
  ].join(' ');
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

// True if ANY listed output exists and is non-empty — the "did the writer
// actually produce its artifact?" check behind the crash-vs-gate distinction.
// A stage's `outputs` are ALTERNATIVES, not a checklist: the style stage writes
// gspec/style.html OR gspec/style.md (the skip-if-present check at the top of
// the foundation case reads them the same way, and the validator target joins
// them with " or "). Demanding both made `delivered()` permanently false for
// that stage — a clean write was reported as "produced no deliverable", retried,
// and dead-ended, and the post-write-crash recovery path could never fire.
async function outputsPresent(cwd, outputs = []) {
  for (const rel of outputs) {
    try { if ((await stat(join(cwd, rel))).size) return true; } catch { /* try the next alternative */ }
  }
  return false;
}

// The checklist counterpart: EVERY path must exist and be non-empty. Used where
// a stage's deliverable is a set rather than a choice (the architecture's two
// tiers), so a partial write is not mistaken for success.
async function allPresent(cwd, paths = []) {
  if (!paths.length) return false;
  for (const rel of paths) {
    try { if (!(await stat(join(cwd, rel))).size) return false; } catch { return false; }
  }
  return true;
}

// What the architecture stage owes: the system tier, plus one module-tier file
// per Modules-table row once there is more than one row.
//
// The root file existing does NOT imply the module tier does — without this the
// stage reports `done` for a multi-module system that wrote only architecture.md,
// and every later stage routes against boundaries that were never written. The
// table is the authority for the list (the same authority verify.sh uses), so
// the check is derived rather than configured.
export async function architectureDeliverables(cwd) {
  const root = 'gspec/architecture.md';
  let text;
  try { text = await readFile(join(cwd, root), 'utf-8'); } catch { return [root]; }
  return [root, ...moduleSpecPaths(parseModulesTable(text))];
}

// --- amending an architecture that already exists ---------------------------
//
// The architecture stage is NOT skip-if-present, and that is deliberate: adding
// a feature to an existing product usually does need a new module, a new
// contract, or a new spine anchor, and skipping would leave the new feature's
// arch.md with nothing upstream to point at. So the writer runs — but on a
// project that already has an architecture it is AMENDING a reviewed document,
// not authoring one, and the difference has to reach both the prompt and a floor.

export async function architectureSnapshot(cwd) {
  return parseModulesTable(await readOr(cwd, 'gspec/architecture.md'));
}

// The one invariant a regex can hold: the Modules table only grows.
//
// Every gspec/architecture/<name>.md path is derived from a row name, and every
// feature arch.md points into that tier by path. Nothing re-points a feature
// when a row is renamed, and no existing check would notice: the feature files
// are never regenerated once well-formed, and archLintViolations reads one file
// at a time and never resolves a path. So a rename is silent, and it is silent
// in the direction that matters — the spec still lints, still validates, and now
// describes a file that is not there.
export async function lintArchitectureAmend(cwd, before = []) {
  const dropped = droppedModules(before, await architectureSnapshot(cwd));
  return dropped.map((name) =>
    `gspec/architecture.md: the Modules & Verification table no longer has a row named "${name}", but it did before this stage ran. `
    + `That row is what derives gspec/architecture/${name}.md, and the feature specs point at that path — dropping or renaming the row `
    + `orphans the module tier and leaves every "uses:"/"amends:"/"defined-in: gspec/architecture/${name}.md" reference dangling. `
    + `Restore the row under its original name "${name}". If the module really is retired, keep the row and say so in its entry `
    + `rather than deleting it, so the tier file and the references to it stay resolvable.`);
}

// A file whose frontmatter says it is a DECLARATION, not a finished spec.
//
// The declare pass writes features/<slug>/arch.md as a headings-only skeleton
// that the elaborate pass fills in. That skeleton passes every existing
// well-formedness test — it is >40 chars and opens with frontmatter — so a crash
// between the two passes would leave a file the driver reports as delivered and
// the elaborate pass then skips. One frontmatter key makes the half-state
// EXPLICIT rather than accidental, and every "is this done?" check reads it.
export const DECLARED_MARKER = /^stage:\s*declared\s*$/m;
const isDeclaration = (text) => DECLARED_MARKER.test(String(text));

// A spec file that exists, has real content, and opens with frontmatter or a
// heading — "complete and well-formed enough to let QA judge it" (feedback §7).
async function looksComplete(cwd, rel) {
  try {
    const t = (await readFile(join(cwd, rel), 'utf-8')).trim();
    if (isDeclaration(t)) return false;   // a skeleton is not a spec
    return t.length > 40 && (t.startsWith('---') || /^[#<]/m.test(t));
  } catch { return false; }
}

// The declare pass's own bar: the skeleton exists, says what it is, and actually
// declares something. "Has anchors" is the part that matters — a file with
// frontmatter and four empty sections has declared nothing for resolve to work
// with, and would sail past a length check.
async function looksDeclared(cwd, rel) {
  try {
    const t = await readFile(join(cwd, rel), 'utf-8');
    return isDeclaration(t) && /^###\s+\w+:/m.test(t);
  } catch { return false; }
}

// The same bar for a feature's PRD, in whichever layout it currently lives.
async function looksCompletePrd(cwd, slug) {
  return looksComplete(cwd, await prdPath(cwd, slug));
}

// A plan file is only usable if it actually contains task checkboxes — the
// structural check that catches an engine which errored into a prose apology.
async function looksCompletePlan(cwd, rel) {
  try {
    return /^\s*[-*]\s*\[[ xX]\]/m.test(await readFile(join(cwd, rel), 'utf-8'));
  } catch { return false; }
}

// Measure a produced spec against its size budget and report it (feedback §1).
// ADVISORY ONLY — an over-budget spec is logged here and noted for QA, and
// never fails a stage; the severity contract caps the matching QA finding at
// [minor], so size alone can't pause a run. Returns a line for the next
// revision prompt when the draft is meaningfully over, else ''.
// `tag` prefixes the line with a fan-out counter ("[3/8] ") so a stage that
// produces many files says how far along it is — see progressTag().
async function reportSize(ctx, rel, tag = '') {
  const budget = budgetFor(rel, ctx.scope);
  if (!budget || ctx.dryRun) return '';
  let text;
  try { text = await readFile(join(ctx.cwd, rel), 'utf-8'); } catch { return ''; }
  const words = countSpecWords(text, rel);
  const tier = ctx.scope !== DEFAULT_SCOPE ? `, ${ctx.scope} scope` : '';
  if (words <= budget * BUDGET_TOLERANCE) {
    log(chalk.dim(`      ${tag}${rel} — ${words} words (budget ${budget}${tier})`));
    return '';
  }
  const ratio = (words / budget).toFixed(1);
  log(chalk.yellow(`      ${tag}${rel} — ${words} words, ${ratio}× its ${budget}-word budget${tier} (advisory: noted for QA, does not block)`));
  return `Size: this draft is ${words} words against a ${budget}-word budget (${ratio}× over). While making the edits above, bring it toward the budget by cutting restatement, duplicated tables, and rationale for minor decisions — never by dropping a required section, a capability, or an acceptance criterion.`;
}

// Run a writer agent and decide whether it actually DELIVERED. The exit code
// alone answers neither half of that question, and both halves were observed
// going wrong:
//   • exit non-zero AFTER the artifact landed — a transient post-write crash
//     (feedback §7: a complete, well-formed PRD was discarded because of one).
//     Retry once; if it still exits non-zero but the artifact is present and
//     well-formed, accept it and let the QA gate judge quality.
//   • exit ZERO with no artifact — the engine reported an auth failure, a rate
//     limit, or a usage cap as its "final message" and exited clean. This used
//     to be waved through: the stage marched on and the VALIDATOR failed on a
//     file that did not exist, so the run paused blaming QA for a missing
//     document nobody had written. Retry once, then fail with the real reason.
// `artifactOk` is an async predicate; omit it to just retry on a non-zero exit.
// Returns { code, text, failure } where `failure` is a ready-made reason string
// (null when the writer delivered).
async function runWriterResilient(agentName, prompt, ctx, extra, artifactOk) {
  // A dry run spawns nothing, so there is no artifact to insist on.
  const delivered = async () => !artifactOk || ctx.dryRun || (await artifactOk());
  // A writer made progress when its deliverable exists; with no predicate the
  // question is unanswerable and the record says nothing either way.
  const withProgress = (e) => (artifactOk ? { ...e, progress: () => artifactOk() } : e);

  let out = await runAgent(agentName, prompt, ctx, withProgress(extra));
  if (out.code === 0 && await delivered()) return { ...out, failure: null };

  log(chalk.dim(out.code === 0
    ? `      ${agentName} exited 0 but produced no deliverable — retrying once (the engine may have errored)…`
    : `      ${agentName} exited ${out.code} — retrying once (may be a transient post-write crash)…`));
  // Whatever the first run was for, the second is the same brief re-sent after
  // an engine error — the waste bucket the report exists to show.
  out = await runAgent(agentName, prompt, ctx, withProgress({ ...extra, kind: 'transient-retry' }));
  if (out.code === 0 && await delivered()) return { ...out, failure: null };

  if (out.code !== 0 && artifactOk && await delivered()) {
    log(chalk.dim(`      ${agentName} exited ${out.code} again, but its artifact is present and well-formed — accepting and letting QA judge it.`));
    return { ...out, code: 0, recovered: true, failure: null };
  }
  // Carry the engine's own words into the failure.
  //
  // "exited 1" alone cannot tell a transient overload (resume and it passes)
  // from a broken prompt (resuming loops forever) — and that is precisely the
  // moment a user is least equipped to dig. A dogfood run failed here twice,
  // reported nothing but the exit code, and took three manual reproductions to
  // establish it was transient. The engine usually says why; keep it.
  const said = tail(String(out.text || '').trim(), 400);
  return {
    ...out,
    failure: out.code === 0
      ? `${agentName} exited 0 twice without producing its deliverable — the engine reported success but wrote nothing (check its output above for an auth, rate-limit, or usage error)`
      : `${agentName} exited ${out.code}${said ? ` — it said: ${said}` : ' with no output (often a transient engine error; --resume retries just this item)'}`,
    detail: out.text || undefined,
  };
}

// Grade a validator verdict, and say so out loud when there was no verdict to
// grade. A checker whose output carries no `VERDICT:` line has not judged
// anything — usually because the engine errored rather than because the spec is
// bad — and the downstream failure ("QA gate did not pass") names the wrong
// culprit unless the real one is on the record.
function grade(stage, text, what) {
  const g = gradeVerdict(text);
  if (g.verdict === null) {
    log(chalk.yellow(`      ${stage.validator} returned no "VERDICT:" line for ${what} — treating it as unvalidated. This usually means the engine errored, not that the draft is bad; its full output is kept with the verdict.`));
  }
  return g;
}

// Ask the checker, and retry it ONCE if it returns no verdict.
//
// A response with no VERDICT line is an ENGINE failure, not a finding — a
// truncated stream, a dropped connection. Handing it to the writer means asking
// it to repair "API Error: Connection closed mid-response", which it cannot do,
// so the revision is pure waste and its failure then looks like the draft's
// fault. A measured run lost a build exactly this way: the implementation
// validator's connection dropped, the implementer was sent to fix the error
// text, and it exited 1.
//
// This lives in one place because it did not before: reviseUntilPass had the
// protection and the implement gate — a separate hand-rolled loop — did not.
// Why a target ended up unvalidated. A usage limit and a broken engine both
// arrive as "no VERDICT:", and they want opposite responses from the reader:
// one is a clock to wait out, the other is something to look into. Saying
// "engine error — fix the issue" for a session limit sends a person hunting a
// defect that does not exist.
function unvalidatedReason(stage, target, text, after = '') {
  const when = ` after ${after}`;
  if (looksRateLimited(text)) {
    return `${target} could not be validated${after ? when : ''} — ${stage.validator} hit a usage limit. This resets on a clock: nothing is broken and there is nothing to fix. Wait for the reset, then \`gspec build --resume\`. The engine said: ${tail(String(text || '').trim(), 200)}`;
  }
  return `${target} could not be validated${after ? when : ''} — ${stage.validator} returned no verdict across ${MAX_TRANSIENT_RETRIES + 1} attempts with escalating waits (an engine error, not a finding)`;
}

async function judgeOnce(stage, target, addressed, ctx, runOpts = {}) {
  let v = await runAgent(stage.validator, validatorPrompt(stage, target, addressed, ctx.scope), ctx, runOpts);
  let g = grade(stage, v.text, target);
  if (g.verdict === null) {
    // A capacity limit is not a dropped connection. It resets on a CLOCK, so
    // the immediate re-run below walks straight into the same wall and the run
    // then reports "no verdict twice — an engine error", telling the reader to
    // fix something that is not broken. The implementer path has surfaced
    // limits immediately since v3; validators never learned to, and a real run
    // died here on "You've hit your session limit · resets 12:30am" having
    // spent two validator runs discovering it twice.
    if (looksRateLimited(v.text)) {
      log(chalk.yellow(`      ${stage.validator} hit a usage limit — not retrying (a limit resets on a clock, a retry only spends another run).`));
      return { v, g };
    }
    // Wait longer each time, rather than retrying once, immediately.
    //
    // An outage is usually wider than one pause — the lesson the implement loop
    // already encodes, and the only place the escalating backoff was ever
    // wired. Validators re-ran instantly and only once, so a momentary network
    // fault took the whole build: this run died on "API Error: Unable to
    // connect to API (ENOTFOUND)" at the plan stage, both attempts inside the
    // same blip, and the specs behind it were fine.
    for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES && g.verdict === null; attempt++) {
      const wait = backoffFor(attempt - 1);
      log(chalk.dim(`      re-running ${stage.validator} in ${Math.round(wait / 1000)}s — the last response carried no verdict (${attempt}/${MAX_TRANSIENT_RETRIES}; engine error, not a finding)…`));
      if (wait) await sleep(wait);
      v = await runAgent(stage.validator, validatorPrompt(stage, target, addressed, ctx.scope), ctx, runOpts);
      g = grade(stage, v.text, target);
      // A limit that appears mid-retry is still a clock, not an outage.
      if (g.verdict === null && looksRateLimited(v.text)) {
        log(chalk.yellow(`      ${stage.validator} hit a usage limit — stopping the retries (a limit resets on a clock).`));
        break;
      }
    }
  }
  return { v, g };
}

// --- the self-healing writer -> validator gate ----------------------------

// A QA revision is a repair, not a rewrite. Re-sending the full authoring
// prompt with a verdict stapled on biases a fresh agent toward generating more
// material (drafts were observed growing while "fixing" contradictions in what
// they already had). So the revision prompt names the deliverable, carries
// EVERY verdict so far (attempt N sees what N-1 was told), and restricts the
// writer to the edits the findings name. The failed verdict is also the
// trigger of the memory convention (gspec-memory), so recording is a stated
// step of the run — conditional, since read-only agents cannot record.
//
// With the document text in hand and anchored findings (gspec-qa's `anchor:`
// line), the prompt inlines the SECTIONS the findings name and summarizes
// earlier rounds to one line each — the writer opens the file to apply edits,
// not to find them, and the prompt stops growing per round. Without either
// (no document, or a verdict whose findings carry no anchor) it is the shape
// it always was. `revisePromptDetailed` also returns which findings had no
// usable anchor, so a validator brief that forgets them is visible.
export function revisePrompt(stage, target, verdicts, sizeNote = '', docText = '') {
  return revisePromptDetailed(stage, target, verdicts, sizeNote, docText).prompt;
}

export function revisePromptDetailed(stage, target, verdicts, sizeNote = '', docText = '') {
  const latest = verdicts[verdicts.length - 1] || '';
  const anchored = docText ? anchoredRevisionBlocks(latest, docText) : null;
  const useAnchors = Boolean(anchored && anchored.findings.length && anchored.blocks.length > anchored.unanchored.length);
  const unanchored = anchored ? anchored.unanchored : [];

  if (useAnchors) {
    const prior = verdicts.slice(0, -1);
    const rounds = summarizeRounds(prior, anchored.findings);
    const prompt = [
      `You are the "${stage.title}" stage of an autonomous gspec build. You cannot ask the user questions.`,
      `A prior draft of ${target} failed QA. This is a surgical revision, not a rewrite: the sections below are the only ones to edit — open the file only to apply these edits, make ONLY the edits the findings name, and preserve everything else byte-for-byte. Do not add sections or material no finding asks for.`,
      ...PRECEDENCE_RULES,
      ...(sizeNote ? [SIZE_RULE(sizeNote)] : []),
      ...(prior.length ? ['Earlier rounds are summarized to one line each below. A finding marked "reappeared" means the earlier fix did not land — fix it differently rather than repeating it.'] : []),
      MEMORY_RULE,
      '',
      ...(rounds.length ? ['--- Earlier rounds ---', ...rounds, ''] : []),
      `--- Verdict ${verdicts.length}${verdicts.length > 1 ? ` of ${verdicts.length}` : ''} (current — fix this one) ---`,
      latest,
      '',
      `--- The sections these findings are about (from ${target}) ---`,
      ...anchored.blocks,
    ].join('\n');
    return { prompt, unanchored, anchored: true };
  }

  const history = verdicts.map((v, i) =>
    `--- Verdict ${i + 1} of ${verdicts.length}${i === verdicts.length - 1 ? ' (current — fix this one)' : ' (an earlier attempt already tried to fix this)'} ---\n${v}`).join('\n\n');
  const prompt = [
    `You are the "${stage.title}" stage of an autonomous gspec build. You cannot ask the user questions.`,
    `A prior draft of ${target} failed QA. This is a surgical revision, not a rewrite: read the existing document and make ONLY the edits the findings below name, preserving everything else byte-for-byte. Do not add sections or material no finding asks for.`,
    ...PRECEDENCE_RULES,
    ...(sizeNote ? [SIZE_RULE(sizeNote)] : []),
    ...(verdicts.length > 1 ? ['Every verdict so far is included below, oldest first. A finding that reappears in a later verdict means the earlier fix did not land — fix it differently rather than repeating it.'] : []),
    MEMORY_RULE,
    '',
    history,
  ].join('\n');
  return { prompt, unanchored, anchored: false };
}

// The rules both prompt shapes share, verbatim — they were hard-won.
const PRECEDENCE_RULES = [
    // PRECEDENCE FIRST, then the anti-growth rule it governs. Stated the other
    // way round, a verdict like "eight required sections are missing" (a fix
    // that multiplies the document's length) put the writer between two rules
    // with no ranking, and only its judgment decided which one gave way.
    'Precedence, when two of these rules pull against each other: resolving a blocker or major finding outranks every size rule. If a finding names content that is MISSING — a required section, a capability, an acceptance criterion — add it in full, however much the document grows, and do not water it down to stay near a word count. An unresolved blocker fails this gate; an over-budget document never does.',
    'Subject to that, resolve each finding in place: growth is for what the findings require and nothing else. Adding material no finding asks for — or growing the document by more than ~10% while resolving no blocker/major finding — is itself a defect, because precision comes from tightening what is there, not from appending prose (which only gives the next QA pass new text to fault).',
];
// The measured overage (feedback §1). A draft already past its ceiling pays
// for required additions by cutting elsewhere — but still adds them.
const SIZE_RULE = (sizeNote) => `${sizeNote} Because this draft is already over budget, pay for anything a finding requires you to add by cutting restatement, duplicated tables, and rationale for minor decisions elsewhere — resolve every OTHER finding by replacing text rather than appending to it. If it still ends up over budget once every finding is resolved, that is the correct outcome: say so in your summary (and, for a feature or architecture spec, say whether the overage means the scope should be split) rather than leaving a finding unresolved.`;
const MEMORY_RULE = 'This failed verdict is corrective feedback: if the gspec-memory convention is in your instructions, record the generalizable memory to .gspec/memory/pending/ (or state in your summary why the finding was purely project-specific) before returning.';

// The document a revision is about, for the anchored prompt: the target when
// it is a readable file, else the first of the stage's outputs that exists
// (a stage whose deliverable is "style.md or style.html"). '' when none is.
async function readRevisionDoc(ctx, stage, target) {
  const candidates = [target, ...(stage.outputs || [])].filter((p) => p && !/\s/.test(p));
  for (const rel of candidates) {
    const text = await readOr(ctx.cwd, rel, null);
    if (text !== null) return text;
  }
  return '';
}

// revisePrompt with the document read and the unanchored findings logged —
// the one place a forgotten `anchor:` line becomes visible.
async function reviseBrief(ctx, stage, target, verdicts, sizeNote) {
  const doc = await readRevisionDoc(ctx, stage, target);
  const { prompt, unanchored, anchored } = revisePromptDetailed(stage, target, verdicts, sizeNote, doc);
  if (anchored) {
    log(chalk.dim(`      revision brief: ${countSpecWords(prompt)} words — the sections the findings anchor, not the whole document${unanchored.length ? ` (${countNoun(unanchored.length, 'finding')} without a usable anchor — falling back to its evidence quote)` : ''}`));
  } else if (unanchored.length) {
    log(chalk.yellow(`      ${stage.validator || 'the validator'} returned ${countNoun(unanchored.length, 'finding')} with no usable anchor: line — the revision falls back to re-reading ${target}. (The gspec-qa contract asks for one per finding.)`));
  }
  return prompt;
}


// The implement stage's revision prompt — the code equivalent of revisePrompt().
//
// This stage rebuilt from scratch on every self-heal: `${buildPrompt}` with a
// verdict stapled on. revisePrompt exists precisely because that shape biases a
// fresh agent toward generating MORE material rather than repairing what is
// there, and every spec stage routes through it; implement was the one that did
// not. It is also the most expensive place to get this wrong — the implementer
// is ~92% of a build's input tokens.
//
// Carries EVERY finding so far, oldest first, for the same reason revisePrompt
// does: attempt N must see what N-1 was already told, or it repeats a fix that
// did not land.
export function implementRevisePrompt(stage, scopeLabel, findings, { deterministic = false } = {}) {
  const history = findings.map((f, i) => {
    const which = findings.length === 1 ? ''
      : ` ${i + 1} of ${findings.length}${i === findings.length - 1 ? ' (current — fix this one)' : ' (an earlier attempt already tried to fix this)'}`;
    return `--- Finding${which} ---\n${f}`;
  }).join('\n\n');
  return [
    `You are the "${stage.title}" stage of an autonomous gspec build. You cannot ask the user questions.`,
    `The implementation of ${scopeLabel} did not pass. This is a SURGICAL repair, not a rebuild: change only what the findings below name, and leave every other file byte-for-byte as it is.`,
    deterministic
      ? 'These are deterministic findings — each names exactly what is wrong. Fix them; do not uncheck a task to make one go away.'
      : 'Resolve every finding, then make sure verify.sh still passes. Do not uncheck a task, renumber one, or narrow a capability to make a finding go away — that is descoping, not fixing.',
    'Do not rewrite working code, restructure files, or add functionality no finding asks for. If a finding names something MISSING, add it in full; otherwise the smallest change that resolves the finding is the correct one.',
    ...(findings.length > 1 ? ['Every finding so far is below, oldest first. One that reappears means the earlier fix did not land — fix it differently rather than repeating it.'] : []),
    'This is corrective feedback: if the gspec-memory convention is in your instructions, record the generalizable memory to .gspec/memory/pending/ before returning.',
    '',
    history,
  ].join('\n');
}

// Deterministic lint, looped until clean. Anything a regex can decide (anchor
// grammar, section shape, screen coverage, a module row that vanished) goes
// straight back to the writer with the exact violations — no agent run spent
// discovering it, and a precise instruction instead of a vague FAIL. The
// validator then only ever judges mechanically-clean drafts.
//
// One implementation, two callers: the per-feature fan-out and the single
// gate() deliverable. They differ only in how they find the file and what extra
// guidance the fix needs, and the loop's subtleties — the non-convergence
// signature, recording each round to qa-failures.md, printing violations rather
// than counting them — are exactly the kind that a second hand-written copy
// silently drops. Returns null when clean, or a failed stage result.
async function lintUntilClean(stage, target, ctx, { lint, outputsOk = null, extraGuidance = [] }) {
  const seenFindings = new Set();
  for (let r = 0; ; r++) {
    const violations = await lint();
    if (!violations.length) return null;
    const signature = violations.join('\n');
    const stuck = seenFindings.has(signature);
    if (r >= MAX_LINT_ROUNDS || stuck) {
      return {
        status: 'failed',
        reason: `${target} still fails the mechanical lint after ${countNoun(r, 'fix')}${stuck ? ' — the last round reported findings it had already been given, so it is not converging' : ''}`,
        detail: signature,
      };
    }
    seenFindings.add(signature);
    // Print them, don't just count them — and keep them.
    //
    // This gate BLOCKS and spends a writer run, and a bare count leaves the
    // one person who could spot a bad finding with nothing to look at. The
    // implement lint was fixed for exactly this; the per-feature lint kept
    // the defect, and a run that died here proved the cost: the terminal
    // violation survived in `detail`, but the OTHER issue in the same round,
    // and everything an earlier round had faced, was gone. Recording them
    // also makes qa-failures.md true to its preamble, which claims to hold
    // every failing verdict a run observes — mechanical ones included.
    log(chalk.yellow(`      ${target} — ${countNoun(violations.length, 'lint issue')}; fixing (free — no validator run)…`));
    for (const v of violations) log(chalk.dim(`        · ${v}`));
    await ctx.recordFeedback(stage, `${stage.id}-lint`, signature, { target, attempt: r + 1 });
    // Send the offending lines, not a pointer at the file. The fix is a
    // one-line edit; what made it cost a full run was the writer re-reading
    // the document to find the line (lib/lint-fix.js). `target` is a path
    // for the per-feature stages and a label ("gspec/style.md or
    // gspec/style.html") for a set — the slice is skipped when it is not a
    // readable file, and the prompt degrades to what it always was.
    const doc = /\s/.test(target) ? '' : await readOr(ctx.cwd, target);
    const fix = await runWriterResilient(
      stage.writer,
      lintFixPrompt(target, violations, doc, { extraGuidance }),
      ctx, { kind: 'lint-fix' }, outputsOk,
    );
    if (fix.failure) return { status: 'failed', reason: `${target} lint fix: ${fix.failure}` };
  }
}

// A fix that RENAMES an anchor is the one move that can trade one violation for
// a different one, and the budget only covers a single round. Observed end to
// end: a writer qualified an anchor ("### Entity: SimEvent (wave variants)"),
// the grammar floor rejected the name, the writer renamed it to the canonical
// "### Entity: SimEvent" — correct, and the only possible name — then wrote
// `defined-in:` because nothing in that finding said otherwise. That created a
// second origin, which failed the stage on the re-lint with the retry already
// spent. The rename is not the mistake; being told about it one violation at a
// time is.
const ANCHOR_RENAME_GUIDANCE = [
  'If a fix RENAMES an anchor, the new name carries the origin/delta rule with it:',
  'grep the tree for the new heading first. If another file already defines it with',
  '`- **defined-in:**`, this file must write `- **amends:** <that file>` plus its delta —',
  'never a second `defined-in:`. Renaming into an existing origin is the usual way a',
  'one-round fix replaces one violation with another and fails the stage.',
];

// `opts.revalidate` (feedback §4): resuming a stage that FAILED QA re-validates
// the deliverable on disk FIRST instead of regenerating it — so a hand-edit the
// user made to unblock is honored, and the gate is re-enforced rather than
// skipped. The initial writer pass is run only for a genuine first authoring.
//
// `opts.lint` is the same deterministic-floor-before-the-validator contract the
// per-feature stages have, for a stage whose deliverable is a single set: it
// runs after the write and must come back clean before a validator run is spent.
async function gate(stage, writerPrompt, validatorTarget, ctx, opts = {}) {
  const target = validatorTarget || (stage.outputs || []).join(' or ') || `the ${stage.title} deliverable`;
  const sizeTargets = (stage.outputs || []).length ? stage.outputs : (validatorTarget ? [validatorTarget] : []);
  // Null when the stage declares no checkable deliverable — then "did it
  // deliver?" is unanswerable and the writer is only retried on a hard error.
  // A stage whose deliverable SET depends on what the writer produced (the
  // architecture: one module-tier file per Modules-table row) resolves it lazily
  // after each write, and every listed path must be present — a checklist, not
  // the alternatives that `outputs` expresses.
  const dynamic = typeof stage.deliverables === 'function';
  const resolveTargets = dynamic ? () => stage.deliverables(ctx.cwd) : async () => sizeTargets;
  // Null when the stage declares no checkable deliverable — then "did it
  // deliver?" is unanswerable and the writer is only retried on a hard error.
  const outputsOk = dynamic
    ? async () => allPresent(ctx.cwd, await resolveTargets())
    : (sizeTargets.length ? () => outputsPresent(ctx.cwd, sizeTargets) : null);
  // Measure each deliverable against its budget (feedback §1) and keep the note
  // for the next revision prompt. Advisory: never gates, only reports.
  const measure = async () =>
    (await Promise.all((await resolveTargets()).map((rel) => reportSize(ctx, rel)))).filter(Boolean).join('\n');

  let sizeNote = '';
  if (opts.revalidate) {
    log(chalk.dim('      resumed after a QA failure — re-validating the current draft (any hand-edits preserved) instead of regenerating.'));
    sizeNote = await measure();
  } else {
    const out = await runWriterResilient(stage.writer, writerPrompt, ctx, {}, outputsOk);
    if (out.failure) return { status: 'failed', reason: out.failure };
    sizeNote = await measure();
  }
  // --no-qa skips the deterministic floor too, matching the per-feature stages:
  // that flag means "I am driving, do not gate me", and a floor that blocks in
  // one stage while every other gate is off is a worse surprise than either
  // uniform answer.
  if (ctx.noQa) return { status: 'done', verdict: 'skipped' };

  // The floor runs even on a revalidate: a hand-edit made during the pause is
  // exactly as capable of dropping a module row as a writer is.
  if (opts.lint) {
    const failed = await lintUntilClean(stage, target, ctx, { lint: opts.lint, outputsOk });
    if (failed) return failed;
    sizeNote = await measure();
  }
  if (!stage.validator) return { status: 'done', verdict: null };

  return reviseUntilPass(stage, target, ctx, {
    validatorTarget,
    outputsOk,
    measure,
    sizeNote,
    writerPrompt: (verdicts, note) => reviseBrief(ctx, stage, target, verdicts, note),
  });
}

// Validate, then self-heal from the verdict up to ctx.qaRetries times.
//
// The same loop is needed wherever a producer is followed by a checker — the
// single-deliverable gate above and the per-feature fan-outs — and it is subtle
// enough (which verdict a revision is answering, when size is re-measured, what
// a terminal failure carries for the pause) that a second hand-written copy
// would drift. One implementation, parameterized by how the caller finds its
// deliverable and phrases its revision.
async function reviseUntilPass(stage, target, ctx, opts) {
  const { validatorTarget = target, outputsOk = null, measure = async () => '', writerPrompt } = opts;
  let sizeNote = opts.sizeNote ?? '';

  // Ask the checker. A response with no VERDICT line is an ENGINE failure, not a
  // finding — a truncated stream, a dropped connection, a rate limit. Retry the
  // VALIDATOR once; never hand it to the writer, which was the old behavior and
  // meant a writer received "API Error: Connection closed mid-response" as the
  // defect it was supposed to repair. It cannot repair that, so the revision was
  // pure waste and its failure then looked like the draft's fault.
  const judge = async (addressed) => {
    const { v, g } = await judgeOnce(stage, validatorTarget, addressed, ctx);
    return { v, g };
  };

  let { v, g } = await judge('');
  if (g.verdict === 'PASS') return finishPass(stage, target, v, g, ctx);
  // Twice unvalidated is not a QA failure: say so plainly rather than blaming a
  // draft nobody managed to read.
  if (g.verdict === null) {
    return { status: 'failed', reason: unvalidatedReason(stage, target, v.text), verdict: 'unvalidated', detail: v.text };
  }

  // Seed from what earlier RUNS were told. A resume that starts this list empty
  // hands the writer a blank slate and it can repeat a fix already known to fail.
  const verdicts = [...ctx.priorVerdicts(stage.id, target).filter((t) => t !== v.text), v.text];
  for (let r = 1; r <= ctx.qaRetries; r++) {
    await ctx.recordFeedback(stage, stage.validator, v.text, { target, attempt: r });
    log(chalk.yellow(`      QA flagged issues — revision ${r}/${ctx.qaRetries}… (${summarize(v.text)})`));
    const addressed = v.text; // the verdict this revision is trying to resolve
    const out = await runWriterResilient(stage.writer, await writerPrompt(verdicts, sizeNote), ctx, { kind: 'revision' }, outputsOk);
    if (out.failure) return { status: 'failed', reason: `revision ${r}: ${out.failure}` };
    sizeNote = await measure();
    ({ v, g } = await judge(addressed));
    if (g.verdict === 'PASS') return finishPass(stage, target, v, g, ctx);
    if (g.verdict === null) {
      return { status: 'failed', reason: unvalidatedReason(stage, target, v.text, `revision ${r}`), verdict: 'unvalidated', detail: v.text };
    }
    verdicts.push(v.text);
  }
  // `detail` carries the verdict that ended the run; the driver prints it and
  // persists it (manifest + last-failure.md) so the pause is actionable.
  return { status: 'failed', reason: `QA gate did not pass after ${countNoun(ctx.qaRetries, 'revision')}`, verdict: g.verdict || 'unknown', detail: v.text };
}

// Every source-ish file in the repo, for resolving a partially-named path.
// Bounded: skips the directories that hold generated or vendored output, which
// are also the ones large enough to make this walk expensive.
const WALK_SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', '.venv', 'vendor']);
async function walkSourceFiles(cwd, dir = '', acc = []) {
  let entries;
  try { entries = await readdir(join(cwd, dir), { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    if (WALK_SKIP.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) await walkSourceFiles(cwd, rel, acc);
    else acc.push(rel);
  }
  return acc;
}

// --- the incremental audit ------------------------------------------------

const AUDIT_BASELINE_PATH = join('.gspec', 'audit-baseline');

async function gitCapture(cwd, args) {
  try {
    const r = await new Promise((resolve) => {
      const p = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => resolve(null));
      p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    });
    return r;
  } catch { return null; }
}

// What this audit should look at. A full sweep whenever we cannot answer the
// question cheaply and correctly — no baseline, not a repo, an unreadable ref —
// because a silently-narrow audit is worse than a slow one.
export async function auditScope(cwd) {
  const baseline = (await readOr(cwd, AUDIT_BASELINE_PATH)).trim();
  if (!baseline) return { full: true, instruction: '' };
  const changed = await gitCapture(cwd, ['diff', '--name-only', `${baseline}..HEAD`]);
  if (changed === null) return { full: true, instruction: '' };

  const paths = changed.split('\n').filter(Boolean);
  const slugs = new Set();
  for (const p of paths) {
    const m = p.match(/^gspec\/features\/([^/]+)\//);
    if (m) slugs.add(m[1]);
  }
  // A change to a root-tier spec or to code can invalidate any folder's inlined
  // claims, so it widens the scope back to everything rather than narrowing.
  const rootTouched = paths.some((p) => /^gspec\/(architecture|stack|style|practices)/.test(p));
  const codeTouched = paths.some((p) => !p.startsWith('gspec/'));
  if (rootTouched || !paths.length) return { full: true, instruction: '' };

  const targets = [...slugs].sort();
  if (!targets.length && !codeTouched) {
    return { full: false, instruction: 'Nothing under gspec/ or the source tree changed since the last audit — confirm that and return no findings rather than re-deriving the whole report.' };
  }
  return {
    full: false,
    instruction: [
      `INCREMENTAL SCOPE — audited through ${baseline}. Inspect only:`,
      ...(targets.length ? [`- these feature folders: ${targets.map((s) => `gspec/features/${s}/`).join(', ')}`] : []),
      ...(codeTouched ? ['- the source files changed since that commit (`git diff --name-only` against it)'] : []),
      '- the root-tier specs (architecture, stack, style, practices), which are small and always relevant',
      'Unchanged feature folders were audited before and have not moved; skip them.',
    ].join('\n'),
  };
}

async function recordAuditBaseline(cwd) {
  if (skipWrite()) return;
  const head = await gitCapture(cwd, ['rev-parse', 'HEAD']);
  if (!head) return; // not a repo, or no commits yet — stay on full audits
  try {
    await mkdir(join(cwd, '.gspec'), { recursive: true });
    await writeFile(join(cwd, AUDIT_BASELINE_PATH), `${head}\n`, 'utf-8');
  } catch { /* advisory: a missed baseline just means the next audit is full */ }
}

// The deterministic implement check (gate 1.5). Aggregates the pure floor over
// every feature folder, doing the I/O the floor deliberately does not.
//
// Scoped to what CHECKED tasks claim: this asks "is the work that says it is
// done actually there?", never "is the remaining work finished" — unchecked
// tasks are simply not built yet, which is not a finding.
export async function implementationLint(cwd, { render = true, log: say = () => {} } = {}) {
  const out = [];
  const slugs = await listFeatureSlugs(cwd);
  for (const slug of slugs) {
    const tasksRel = await planPath(cwd, slug);
    if (!(await pathExists(cwd, tasksRel))) continue;
    const tasks = await readOr(cwd, tasksRel);

    // 1. Did the files checked tasks name actually land?
    //
    // A task names a path the way a person would — `(library)/layout.tsx` for
    // what lives at `apps/web/src/app/(library)/layout.tsx`. Exact-match alone
    // called those missing and sent the implementer to re-create files that were
    // already there, so anything not found exactly is resolved by SUFFIX against
    // the real tree. The walk happens only when something is unresolved.
    const claimed = filesNamedByCheckedTasks(tasks);
    const present = new Set();
    const unresolved = [];
    for (const { path } of claimed) {
      if (await pathExists(cwd, path)) present.add(path);
      else unresolved.push(path);
    }
    if (unresolved.length) {
      for (const real of await walkSourceFiles(cwd)) {
        for (const named of unresolved) if (real.endsWith(`/${named}`)) present.add(named);
      }
    }
    out.push(...missingWorkViolations(tasksRel, tasks, present));

    // 2. Is any of that work a stub?
    for (const { id, path } of claimed) {
      if (!present.has(path)) continue;
      out.push(...stubViolations(path, await readOr(cwd, path), id));
    }

    // 3. Does the PRD overclaim relative to its own plan?
    const prdRel = await prdPath(cwd, slug);
    if (await pathExists(cwd, prdRel)) {
      out.push(...checkboxConsistency(prdRel, await readOr(cwd, prdRel), tasks));
    }
  }

  // 4. Does it render? Optional and fail-open: only when Playwright is a
  // dependency and a dev/start script exists, only for routes a feature's
  // arch.md declares, and any inability to render is a logged skip. What it
  // asserts is exactly what every text check missed on a measured build: a
  // route that answers, no console error, and the style guide's font family
  // actually applied where the text is set.
  if (render) out.push(...await renderLint(cwd, slugs, say));
  return out;
}

async function renderLint(cwd, slugs, say) {
  const pkgJsonText = await readOr(cwd, 'package.json', null);
  const avail = renderAvailable(pkgJsonText);
  if (!avail.playwright) return [];                 // silent: the common case, and not a gap in the project
  const fontFamily = primaryFontFamily(await readOr(cwd, 'gspec/style.html'));
  const out = [];
  for (const slug of slugs) {
    const routes = routesFromArch(await readOr(cwd, featureFile(slug, FEATURE_FILES.arch)));
    if (!routes.length) continue;
    const r = await renderChecks(cwd, routes, { fontFamily }, { pkgJsonText, screensDir: join(cwd, SCREENS_DIR, slug) });
    if (r.skipped) { say(chalk.dim(`      render check skipped for "${slug}" — ${r.skipped}`)); continue; }
    say(chalk.dim(`      rendered ${countNoun(routes.length, 'route')} for "${slug}"${r.screens.length ? ` — screenshots in ${join(SCREENS_DIR, slug)}` : ''}${r.violations.length ? ` — ${countNoun(r.violations.length, 'issue')}` : ''}`));
    out.push(...r.violations.map((v) => `${featureFile(slug, FEATURE_FILES.arch)}: ${v}`));
  }
  return out;
}

// The file-overlap evidence for the orchestrator (lib/wave-merge.js): every
// feature's module set (from its anchors), the anchors it amends, and the
// sibling slugs its PRD's Dependencies section names. Computed from the specs
// the driver already parses, so the orchestrator is handed an answer to "do
// these two write the same files?" instead of a rule to apply by reading code.
export async function featureOverlapEvidence(cwd) {
  const slugs = await listFeatureSlugs(cwd);
  const features = [];
  for (const slug of slugs) {
    const arch = await readOr(cwd, featureFile(slug, FEATURE_FILES.arch));
    const amends = anchorRefs(arch).filter(([, kind]) => kind === 'delta').map(([anchor]) => slugifyAnchor(anchor));
    const prd = await readOr(cwd, await prdPath(cwd, slug));
    features.push({ slug, modules: (await featureModules(cwd, slug)).sort(), amends, deps: prdDependencies(prd, slugs).filter((d) => d !== slug) });
  }
  return features;
}

// Sibling slugs a PRD's `## Dependencies` section mentions. Conservative on
// purpose: any mention of another feature's slug (or its slug with the
// hyphens as spaces, which is how a title is usually written) is an edge, and
// an edge only ever keeps two scopes serial.
export function prdDependencies(prdText, slugs = []) {
  const m = String(prdText).match(/^##\s+Dependencies\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return [];
  const body = m[1].toLowerCase();
  return slugs.filter((s) => body.includes(s.toLowerCase()) || body.includes(s.toLowerCase().replace(/-/g, ' ')));
}

// Persist the wave plan the run is about to execute.
//
// The orchestrator's answer was the one artifact of the implement stage that
// did not survive the run: `stages.implement` held status, attempts, verdict
// and elapsed time, and a post-mortem asking "what was serialized, and why?"
// had only the log. Recorded once the plan is accepted (normalized, split per
// feature) so run.json shows what actually ran, not what was proposed.
// Instructions are dropped — they are the implementer's brief, reproduced in
// full elsewhere; label and plan files are what a reader needs.
export async function recordWavePlan(ctx, stageId, waves) {
  if (!ctx.stageRecord) return;
  ctx.stageRecord(stageId).plan = waves.map((wave) => wave.map((s) => ({ label: s.label, plan: s.plan || [] })));
  if (ctx.saveManifest) await ctx.saveManifest();
}

// The persisted plan as lines for `--status`: one per wave, its scopes joined.
export function formatWavePlan(waves = []) {
  return waves.map((wave, i) => `wave ${i + 1}/${waves.length} — ${wave.map((s) => s.label).join(', ')}`);
}

// Split any scope that names more than one feature into sibling scopes, and say
// so. A bundled scope is not an error — the build succeeds, just expensively —
// so without this log it would never be noticed.
export async function splitScopesByFeature(cwd, wave) {
  const out = [];
  for (const scope of wave) {
    // Normalize legacy plan paths the orchestrator may still emit from an older
    // prose example: gspec/tasks/<slug>.md → the feature folder, when it exists.
    const files = [];
    for (const p of scope.plan || []) {
      const slug = featureSlugOf(p);
      const resolved = slug ? await planPath(cwd, slug) : p;
      if (resolved !== p) log(chalk.dim(`      note: rewrote stale plan path ${p} → ${resolved}`));
      files.push(resolved);
    }
    const bySlug = new Map();
    for (const f of files) {
      const slug = featureSlugOf(f) || scope.label;
      (bySlug.get(slug) || bySlug.set(slug, []).get(slug)).push(f);
    }
    if (bySlug.size <= 1) { out.push({ ...scope, plan: files }); continue; }
    log(chalk.yellow(`      scope "${scope.label}" spanned ${countNoun(bySlug.size, 'feature')} — split so each implementer reads one feature folder`));
    for (const [slug, plan] of bySlug) {
      out.push({ label: `${scope.label}: ${slug}`, instruction: `${scope.instruction} (this run: the "${slug}" feature only)`, plan });
    }
  }
  return out;
}

// The single feature a scope is confined to, or null (a scaffold, or a scope
// that still spans features). What the merge keys on.
export function scopeSlug(scope) {
  const slugs = [...new Set((scope.plan || []).map(featureSlugOf).filter(Boolean))];
  return slugs.length === 1 ? slugs[0] : null;
}

// The feature slug a plan path belongs to, in either layout.
function featureSlugOf(rel) {
  const r = String(rel).replace(/\\/g, '/');
  return r.match(/^gspec\/features\/([^/]+)\/tasks\.md$/)?.[1]
    ?? r.match(/^gspec\/tasks\/([^/]+)\.md$/)?.[1] ?? null;
}

// Every module tier a feature's architecture actually reaches into.
//
// The ANCHOR carries the module, not the feature. `module:` in the frontmatter
// was singular — "the module this feature belongs to" — and a feature spanning
// two deployables (an endpoint in `api`, a screen in `web`) therefore got ONE
// module tier in its read set and silently missed the other. That is a live
// defect, not just a gap in the sharing design; it has never fired only because
// every dogfood build so far declared one row in the Modules table.
//
// So the union of the per-block `- **module:**` lines is the answer, with the
// frontmatter as a fallback for a file that predates per-anchor tagging.
export async function featureModules(cwd, slug) {
  const arch = await readOr(cwd, featureFile(slug, FEATURE_FILES.arch));
  const names = new Set(anchorModules(arch).values());
  // A `uses:`/`amends:` stub names its module in the TARGET PATH, and a
  // two-line stub may carry nothing else. Reading the path back is what keeps a
  // pure consumer of another module's spine in that module's read set.
  for (const m of arch.matchAll(/gspec\/architecture\/([^/\s)`*]+)\.md/g)) names.add(m[1]);
  const frontmatter = arch.match(/^module:\s*(.+?)\s*$/m)?.[1];
  // Tolerate a list in the frontmatter too — a writer that spans modules and
  // says so should not be read as owning a module literally named "api, web".
  if (frontmatter) for (const n of frontmatter.split(/[,;]/)) {
    const t = n.trim();
    if (t) names.add(t);
  }
  return [...names];
}

// The EXACT specs this scope may read, resolved by the driver.
//
// The whole context argument rests on the implementer confining itself to one
// feature folder, and until now that was prose in an agent file. The driver
// knows the feature, and the feature's anchors name their modules — which ARE
// the module-tier paths — so it can hand over resolved paths instead of routing
// rules to follow. Deviations then show up in the transcript.
async function scopeReadList(cwd, scope) {
  const slugs = [...new Set((scope.plan || []).map(featureSlugOf).filter(Boolean))];
  if (slugs.length !== 1) return '';
  const slug = slugs[0];
  const files = [];
  for (const name of Object.values(FEATURE_FILES)) {
    const rel = featureFile(slug, name);
    if (await pathExists(cwd, rel)) files.push(rel);
  }
  if (!files.length) return '';

  // Every module tier this feature touches, in a stable order so the same tree
  // always produces the same prompt (the memo digest depends on it).
  const tiers = [];
  for (const module of (await featureModules(cwd, slug)).sort()) {
    const rel = `gspec/architecture/${module}.md`;
    if (await pathExists(cwd, rel)) tiers.push(rel);
  }
  const extra = ['gspec/architecture.md', ...tiers, 'gspec/practices.md'];

  return [
    'Your specs for this scope are exactly these — do not read other specs:',
    ...files.map((f) => `  ${f}`),
    ...extra.map((f) => `  ${f}`),
    `(${featureFile(slug, FEATURE_FILES.prd)} is there for the capability checkboxes you flip, not for context — the enriched siblings already carry what you need.)`,
  ].join('\n');
}

// --- the declare → resolve → elaborate barrier -----------------------------
//
// Sharing between features used to be a WRITE-TIME problem: every architect was
// told to grep its siblings and amend on a hit. It could not work — sibling
// folders are being written while you read them, so what you see depends on when
// you ran. A measured build had five features mint five differently-named
// definitions of one rule, the fifth with full sight of the other four.
//
// So the judgment moves to a barrier, and — this is the whole cost argument — it
// moves EARLY, to a point where each feature has emitted only its anchor list.
// Merging five one-line intents is the same decision as merging five full
// definitions over ~14x less text, with nothing written twice and every delta
// still authored by the feature that needs it.

// Every feature's declaration skeleton, path → text.
async function declarationFiles(cwd) {
  const out = {};
  for (const slug of await listFeatureSlugs(cwd)) {
    const rel = featureFile(slug, FEATURE_FILES.arch);
    if (await pathExists(cwd, rel)) out[rel] = await readOr(cwd, rel);
  }
  return out;
}

// Anchor slug → the module-tier path that defines it. Derived by READING the
// spine files rather than by parsing an agent's answer: the writer's natural
// output is the file, so making the file the source of truth removes a JSON
// contract that could be malformed in a way nothing downstream would notice.
async function promotedAnchors(cwd) {
  const out = new Map();
  for (const m of parseModulesTable(await readOr(cwd, 'gspec/architecture.md'))) {
    const rel = `gspec/architecture/${m.name}.md`;
    if (!(await pathExists(cwd, rel))) continue;
    for (const [anchor, kind] of originAnchors(await readOr(cwd, rel))) {
      if (kind === 'origin') out.set(slugifyAnchor(anchor), { module: m.name, rel, anchor });
    }
  }
  return out;
}

// One slug declared under two different modules. Not an anchor problem: two
// deployables need one concept and no module owns it, which is a finding about
// the Modules TABLE — a missing shared package, or a missing dependency edge.
// Reported, never silently repaired, because adding a row changes verify.sh and
// the build/test commands mid-run.
function crossModuleCollisions(files) {
  const bySlug = new Map();
  for (const [rel, text] of Object.entries(files)) {
    const mods = anchorModules(text);
    for (const [anchor, kind] of originAnchors(text)) {
      if (kind !== 'origin') continue;
      const module = mods.get(anchor);
      if (!module) continue;
      const slug = slugifyAnchor(anchor);
      if (!bySlug.has(slug)) bySlug.set(slug, new Map());
      bySlug.get(slug).set(module, rel);
    }
  }
  return [...bySlug.entries()]
    .filter(([, byModule]) => byModule.size > 1)
    .map(([slug, byModule]) => ({ slug, modules: [...byModule.keys()], sites: [...byModule.values()] }));
}

// What resolve hands each module's architecture-writer: the declarations tagged
// to that module, plus the duplicate clusters already computed for it.
function resolveBrief(module, files, dupes, contained) {
  const lines = [];
  for (const [rel, text] of Object.entries(files)) {
    const mods = anchorModules(text);
    const mine = originAnchors(text)
      .filter(([anchor, kind]) => kind === 'origin' && mods.get(anchor) === module)
      .map(([anchor]) => anchor);
    if (mine.length) lines.push(`  ${rel}\n${mine.map((a) => `    ${a}`).join('\n')}`);
  }
  const out = [`Declarations tagged module "${module}":`, lines.join('\n') || '  (none)'];
  if (dupes.length) {
    out.push('', 'Declared by more than one feature under the same slug — these are the same anchor already:');
    for (const d of dupes) out.push(`  ${d.slug}: ${d.sites.map((s) => `${s.anchor} (${s.rel})`).join(' · ')}`);
  }
  if (contained.length) {
    out.push('', 'One name contains another whole, which is what "I prefixed it with my feature name instead of amending" looks like:');
    for (const c of contained) out.push(`  ${c.anchor} (${c.rel}) contains ${c.contains.anchor} (${c.contains.rel})`);
  }
  return out.join('\n');
}

function resolvePrompt(module, rel, brief) {
  return [
    `Resolve the shared architecture for module "${module}" and update ${rel} (use this exact path).`,
    'Every feature has declared its anchor list — headings and a one-line intent, no prose yet. Your job is to decide which of those anchors are ONE concept shared by several features, and to write each of those exactly once, here, as the module spine.',
    '',
    brief,
    '',
    'Rules:',
    '- PROMOTE an anchor to this file when two or more features declared the same concept — whether or not they spelled it the same way. Write the full definition, with `- **module:** ' + module + '` and `- **defined-in:** ' + rel + '`.',
    '- LEAVE LOCAL anything only one feature declared. The periphery belongs to the feature that invented it; measured on real builds that is 85-95% of anchors, so promoting freely is the failure mode here, not promoting sparingly.',
    '- BIAS HARD AGAINST MERGING. Declaring two distinct concepts identical is destructive and silent — a feature is forced onto a definition that does not mean what it needed. Missing a synonym only leaves two local anchors, which is where the build already was. When you cannot write ONE coherent definition covering every declaration in a cluster, that is the signal the cluster is wrong: split it and leave them local.',
    '- A REGISTRY IS NOT A SHARED CONCEPT. Several features contributing disjoint entries to one file (a constants table, an event union) is accretion, not sharing. Define the registry\'s SHAPE here — its file, its invariants, how an entry is added — and let each feature keep its own entries local, so no feature reads another\'s slice.',
    '- Keep this file identity-free: it is a guarded spec, so no product name, no brand, no domain nouns that only this product uses.',
    '- Do not delete or rewrite any feature\'s declaration. You are deciding where an anchor LIVES; the features write their own deltas afterwards.',
  ].join('\n');
}

// The resolve barrier: one architecture-writer run per module, then a derived
// assignment for every declared anchor.
async function runArchResolveStage(stage, ctx) {
  const files = await declarationFiles(ctx.cwd);
  if (!Object.keys(files).length) return { status: 'skipped', reason: 'no declarations to resolve' };

  const modules = parseModulesTable(await readOr(ctx.cwd, 'gspec/architecture.md'));
  if (!modules.length) return { status: 'skipped', reason: 'no modules declared in the architecture' };

  if (ctx.dryRun) {
    log(chalk.dim(`      would resolve shared anchors across ${countNoun(Object.keys(files).length, 'declaration')} for ${countNoun(modules.length, 'module')}`));
    return { status: 'done', verdict: 'PASS' };
  }

  const dupes = duplicateOrigins(files);
  const contained = containedAnchors(files);
  const crossModule = crossModuleCollisions(files);
  log(chalk.dim(`      ${countNoun(Object.keys(files).length, 'declaration')} · ${dupes.length} duplicate slug(s) · ${contained.length} contained name(s)`));
  for (const c of crossModule) {
    // Loud, and not repaired. See crossModuleCollisions.
    log(chalk.yellow(`      "${c.slug}" is declared under ${c.modules.join(' and ')} — no module owns it. The Modules table needs a shared row or an explicit dependency; resolve will not copy it into both.`));
  }

  for (const m of modules) {
    const rel = `gspec/architecture/${m.name}.md`;
    const brief = resolveBrief(m.name, files, dupes.filter((d) => d.sites.length > 1), contained);
    const out = await runWriterResilient(
      stage.writer,
      stageBrief(stage, ctx.brief, resolvePrompt(m.name, rel, brief)),
      ctx, {},
      () => pathExists(ctx.cwd, rel),
    );
    if (out.failure) return { status: 'failed', reason: `module "${m.name}": ${out.failure}` };
    await reportSize(ctx, rel);
  }

  // Derive the assignment from what is now on disk. Anything the writer promoted
  // is in a spine file; everything else stays where it was declared.
  const promoted = await promotedAnchors(ctx.cwd);
  const assignments = {};
  for (const [rel, text] of Object.entries(files)) {
    const slug = featureSlugOfArch(rel);
    if (!slug) continue;
    assignments[slug] = originAnchors(text)
      .filter(([, kind]) => kind === 'origin')
      .map(([anchor]) => {
        const hit = promoted.get(slugifyAnchor(anchor));
        return hit
          ? { anchor, slug: slugifyAnchor(anchor), home: hit.rel, upstreamAnchor: hit.anchor }
          : { anchor, slug: slugifyAnchor(anchor), home: 'local' };
      });
  }

  // `promoted` is what THIS STAGE moved up — a feature origin that now resolves
  // to a spine anchor. `spineAnchors` is everything standing in the module tier,
  // most of which the architecture-writer minted before any feature declared
  // (it is told to: "the module tier owns the spine"). Keeping both under the
  // name "promoted" made this file contradict its own log line — it read
  // `promoted: [13 items]` on a run whose barrier promoted zero, and this file
  // is the cheapest read in the run precisely because people trust it.
  const promotedSlugs = [...new Set(Object.values(assignments).flat().filter((a) => a.home !== 'local').map((a) => a.slug))];
  await writeFile(join(ctx.cwd, RESOLUTION_PATH),
    `${JSON.stringify({ modules: modules.map((m) => m.name), promoted: promotedSlugs, spineAnchors: [...promoted.keys()], crossModule, assignments }, null, 2)}\n`, 'utf-8');

  log(chalk.dim(`      ${countNoun(promotedSlugs.length, 'anchor')} promoted to the module tier; the rest stay local`));
  return { status: 'done', verdict: 'PASS' };
}

const featureSlugOfArch = (rel) =>
  String(rel).replace(/\\/g, '/').match(/^gspec\/features\/([^/]+)\/arch\.md$/)?.[1] ?? null;

// The assignment lines an elaborate-pass prompt carries for one feature.
async function assignmentNote(cwd, slug) {
  let data;
  try { data = JSON.parse(await readFile(join(cwd, RESOLUTION_PATH), 'utf-8')); }
  catch { return ''; }
  const mine = data.assignments?.[slug] || [];
  const promoted = mine.filter((a) => a.home !== 'local');
  if (!promoted.length) return '';
  return [
    'The resolve step merged these declarations of yours into the module tier. For each one, keep the heading and write either a `uses:` stub (you need it exactly as defined) or an `amends:` delta (you need a stated difference):',
    ...promoted.map((a) => `  ${a.anchor} → ${a.home}${a.upstreamAnchor && a.upstreamAnchor !== a.anchor ? ` (as ${a.upstreamAnchor})` : ''}`),
    'If a merge is WRONG — the upstream anchor does not mean what your feature needed — say so in your summary and write your own local definition with a one-line reason. A bad merge is recoverable here and nowhere later.',
  ].join('\n');
}

// --- the deterministic lint each per-feature stage runs before its validator --
const readOr = async (cwd, rel, fallback = '') => {
  try { return await readFile(join(cwd, rel), 'utf-8'); } catch { return fallback; }
};

// The elaborate pass's floor. Single-file, deliberately.
//
// It used to pass every sibling arch.md as `others`, so a duplicate origin came
// back as a BLOCKING finding. That is now wrong twice over. Resolve has already
// adjudicated every declared anchor with all N in view; a duplicate surviving to
// here means resolve judged the two concepts distinct and left them local, and
// failing the stage overrules that decision with a strictly dumber check. And
// the lint gate fails on the first REPEATED finding, so a writer that correctly
// declines the edit — `Exercise Grading` really is not `Grading` — kills the
// build. The repo's own precedent: a false positive in a blocking deterministic
// check is worse than not checking at all.
//
// The check itself is not lost. It runs over all N files at once, after the
// fan-out, as a work list — see reportArchResidue.
async function lintFeatureArch(cwd, slug) {
  const rel = featureFile(slug, FEATURE_FILES.arch);
  return archLintViolations(rel, await readOr(cwd, rel));
}

// The residue backstop: duplicate origins that survived resolve. Reported, never
// failed — expected empty, and informative rather than actionable when it is not.
async function reportArchResidue(ctx) {
  const files = await declarationFiles(ctx.cwd);
  const dupes = duplicateOrigins(files);
  if (!dupes.length) return;
  log(chalk.dim(`      residue: ${countNoun(dupes.length, 'anchor')} still defined in more than one feature after resolve`));
  for (const d of dupes) {
    log(chalk.dim(`        · ${d.slug} — ${d.sites.map((s) => s.rel).join(', ')}`));
  }
}

// The declare pass's floor: everything archLintViolations can decide from ONE
// file — anchor grammar, section shape, in-file uniqueness — and deliberately
// nothing cross-file.
//
// Two features declaring the same anchor is not a finding here; it is the work
// list resolve consumes. Routing it back to a writer as a violation would be
// asking each of them to solve, blind and in parallel, the exact problem the
// barrier exists to solve once with everything in view — and the lint gate fails
// a stage on the first REPEATED finding, so a writer that correctly declines the
// edit kills the build.
//
// Catching grammar here is the cheap half of the trade: the same violation costs
// a ~300-word redo now and a ~3,000-word rewrite after elaborate.
async function lintFeatureArchDeclare(cwd, slug) {
  const rel = featureFile(slug, FEATURE_FILES.arch);
  const text = await readOr(cwd, rel);
  const v = archLintViolations(rel, text);
  if (!DECLARED_MARKER.test(text)) {
    v.push(`${rel}: the frontmatter must carry "stage: declared" — it is what marks this a declaration rather than a finished architecture, and what stops the elaborate pass from mistaking a skeleton for a delivered spec`);
  }
  const mods = anchorModules(text);
  for (const [anchor] of originAnchors(text)) {
    if (!mods.get(anchor)) {
      v.push(`${rel}: "${anchor}" has no "- **module:** <name>" line — the anchor carries the module, not the feature, and an untagged anchor gets no module tier handed to its implementer`);
    }
  }
  return v;
}

async function lintFeatureDesign(cwd, slug) {
  const rel = featureFile(slug, FEATURE_FILES.design);
  const html = await readOr(cwd, rel);
  return [
    ...designLintViolations(rel, html, await readOr(cwd, featureFile(slug, FEATURE_FILES.arch))),
    // A design carrying its own literal colors is a second copy of decisions the
    // style guide owns. The floor was written for style.html and extending it
    // here was specified when feature folders landed, then never shipped.
    ...(appliesToTokenLiterals(rel) ? tokenLiteralViolations(html, rel) : []),
  ];
}

async function lintFeaturePlan(cwd, slug) {
  const rel = featureFile(slug, FEATURE_FILES.tasks);
  const tasks = await readOr(cwd, rel);
  return [
    ...planLintViolations(rel, tasks, await readOr(cwd, featureFile(slug, FEATURE_FILES.arch))),
    // Both are arithmetic the plan validator was doing by hand, and badly: one
    // run raised unsafe [P] markers five times across four revision rounds, and
    // a non-verbatim covers: quote again — each round a validator run plus a
    // writer run, for properties a regex settles.
    ...parallelismViolations(rel, tasks),
    ...coversViolations(rel, tasks, await readOr(cwd, featureFile(slug, FEATURE_FILES.prd))),
  ];
}

// Does this feature have UI worth designing? A CONTENT question: arch.md
// declares a `## UI` section, and marks it Not Applicable when the feature is
// headless. Asking the file whether the section applies reuses the Not
// Applicable convention every spec already follows, instead of inventing a flag.
async function hasApplicableUiSection(cwd, slug) {
  let text;
  try { text = await readFile(join(cwd, featureFile(slug, FEATURE_FILES.arch)), 'utf-8'); }
  catch { return false; }
  const m = text.match(/^##\s+UI\b[^\n]*\n([\s\S]*?)(?=^##\s|\Z)/m);
  if (!m) return false;
  return !/not\s+applicable/i.test(m[1].slice(0, 400));
}

// The three per-feature writer prompts. Each names the EXACT path to write —
// a fan-out writer left to choose produces gspec/features/Auth/Data.md — and
// tells the writer what it may assume its reader already has.
// Pass 1. The anchor list only — no prose, no definitions. ~300 words instead of
// ~3,000, which is what makes the barrier's judgment affordable and what lets
// the anchor grammar be checked before anyone writes a paragraph.
async function featureArchDeclarePrompt(ctx, slug, rel) {
  return [
    `DECLARE the architecture anchors for "${slug}" in ${rel} (use this exact path). This is a skeleton, not the architecture — you will write the real thing in a later pass.`,
    `Its PRD is ${await prdPath(ctx.cwd, slug)}. Read gspec/architecture.md for module boundaries and the Modules table, gspec/stack.md for the technologies, and ${await moduleTierList(ctx.cwd, slug)} for the module spine.`,
    'Frontmatter: spec-version, feature, module (every module this feature touches), and `stage: declared` — that last key is required and marks the file a declaration.',
    'Cover ## Data, ## API, ## UI, and ## Logic — every one of the four present, each either listing its anchors or marked **Not Applicable** with a reason.',
    `For each anchor write ONLY: the H3 heading in the exact grammar, \`- **module:** <name>\` (which module owns the thing it names), one of \`- **defined-in:** ${rel}\` (this feature invents it) / \`- **uses:** <module tier path>\` / \`- **amends:** <module tier path>\`, and \`- **intent:** <one line>\`. No prose, no fields, no rationale — the intent line is one sentence saying what the anchor is for.`,
    'Check the module spine FIRST for every item: if it already defines the concept, declare `uses:` or `amends:` rather than inventing your own name for it.',
    'Do NOT read another feature\'s arch.md. Two features declaring the same concept is expected and is merged later; guessing at what a sibling might have called something is what this pass exists to stop.',
  ].join('\n');
}

// Pass 2. Fill the skeleton in, now that every anchor has one known home.
async function featureArchPrompt(ctx, slug, rel) {
  const assignment = await assignmentNote(ctx.cwd, slug);
  return [
    `Write the feature architecture for "${slug}" to ${rel} (use this exact path), filling in the anchors already declared there. Keep every heading; remove the \`stage: declared\` frontmatter key.`,
    `Its PRD is ${await prdPath(ctx.cwd, slug)}. Read gspec/architecture.md for module boundaries and placement rules, gspec/stack.md for the technologies, and ${await moduleTierList(ctx.cwd, slug)} for the module spine.`,
    ...(assignment ? ['', assignment, ''] : []),
    'Cover ## Data, ## API, ## UI, and ## Logic — every one of the four present, each either specified or marked **Not Applicable** with a reason. One H3 anchor per item, in the exact grammar from gspec-conventions.',
    // The grep instruction this replaces asked writers to deconflict against
    // sibling folders that were being written at the same time. They could not:
    // the fifth writer in a five-feature run had sight of four predecessors and
    // still minted a fifth name for one rule. Read UP, where the answer holds
    // still, and let the resolve step merge whatever duplicated locally.
    'READ UP, NEVER SIDEWAYS: check the module tier for each item before you write it — uses: it if the spine already defines it and you change nothing, amends: it if you need a stated difference, defined-in: only when nothing upstream defines it. Do NOT read another feature\'s arch.md for any reason; two features inventing the same anchor is expected and is resolved later.',
    'ENRICH: an implementer reading only this feature folder must not need the architecture, the stack, or the style guide. Inline the concrete technology names and decisions rather than citing where they live.',
  ].join('\n');
}

// The module-tier paths to name in a per-feature prompt. Resolved from what the
// feature already declares when it has an arch.md (a re-run, or the elaborate
// pass after declare), and from the Modules table otherwise — a first draft has
// no anchors yet, so the writer is pointed at every tier and picks.
async function moduleTierList(cwd, slug) {
  const declared = await featureModules(cwd, slug);
  const names = declared.length
    ? declared
    : parseModulesTable(await readOr(cwd, 'gspec/architecture.md')).map((m) => m.name);
  const paths = [];
  for (const n of names.sort()) {
    const rel = `gspec/architecture/${n}.md`;
    if (await pathExists(cwd, rel)) paths.push(rel);
  }
  return paths.length ? paths.join(', ') : 'the module tier';
}

async function featureDesignPrompt(ctx, slug, rel) {
  return [
    `Write the feature design for "${slug}" to ${rel} (use this exact path) — a self-contained, renderable HTML mockup.`,
    `Its architecture is ${featureFile(slug, FEATURE_FILES.arch)} and its PRD is ${await prdPath(ctx.cwd, slug)}.`,
    'One `<section id="screen-<kebab>">` per `### Screen:` in the architecture\'s ## UI section, matching by slugified name in both directions.',
    'Copy the style guide\'s token block in verbatim (it is the only place a literal color may appear) and style everything else with var(--…). Define no new tokens.',
  ].join('\n');
}

async function featurePlanPrompt(ctx, slug, rel) {
  return [
    `Decompose the feature "${slug}" into an ordered plan and write it to ${rel} (use this exact path).`,
    `Its PRD is ${await prdPath(ctx.cwd, slug)} and its architecture is ${featureFile(slug, FEATURE_FILES.arch)}.`,
    'Every task carries deps:, a verbatim covers: quote from the PRD, and an arch: list naming the architecture anchors it touches (so an implementer loads only those).',
    'Preserve every checked task verbatim; append new ones with the next free ID.',
  ].join('\n');
}

// The per-feature fan-out shared by feature-arch, feature-design, and plan.
//
// Each of the three writes exactly ONE file per feature into that feature's
// folder, so "did it deliver?" is just "does the file exist and parse" — no
// multi-file manifest, and the existing hashFile/memoize primitives work
// unchanged. What the three differ in is only their stage entry: which file,
// which agents, whether the feature needs the stage at all, and how fast they
// may fan out.
//
// Two records per feature, both content-addressed:
//   written[slug]  the digest after the writer returned
//   passed[slug]   the digest after QA passed
// On a re-run: no `written` record means the writer died mid-fan-out and
// whatever is on disk is a torso — regenerate. A record whose digest still
// matches means skip regeneration but re-validate; a digest that CHANGED means a
// hand-edit during the pause, which is honored the same way (skip, re-validate).
// That is gate()'s `revalidate` semantics, per feature, falling out of the hash
// rather than needing a flag.
async function runFeaturePlanStage(stage, ctx, { rerunning } = {}) {
  const slugs = await listFeatureSlugs(ctx.cwd);
  if (!slugs.length) return { status: 'skipped', reason: 'no features to plan' };

  // A stage may not apply to every feature (a headless feature has no design).
  const targets = [];
  for (const slug of slugs) {
    if (stage.appliesWhen && !(await stage.appliesWhen(ctx.cwd, slug))) continue;
    targets.push(slug);
  }
  if (!targets.length) return { status: 'skipped', reason: `no feature needs ${stage.title.toLowerCase()}` };

  if (ctx.dryRun) {
    log(chalk.dim(`      would write ${stage.file} for ${countNoun(targets.length, 'feature')} and gate each`));
    return { status: 'done', verdict: 'PASS' };
  }

  const st = ctx.stageRecord(stage.id);
  st.written ||= {};
  const wellFormed = stage.wellFormed || looksComplete;

  // How far along a many-feature stage is. Without this a fan-out is a single
  // "▸ Feature PRDs" followed by nothing for half an hour, which is precisely
  // the state a stalled run also produces — the log cannot distinguish them, so
  // the only way to tell was to go read the driver's child processes by hand.
  //
  // The write phase runs CONCURRENTLY, so this counts completions, not starts:
  // an ordinal assigned on entry would print out of order and imply a sequence
  // that isn't there.
  const total = targets.length;
  let completed = 0;
  const progressTag = () => (total > 1 ? `[${++completed}/${total}] ` : '');

  // --- write phase ---
  const runs = await mapLimit(targets, stage.concurrency ?? FEATURE_WRITER_CONCURRENCY, async (slug) => {
    const rel = featureFile(slug, stage.file);
    // An existing, well-formed file is never regenerated — whoever wrote it.
    //
    // Two cases, and both must be preserved. A file WE wrote (there is a
    // `written` record) means a resume should re-validate rather than re-spend
    // the tokens. A file with NO record was hand-authored or arrived through a
    // migration — clobbering that is data loss, and for tasks.md it would
    // discard the checked-task history the whole immutability contract exists to
    // protect. The old plan stage skipped on mere existence for this reason; the
    // bug was that it also skipped VALIDATION, which the loop below now always
    // runs. Regeneration happens only when the file is missing or malformed.
    if (await wellFormed(ctx.cwd, rel)) {
      const mine = Boolean(st.written[slug]);
      log(chalk.dim(`      ${progressTag()}✓ ${rel} — ${mine ? 'already written' : 'already present (not written by this run)'}; skipping regeneration (QA still checks it below)`));
      return { code: 0, skipped: true };
    }
    await mkdir(join(ctx.cwd, featureDir(slug)), { recursive: true });
    const out = await runWriterResilient(
      stage.writer,
      await stage.prompt(ctx, slug, rel),
      ctx, {},
      () => wellFormed(ctx.cwd, rel),
    );
    if (!out.failure) {
      st.written[slug] = await hashFile(ctx.cwd, rel);
      await ctx.saveManifest();
    }
    await reportSize(ctx, rel, progressTag()); // advisory (§1)
    return out;
  });
  const bad = runs.findIndex((r) => r.failure);
  if (bad >= 0) return { status: 'failed', reason: `feature "${targets[bad]}": ${runs[bad].failure}` };

  // A cross-file observation the per-feature lint deliberately cannot make.
  // Advisory by contract: it runs once the whole fan-out exists, and it reports
  // rather than fails, because the properties worth checking here (does an
  // anchor still have two definitions?) are ones a barrier already adjudicated.
  if (stage.report) await stage.report(ctx);

  if (ctx.noQa || !stage.validator) return { status: 'done', verdict: ctx.noQa ? 'skipped' : 'PASS' };

  // --- validate phase ---
  // Serial, unlike the write phase, and until now entirely silent per feature:
  // eight features each taking a lint pass, a validator run and possibly a
  // revision, with nothing logged between the stage's ▸ and its ✓. Announce the
  // target BEFORE working on it — on a stage that stops making progress, the
  // last line printed is then the feature it stopped on, which is the question
  // anyone reading the log is actually asking.
  let advisory = 0;
  let checked = 0;
  for (const slug of targets) {
    const target = featureFile(slug, stage.file);
    const tag = targets.length > 1 ? `[${++checked}/${targets.length}] ` : '';
    if (await ctx.isMemoized(stage.id, slug, target)) {
      log(chalk.dim(`      ${tag}✓ ${target} — unchanged since it passed; skipping re-validation`));
      continue;
    }
    log(chalk.dim(`      ${tag}${target} — checking…`));
    // Deterministic lint FIRST — see lintUntilClean.
    if (stage.lint) {
      const failed = await lintUntilClean(stage, target, ctx, {
        lint: () => stage.lint(ctx.cwd, slug),
        outputsOk: () => wellFormed(ctx.cwd, target),
        extraGuidance: ANCHOR_RENAME_GUIDANCE,
      });
      if (failed) return failed;
    }
    const r = await reviseUntilPass(stage, target, ctx, {
      validatorTarget: target,
      outputsOk: () => wellFormed(ctx.cwd, target),
      measure: () => reportSize(ctx, target),
      sizeNote: await reportSize(ctx, target),
      writerPrompt: (verdicts, note) => reviseBrief(ctx, stage, target, verdicts, note),
    });
    if (r.status === 'failed') return r;
    if (r.advisory) advisory++;
    await ctx.memoize(stage.id, slug, target);
  }
  return { status: 'done', verdict: advisory ? `PASS (${advisory} with advisory notes)` : 'PASS' };
}

// Capacity exhaustion, told apart from a transient fault.
//
// Both surface as a non-zero exit, but they want opposite responses: a dropped
// connection is worth retrying immediately, while a usage limit resets on a
// CLOCK — retrying just spends another run hitting the same wall, which is
// exactly what a measured run did (four implementer runs where two would have
// done). Match on what the engines actually say.
const LIMIT_RE = /\b(session limit|usage limit|rate limit|quota|resets? (at|in) |too many requests|429)\b/i;
export function looksRateLimited(text) {
  return LIMIT_RE.test(String(text || ''));
}

// "exited 1" is not a diagnosis. Carry whatever the engine said into the reason
// so a transient overload reads differently from a broken prompt — the same fix
// runWriterResilient got, applied to the paths that build their own reason.
function agentFailure(agentName, out, what = '') {
  const said = tail(String(out?.text || '').trim(), 400);
  const where = what ? ` (${what})` : '';
  if (looksRateLimited(said)) {
    return `${agentName}${where} stopped — the engine is out of capacity, not broken: ${said} Nothing is wrong with the specs or the code; wait for the reset, then \`gspec build --resume\` continues from exactly here.`;
  }
  return said
    ? `${agentName}${where} exited ${out.code} — it said: ${said}`
    : `${agentName}${where} exited ${out.code} with no output (often a transient engine error; --resume retries from here)`;
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

// The plan files of a scope, read: [{ rel, text }] for the ones that exist.
async function readPlans(cwd, files) {
  const out = [];
  for (const rel of files) {
    const text = await readOr(cwd, rel, null);
    if (text !== null) out.push({ rel, text });
  }
  return out;
}

// The prompt for a scope's FIRST run.
//
// Usually the base prompt as built by the caller. On a large plan — more than
// TASK_GROUP_THRESHOLD unchecked tasks — whose scope covers the whole feature,
// the run is also told to implement only the first dependency group and
// stop, so the initial run starts small too and the continuation loop (which
// briefs on remaining tasks) carries the rest. Guarded off for a scaffold
// scope and for any scope whose instruction already names task ids: the
// orchestrator has decided the granularity there, and a second cut would
// contradict it.
export function firstRunPrompt(basePrompt, scope, plans = [], { scaffold = false } = {}) {
  if (scaffold || plans.length !== 1) return basePrompt;
  if (/\bT\d+\b/.test(String(scope.instruction || ''))) return basePrompt;
  const group = firstRunGroupBrief(plans[0].rel, plans[0].text);
  return group ? `${basePrompt}\n\n${group}` : basePrompt;
}

// The prompt for a CONTINUATION run: the scope instruction, the remaining
// tasks with the sections and module files they cite, and the standing rule
// about completed work. Falls back to the old whole-brief continuation when
// the plan yields nothing to say (no unchecked task located — the caller
// would have skipped the run — or a plan file that could not be read).
export function continuationPrompt(stage, brief, scope, briefs, basePrompt) {
  const remaining = formatRemainingBrief(briefs);
  if (!remaining) {
    return `${basePrompt}\n\nA prior implementer run on this scope stopped before finishing (likely a context limit). Continue the REMAINING unchecked tasks only; never redo, uncheck, or renumber completed tasks.`;
  }
  return stageBrief(stage, brief, [
    `Continue ONLY this scope (one isolated implementer run): ${scope.instruction}`,
    'A prior implementer run on this scope stopped before finishing (likely a context limit). Continue the REMAINING unchecked tasks only; never redo, uncheck, or renumber completed tasks.',
    remaining,
    'Keep verify.sh current; write and run tests; flip checkboxes for the work you complete.',
  ].join('\n'));
}

// Run one implementer scope to completion across FRESH agents. Each run is an
// isolated subprocess with a new context window; the plan checkboxes are the
// state shared between them. While boxes keep flipping we spawn the next agent to
// resume from the reduced unchecked set — so a run that exhausts a small context
// window mid-scope is transparently continued rather than lost. We stop when none
// remain, after MAX_STALLS no-progress runs (stuck, not out of room), or at
// MAX_SCOPE_RUNS. Returns the last { code, text } so the caller's gates apply as
// before. A scope with no trackable plan file (e.g. scaffold) runs exactly once.
async function runImplementScope(stage, scope, basePrompt, ctx, { scaffold = false } = {}) {
  const files = scope.plan || [];
  // What a run is told to read is what it reads. The first run gets the
  // whole scope brief (and, on a large plan, a task group — see
  // firstRunPrompt); a continuation gets only its remaining tasks and the
  // spec sections they cite (continuationPrompt). Every continuation used to
  // re-send the whole-feature brief even when one task remained, and input is
  // transcript × turns.
  const baseWords = countSpecWords(basePrompt);
  // `partial` is the "Partial work found" block a transient retry carries
  // (lib/partial-work.js): what the interrupted run wrote but never recorded.
  const promptFor = async (run, partial = '') => {
    let p;
    if (run === 1) p = firstRunPrompt(basePrompt, scope, await readPlans(ctx.cwd, files), { scaffold });
    else {
      const briefs = await remainingTaskBrief(ctx.cwd, files);
      p = continuationPrompt(stage, ctx.brief, scope, briefs, basePrompt);
      const words = countSpecWords(p);
      log(chalk.dim(`      "${scope.label}": continuation brief — ${words} words (full scope brief: ${baseWords})${words >= baseWords ? ' — no shrink: nothing in the plan located the remaining work' : ''}`));
    }
    return partial ? `${p}\n\n${partial}` : p;
  };

  if (!files.length) return runAgent(stage.agent, await promptFor(1), ctx, { allowedTools: 'Bash' });

  let out, stalls = 0, errorRetries = 0;
  let remaining = await countUnchecked(ctx.cwd, files);

  // Nothing left to do. This is only ever reachable on a RESUME — a fresh build
  // has every box open — and it is the single most expensive no-op in the
  // system: the implementer is ~95% of a run's input tokens, and a resume after
  // a late failure paid one full run per already-finished feature just to be
  // told so. The gates below still run, so nothing goes unchecked; we skip the
  // agent, not the verification.
  if (!remaining) {
    log(chalk.dim(`      "${scope.label}": every task already checked — skipping the implementer (the gates still run).`));
    return { code: 0, text: '' };
  }

  let retrying = false;                             // the run about to start re-sends a brief an engine error interrupted
  let partial = '';                                 // …and this is what that interrupted run left on disk
  for (let run = 1; run <= MAX_SCOPE_RUNS; run++) {
    // Name how this run is spent and whether it moved the build, so the report
    // can show the waste bucket instead of leaving it to be inferred from log
    // lines (lib/usage.js). `after` is read once, inside the progress predicate.
    const kind = retrying ? 'transient-retry' : run === 1 ? 'initial' : 'continuation';
    const prompt = await promptFor(run, partial);
    retrying = false; partial = '';
    const before = remaining;
    let after;
    out = await runAgent(stage.agent, prompt, ctx, {
      allowedTools: 'Bash',
      kind,
      progress: async () => { after = await countUnchecked(ctx.cwd, files); return after < before; },
    });
    after ??= await countUnchecked(ctx.cwd, files);
    if (after === 0) return out;                    // scope complete
    if (after < remaining) {                        // progress → a fresh agent continues
      stalls = 0; remaining = after;
      if (run < MAX_SCOPE_RUNS) log(chalk.dim(`      "${scope.label}": ${after} task(s) left — continuing on a fresh agent…`));
      continue;
    }
    if (out.code !== 0) {
      // A non-zero exit is not automatically the end. Implement runs are the
      // longest in the build — one observed at 72 turns and 4.4M tokens — which
      // is exactly the shape that meets a dropped connection, and a scope that
      // died mid-stream had usually written real code first. Writers already get
      // one retry for this; the implementer got none, so a single transient
      // error ended a stage that was working. Retry ONCE, then surface it.
      // A limit resets on a clock; a retry now only spends another run on the
      // same wall. Surface it immediately so the pause says WAIT, not "broken".
      if (looksRateLimited(out.text)) return out;
      if (errorRetries < MAX_TRANSIENT_RETRIES) {
        // Wait before retrying, and wait LONGER each time. An immediate retry
        // walks straight back into a server-side condition — observed with a 529
        // Overloaded — and a single fixed 30s wait is not enough either: a
        // measured run lost the build to "Connection closed mid-response" on
        // both the first attempt and its retry 30s later. The outage was simply
        // wider than the one pause. Escalating costs at most a few idle minutes;
        // the alternative is ending an autonomous build that had nothing wrong
        // with it and requiring a human to type --resume.
        const wait = transientBackoffMs(errorRetries);
        errorRetries += 1;
        log(chalk.dim(`      "${scope.label}": ${stage.agent} exited ${out.code} without checking a task — waiting ${Math.round(wait / 1000)}s, then retrying (${errorRetries}/${MAX_TRANSIENT_RETRIES}; often a transient engine error)…`));
        await sleep(wait);
        // Resume from disk, not from the prompt. A run that died mid-stream
        // had usually written real code first; the retry used to be told
        // nothing about it and often redid the work. Best-effort: any failure
        // to gather evidence means no block, never a failed retry.
        try {
          partial = partialWorkBrief(await partialWorkEvidence(ctx.cwd, files, { gitStatus: (cwd) => gitCapture(cwd, ['status', '--porcelain']) }));
          if (partial) log(chalk.dim(`      "${scope.label}": partial work found on disk — the retry is told to verify and continue it, not recreate it.`));
        } catch { partial = ''; }
        retrying = true;
        continue;
      }
      return out;                                   // still erroring with no progress → surface it
    }
    errorRetries = 0;                               // a clean run resets the allowance
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
      // stack/practices/style may seed from the user's library; profile never does.
      return gate(stage, stageBrief(stage, brief, stage.note ?? '', templateNote(stage, ctx.templates)), '', ctx, { revalidate: !!present && rerunning });
    }
    case 'gated': {
      const present = await outputsPresent(ctx.cwd, stage.outputs);
      // Present, and this run never wrote it: the file is a prior decision to
      // amend, not a draft to replace. (`rerunning` is the other case — our own
      // failed attempt — which revalidates instead, as before.)
      const amending = present && !rerunning;
      if (amending) log(chalk.dim(`      ${stage.outputs[0]} already exists — amending it for the new features rather than rewriting it.`));

      // The baseline the amend floor measures against, captured BEFORE the
      // writer runs and kept on the manifest. On disk is the wrong place to
      // re-derive it on a resume: by then the damaging write has already
      // happened, and the file would be compared against itself.
      const st = ctx.stageRecord(stage.id);
      if (stage.snapshot && st.baseline === undefined) {
        st.baseline = await stage.snapshot(ctx.cwd);
        await ctx.saveManifest();
      }
      const lint = stage.amendLint ? () => stage.amendLint(ctx.cwd, st.baseline ?? []) : null;

      return gate(stage, stageBrief(stage, brief, amending ? (stage.note ?? '') : ''), '', ctx, {
        revalidate: present && rerunning,
        lint,
      });
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
      let researched = 0;
      const runs = await Promise.all(plan.competitors.map(async (c) => {
        const prompt = `You are one research fan-out of an autonomous gspec build; you cannot ask the user questions. Research this one competitor and return the structured teardown: ${c.name}${c.context ? ` (${c.context})` : ''}. Research focus: ${plan.focus || 'core capabilities, UX patterns, strengths and weaknesses'}.`;
        const r = await runAgent(stage.researcher, prompt, ctx, { allowedTools: 'Web' });
        // Counted on completion — these run concurrently (see the fan-out note).
        if (plan.competitors.length > 1) log(chalk.dim(`      [${++researched}/${plan.competitors.length}] ${c.name} — ${r.code === 0 ? 'researched' : `exited ${r.code}`}`));
        return r;
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
      // Exit 0 is not delivery: insist the synthesis actually landed, so an
      // engine that errored cleanly can't leave the next stage reading a file
      // that was never written.
      if (!(await outputsPresent(ctx.cwd, stage.outputs))) {
        return { status: 'failed', reason: `${stage.writer} exited 0 without writing ${stage.outputs.join(' or ')} — the engine reported success but produced nothing` };
      }
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
        // Progress through the fan-out. This stage has its own writing loop
        // rather than the shared per-feature helper, so it needs its own counter
        // — and it is the one that most needs one: a real run spent 29 minutes
        // here emitting nothing between the stage header and its verdict, which
        // is indistinguishable from a stall. Counts completions, not starts,
        // because these run concurrently.
        let written = 0;
        const writeTag = () => (plan.length > 1 ? `[${++written}/${plan.length}] ` : '');
        const runs = await mapLimit(plan, FEATURE_WRITER_CONCURRENCY, async (f) => {
          // Checkpoint the writing fan-out on resume: a sibling PRD already
          // written and well-formed is NOT regenerated when we re-enter this
          // stage after a failure — so one writer dying (e.g. token exhaustion)
          // doesn't re-spend the token cost of every other feature, and a PRD
          // hand-edited during the pause is preserved. Only on a re-run
          // (priorStatus failed/running); a fresh run always writes. The skipped
          // PRD is still re-checked by the validation loop below, so a truncated
          // draft that slips the well-formed check is caught there.
          if (rerunning && await looksCompletePrd(ctx.cwd, f.slug)) {
            log(chalk.dim(`      ${writeTag()}✓ ${f.slug} — PRD already written; skipping regeneration (QA re-checks it below)`));
            return { code: 0, skipped: true };
          }
          const deps = f.dependencies.filter((d) => d !== f.slug);
          // This writer's assignment (not to be confused with ctx.scope, the
          // run's scope TIER, which reaches the writer through the brief).
          const assignment = [
            `Write ONE feature of a decomposed set into ${featureFile(f.slug, FEATURE_FILES.prd)} (use this exact path — create the folder).`,
            `Feature: ${f.title}${f.priority ? ` (${f.priority})` : ''}.`,
            f.brief ? `Scope: ${f.brief}` : '',
            deps.length ? `Depends on these sibling features — cross-link them by slug: ${deps.join(', ')}.` : '',
            researchNote.trim(),
          ].filter(Boolean).join('\n');
          // A post-write crash must not discard a complete PRD (feedback §7): accept
          // a non-zero exit whose PRD file is present and well-formed.
          const out = await runWriterResilient(stage.writer, stageBrief(stage, brief, assignment, templateNote(stage, ctx.templates)), ctx, {}, () => looksCompletePrd(ctx.cwd, f.slug));
          await reportSize(ctx, await prdPath(ctx.cwd, f.slug), writeTag()); // advisory (§1)
          return out;
        });
        const bad = runs.findIndex((r) => r.failure);
        if (bad >= 0) return { status: 'failed', reason: `feature "${plan[bad].slug}": ${runs[bad].failure}` };
      } else {
        // No usable breakdown → one PRD from the whole brief (single-feature idea).
        const w = await runWriterResilient(stage.writer, stageBrief(stage, brief, `Write the feature PRD for this idea into gspec/features/<slug>/prd.md (pick a kebab-case slug; create the folder).${researchNote}`, templateNote(stage, ctx.templates)), ctx, {}, async () => (await listFeatureSlugs(ctx.cwd)).length > 0);
        if (w.failure) return { status: 'failed', reason: w.failure };
      }
      if (ctx.noQa) return { status: 'done', verdict: 'skipped' };
      const slugs = await listFeatureSlugs(ctx.cwd);
      let advisory = 0;
      let checkedPrds = 0;
      for (const prd of slugs) {
        const target = await prdPath(ctx.cwd, prd);
        const prdTag = slugs.length > 1 ? `[${++checkedPrds}/${slugs.length}] ` : '';
        // A PRD unchanged since it last passed QA is not re-gated (feedback §5):
        // the features stage restarts over the whole PRD list on every resume, so
        // without this an already-passing PRD burns a fresh budget each time — and
        // its verdict was observed to be unstable across re-gates.
        if (await ctx.isMemoized('features', prd, target)) {
          log(chalk.dim(`      ${prdTag}✓ ${target} — unchanged since it passed; skipping re-validation`));
          continue;
        }
        log(chalk.dim(`      ${prdTag}${target} — checking…`));
        let v = await runAgent(stage.validator, validatorPrompt(stage, target, '', ctx.scope), ctx);
        let g = grade(stage, v.text, target);
        if (g.verdict === 'FAIL') {
          const verdicts = [v.text];
          let sizeNote = await reportSize(ctx, target);
          for (let r = 1; r <= ctx.qaRetries; r++) {
            await ctx.recordFeedback(stage, stage.validator, v.text, { target, attempt: r });
            log(chalk.yellow(`      QA flagged issues in ${target} — revision ${r}/${ctx.qaRetries}… (${summarize(v.text)})`));
            const addressed = v.text;
            const rev = await runWriterResilient(stage.writer, await reviseBrief(ctx, stage, target, verdicts, sizeNote), ctx, { kind: 'revision' }, () => looksCompletePrd(ctx.cwd, prd));
            if (rev.failure) return { status: 'failed', reason: `${target} (revision ${r}): ${rev.failure}` };
            sizeNote = await reportSize(ctx, target);
            v = await runAgent(stage.validator, validatorPrompt(stage, target, addressed, ctx.scope), ctx);
            g = grade(stage, v.text, target);
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

    // One handler, four stages: feature-arch-declare, feature-arch,
    // feature-design and plan each write ONE file per feature into that
    // feature's folder, then gate it.
    case 'feature-plan':
      return runFeaturePlanStage(stage, ctx, { rerunning });

    // The barrier between the two feature-arch passes.
    case 'arch-resolve':
      return runArchResolveStage(stage, ctx);

    case 'implement': {
      // The monolithic brief — the fallback build, and the self-heal prompt (a
      // full "fix whatever's broken" pass) used by the gates below.
      const buildPrompt = stageBrief(stage, brief, 'Implement all in-scope, unchecked work. Scaffold if greenfield; generate/maintain verify.sh from the architecture Modules table; write and run tests; flip checkboxes as you go.');

      // Orchestrate (design §13 T3): the build-orchestrator turns the specs into
      // an ordered wave plan; the driver runs it, fanning out file-disjoint
      // scopes within a wave. No usable plan → one monolithic implement call.
      let plan = null;
      // An empty plan and an unreadable one both leave `plan` null, and only one
      // of them is a defect. Without this flag the run reported BOTH for the same
      // reply — "reports no remaining work" immediately followed by "its plan was
      // unusable ... this is a parser gap" — and wrote unparsed-plan.md accusing
      // the reader of a bug over the one answer that was completely correct.
      let reportedNoWork = false;
      // The file-overlap evidence (lib/wave-merge.js), shared by the
      // orchestrator's prompt and the driver's merge below.
      let overlapTable = null;
      if (stage.orchestrator) {
        // Hand the orchestrator the evidence so "same wave or not?" is
        // answered from the specs rather than left to doubt — which resolves,
        // correctly but expensively, to serial.
        const overlapFeatures = await featureOverlapEvidence(ctx.cwd);
        overlapTable = disjointnessTable(overlapFeatures);
        const p = await runAgent(stage.orchestrator, stageBrief(stage, brief, [
          'Plan this implementation run: read the in-scope features/plans and return ONLY the ordered wave build-plan JSON.',
          formatOverlapTable(overlapFeatures, overlapTable),
        ].filter(Boolean).join('\n')), ctx);
        plan = p.code === 0 ? parseBuildPlan(p.text) : null;
        if (Array.isArray(plan) && !plan.length) {
          // The orchestrator says there is nothing to do. Trust it as a REPORT,
          // not as an instruction: fall through to per-feature scopes, which
          // cost nothing when it is right (each skips on a zero unchecked count)
          // and still do the work when it is wrong. What changes is only that we
          // stop calling a correct answer a parser gap.
          log(chalk.dim(`      ${stage.orchestrator} reports no remaining work — checking each feature directly.`));
          plan = null;
          reportedNoWork = true;
        }
        // "no wave plan" hid two very different causes: the agent died, or it
        // answered and the driver could not read it. The second is a defect in
        // the READER and was invisible for a whole release — say which.
        //
        // Not in preview, though: there the engine was never called, so the
        // stub answer reads as "the parser could not understand it" and the
        // build reports a reader defect that did not happen — pointing at a
        // file preview deliberately did not write. A pointer at an empty place
        // is the exact failure keeping the reply verbatim was added to end, so
        // do not manufacture one out of an answer nobody gave.
        if (!plan && !reportedNoWork && !ctx.dryRun) {
          if (p.code !== 0) {
            log(chalk.yellow(`      ${stage.orchestrator} exited ${p.code} — no wave plan (${tail(String(p.text || '').trim(), 160) || 'no output'})`));
          } else {
            // Keep the answer. The old message claimed it was "in the run log"
            // and it never was — a pointer at an empty place is worse than no
            // pointer, because it stops the reader looking. Every parser gap
            // found so far was a shape a reasonable model emits, so the raw
            // text IS the fix; write it where the message says it is.
            await writeFile(join(ctx.cwd, UNPARSED_PLAN_PATH), [
              `# ${stage.orchestrator}: an answer the parser could not read`,
              '',
              'This is not an agent failure. The agent replied; the driver could not',
              'turn the reply into a wave plan, so the build fell back to one scope',
              'per feature — correct, just not the ordering the agent proposed.',
              '',
              'Its reply is below verbatim. If it contains a sensible plan in a shape',
              '`parseBuildPlan` does not accept, that is a bug in the reader.',
              '',
              '```',
              String(p.text || '').trim() || '(no output)',
              '```',
              '',
            ].join('\n'), 'utf-8');
            log(chalk.yellow(`      ${stage.orchestrator} answered but its plan was unusable — falling back to one scope per feature. This is a parser gap, not an agent failure; its reply is kept verbatim in ${UNPARSED_PLAN_PATH}.`));
          }
        }
      }

      let out;
      if (plan) {
        // ONE FEATURE PER SCOPE. The orchestrator decides ordering and what may
        // run concurrently; it does not decide how much context an implementer
        // carries. That distinction matters more in v3 than it did before:
        // feature folders are ENRICHED, so a scope spanning three features reads
        // three inlined copies of the stack and style decisions — the opposite of
        // the amortization this layout is for, and worse than the old shared-spec
        // model. Splitting here makes the context bound exact (one folder + one
        // module tier + practices) regardless of what the orchestrator returns.
        plan = await Promise.all(plan.map((wave) => splitScopesByFeature(ctx.cwd, wave)));
        // The conservative merge (--parallel auto): consecutive single-scope
        // waves that are provably file-disjoint and dependency-free become one
        // wave, capped at PARALLEL_CAP. Provable only — anything short stays
        // serial, and --parallel off leaves the plan exactly as emitted.
        {
          const before = plan.length;
          const merged = mergeWaves(plan, overlapTable, { mode: ctx.parallel, slugOf: scopeSlug });
          plan = merged.waves;
          for (const m of merged.merges) log(chalk.dim(`      merged waves ${m.from.map((i) => i + 1).join('+')} into one — provably file-disjoint, no dependency between them: ${m.labels.join(', ')}`));
          if (merged.merges.length) log(chalk.dim(`      ${before} wave(s) → ${plan.length} (--parallel auto; pass --parallel off to keep the orchestrator's serial order)`));
        }
        await recordWavePlan(ctx, stage.id, plan);
        const totalScopes = plan.reduce((n, w) => n + w.length, 0);
        log(chalk.dim(`      orchestrated: ${plan.length} wave(s), ${totalScopes} scope(s)`));
        // The longest, most expensive stage in the system emitted nothing
        // between the line above and its gates — hours, on the run that
        // measured the implementer at 92% of a build's input. Announce each
        // wave's scopes as it starts them (so a stall names what is in flight)
        // and count each one as it lands.
        let built = 0;
        // A greenfield tree's first wave is the scaffold, whatever it is
        // labelled — never task-split it (see firstRunPrompt).
        const greenfield = !(await pathExists(ctx.cwd, 'verify.sh'));
        for (let i = 0; i < plan.length; i++) {
          const wave = plan[i];
          log(chalk.dim(`      wave ${i + 1}/${plan.length} — building ${countNoun(wave.length, 'scope')}: ${wave.map((s) => s.label).join(', ')}`));
          // Each scope runs to completion across fresh agents (continuation loop);
          // file-disjoint scopes within a wave still fan out in parallel, at
          // most PARALLEL_CAP at a time so a machine is not swamped.
          const runs = await mapLimit(wave, PARALLEL_CAP, async (scope) => {
            const basePrompt = stageBrief(stage, brief, [
              `Build ONLY this scope (one isolated implementer run): ${scope.instruction}`,
              await scopeReadList(ctx.cwd, scope),
              'Generate/maintain verify.sh; write and run tests; flip checkboxes for the work you complete.',
            ].filter(Boolean).join('\n'));
            const r = await runImplementScope(stage, scope, basePrompt, ctx, { scaffold: (i === 0 && greenfield) || /scaffold/i.test(scope.label || '') });
            // Counted on completion: scopes within a wave run concurrently, so
            // an ordinal taken on entry would print out of order.
            if (totalScopes > 1) log(chalk.dim(`      [${++built}/${totalScopes}] ${scope.label} — ${r.code === 0 ? 'built' : `exited ${r.code}`}`));
            return r;
          });
          const bad = runs.findIndex((r) => r.code !== 0);
          if (bad >= 0) return { status: 'failed', reason: agentFailure(stage.agent, runs[bad], `scope "${wave[bad].label}", wave ${i + 1}/${plan.length}`), detail: runs[bad].text };
        }
      } else {
        // No usable wave plan. NOT one scope over everything — that was the
        // maximum-context case, reached by a JSON parse hiccup rather than a
        // decision. One scope per feature keeps the same bound the orchestrated
        // path has; a project with no plans at all still gets one call so a
        // greenfield scaffold can happen.
        const slugs = await listFeatureSlugs(ctx.cwd);
        const scopes = [];
        for (const slug of slugs) {
          const p = await planPath(ctx.cwd, slug);
          if (await pathExists(ctx.cwd, p)) scopes.push({ label: slug, instruction: `Implement the feature "${slug}".`, plan: [p] });
        }
        if (!scopes.length) scopes.push({ label: 'all in-scope work', plan: [] });
        else if (reportedNoWork) log(chalk.dim(`      confirming ${countNoun(scopes.length, 'feature')} directly — each skips its implementer if every task is already checked`));
        else log(chalk.dim(`      no wave plan — falling back to ${countNoun(scopes.length, 'per-feature scope')}`));
        // Serial here, so each scope is announced BEFORE it runs: the last line
        // printed is then the scope a stalled run is stuck on.
        let n = 0;
        for (const scope of scopes) {
          if (scopes.length > 1) log(chalk.dim(`      [${++n}/${scopes.length}] ${scope.label} — building…`));
          const prompt = scope.plan.length
            ? stageBrief(stage, brief, [`Build ONLY this scope (one isolated implementer run): ${scope.instruction}`,
              await scopeReadList(ctx.cwd, scope),
              'Generate/maintain verify.sh; write and run tests; flip checkboxes for the work you complete.'].filter(Boolean).join('\n'))
            : buildPrompt;
          out = await runImplementScope(stage, scope, prompt, ctx);
          if (out.code !== 0) return { status: 'failed', reason: agentFailure(stage.agent, out, scope.label), detail: out.text };
        }
      }
      if (ctx.noQa) return { status: 'done', verdict: 'skipped' };

      // Gate part 1 — deterministic build+test. The driver runs verify.sh; a
      // non-zero exit re-delegates the implementer with the exact failure, up
      // to ctx.qaRetries times (--qa-retries).
      // Say that this gate ran, and say when it does not exist.
      //
      // It used to log only on FAILURE, which left the two states that matter
      // most indistinguishable: a run whose code compiled and whose tests all
      // passed looked exactly like a run with no build/test gate at all —
      // silence, either way. On the dogfood run that asked "does an autonomous
      // build actually test a game?", the only way to answer it was to check
      // the timestamp on dist/. The most important deterministic gate in the
      // system should not be the quietest.
      if (!(await pathExists(ctx.cwd, 'verify.sh'))) {
        log(chalk.yellow('      no verify.sh — nothing deterministically checks that this code builds or its tests pass.'));
      } else {
        const verifyStarted = Date.now();
        log(chalk.dim('      verify.sh — building and running the tests…'));
        let v = await runVerify(ctx);
        for (let r = 1; v.code !== 0 && r <= ctx.qaRetries; r++) {
          await ctx.recordFeedback(stage, 'verify.sh', `build/test failed (exit ${v.code}) / ${tail(v.output, 300)}`, { target: 'verify.sh', attempt: r, full: `build/test failed (exit ${v.code})\n\n${v.output}` });
          log(chalk.yellow(`      verify.sh failed — self-heal ${r}/${ctx.qaRetries}…`));
          const fix = `${buildPrompt}\n\nverify.sh failed (exit ${v.code}). Fix the code so build+test pass; do not weaken the tests to make them pass. Output:\n${tail(v.output)}`;
          out = await runAgent(stage.agent, fix, ctx, { allowedTools: 'Bash', kind: 'revision' });
          if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (verify self-heal ${r}) exited ${out.code}` };
          v = await runVerify(ctx);
        }
        if (v.code !== 0) return { status: 'failed', reason: `verify.sh still failing after ${countNoun(ctx.qaRetries, 'self-heal')}`, verdict: 'FAIL', detail: v.output };
        // After the loop, so this reports the state that actually held — a pass
        // reached via a self-heal is still a pass, and saying so is the point.
        log(chalk.dim(`      verify.sh passed (${fmtDuration(Date.now() - verifyStarted)})`));
      }

      // Gate part 1.5 — deterministic, and NOT self-authored.
      //
      // verify.sh proves the code passes its author's own tests: the implementer
      // wrote both, so a green run says nothing about a checked task whose file
      // was never created, a stub behind a checked box, or a capability ticked
      // while its covering tasks are open. Those are pure text checks, so
      // spending an agent run to discover them is waste — and the fix they
      // produce is targeted, where a broad "the implementation seems incomplete"
      // FAIL sends a self-heal run off to rediscover the problem.
      const lintHistory = [];
      const seenFindings = new Set();
      for (let r = 0; ; r++) {
        const findings = await implementationLint(ctx.cwd, { render: ctx.render, log });
        if (!findings.length) break;
        const signature = findings.join('\n');
        const stuck = seenFindings.has(signature);
        if (r >= MAX_LINT_ROUNDS || stuck) {
          return {
            status: 'failed',
            reason: `implementation lint still failing after ${countNoun(r, 'fix')}${stuck ? ' — the last round reported findings it had already been given, so it is not converging' : ''}`,
            verdict: 'FAIL',
            detail: signature,
          };
        }
        seenFindings.add(signature);
        // Print them, don't just count them. This gate BLOCKS and spends an
        // implementer run, so a bare count leaves the one person who could spot
        // a bad finding — "that file plainly exists" — with nothing to look at.
        log(chalk.yellow(`      ${countNoun(findings.length, 'implementation lint issue')} — fixing (free — no validator run)…`));
        for (const f of findings) log(chalk.dim(`        · ${f}`));
        await ctx.recordFeedback(stage, 'implementation-lint', findings.join('\n'), { target: 'the implementation', attempt: r + 1 });
        lintHistory.push(findings.map((f) => `- ${f}`).join('\n'));
        const fix = implementRevisePrompt(stage, 'this scope', lintHistory, { deterministic: true });
        out = await runAgent(stage.agent, fix, ctx, { allowedTools: 'Bash', kind: 'lint-fix' });
        if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (lint fix ${r + 1}) exited ${out.code}` };
      }

      // Gate part 2 — judgment. implementation-validator checks the in-scope
      // acceptance criteria + Definition of Done; up to ctx.qaRetries
      // self-heals on FAIL (--qa-retries).
      if (!stage.validator) return { status: 'done', verdict: 'PASS' };
      const jvTarget = 'the implemented scope';
      const jvOpts = { allowedTools: 'Bash' };
      let { v: jv, g: jg } = await judgeOnce(stage, jvTarget, '', ctx, jvOpts);
      if (jg.verdict === 'PASS') return finishPass(stage, jvTarget, jv, jg, ctx);
      // Twice unvalidated is not a QA failure. Say so, rather than sending the
      // implementer to repair an engine error and then blaming the code.
      if (jg.verdict === null) {
        return { status: 'failed', reason: unvalidatedReason(stage, jvTarget, jv.text), verdict: 'unvalidated', detail: jv.text };
      }
      const qaHistory = ctx.priorVerdicts(stage.id, jvTarget);
      for (let r = 1; r <= ctx.qaRetries; r++) {
        await ctx.recordFeedback(stage, stage.validator, jv.text, { target: jvTarget, attempt: r });
        log(chalk.yellow(`      implementation QA flagged issues — revision ${r}/${ctx.qaRetries}… (${summarize(jv.text)})`));
        const addressed = jv.text;
        qaHistory.push(jv.text);
        const revise = implementRevisePrompt(stage, jvTarget, qaHistory);
        out = await runAgent(stage.agent, revise, ctx, { allowedTools: 'Bash', kind: 'revision' });
        if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (QA revision ${r}) exited ${out.code}` };
        ({ v: jv, g: jg } = await judgeOnce(stage, jvTarget, addressed, ctx, jvOpts));
        if (jg.verdict === 'PASS') return finishPass(stage, jvTarget, jv, jg, ctx);
        if (jg.verdict === null) {
          return { status: 'failed', reason: unvalidatedReason(stage, jvTarget, jv.text), verdict: 'unvalidated', detail: jv.text };
        }
      }
      return { status: 'failed', reason: `implementation QA gate did not pass after ${countNoun(ctx.qaRetries, 'revision')}`, verdict: jg.verdict || 'unknown', detail: jv.text };
    }

    case 'audit': {
      // Incremental by default. v3 moved the "reads everything, grows with age"
      // problem out of the implementer and into here: feature folders accumulate
      // for the life of a project, and re-reading unchanged ones finds nothing.
      // The baseline is a commit, so the changed set is a git question.
      const scope = await auditScope(ctx.cwd);
      const out = await runAgent(stage.agent, [
        'Inspect the codebase for drift vs the specs and orphan capabilities; return an impact-ordered findings report. Do not modify anything.',
        scope.instruction,
      ].filter(Boolean).join('\n\n'), ctx, { allowedTools: 'Bash' });
      if (out.code !== 0) {
        return { status: 'failed', verdict: 'report', reason: agentFailure(stage.agent, out), detail: out.text };
      }
      // KEEP THE REPORT. This stage's entire output is its findings — drift
      // between the specs and the code, and capabilities nothing implements —
      // and they were being dropped on success, which is every normal run. The
      // build then said "Reconcile audit — report" and the report was gone.
      const report = String(out.text || '').trim();
      if (report) {
        // Say "would" when nothing was written. The pointer is still worth
        // previewing — it tells you where the findings land — but stated as
        // fact it sends the reader to a file preview mode never created.
        if (skipWrite()) {
          log(chalk.dim(`      would keep findings in ${AUDIT_REPORT_PATH}`));
        } else {
          await writeFile(join(ctx.cwd, AUDIT_REPORT_PATH), `# Reconcile audit\n\n${report}\n`, 'utf-8');
          log(chalk.dim(`      findings kept in ${AUDIT_REPORT_PATH}`));
        }
      }
      await recordAuditBaseline(ctx.cwd);
      return { status: 'done', verdict: 'report', detail: report || undefined };
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
    // A wave is a LIST OF SCOPES, however the model chose to express it. The
    // documented shape is a bare array, but naming a wave is a natural thing to
    // reach for — `{ "label": "Scaffold", "scopes": [...] }` — and demanding the
    // bare array turned that into an empty one, dropped every scope, and made
    // the whole plan null. A ~855k-token plan, correct in substance, discarded
    // silently over one level of nesting. Take the scopes wherever they are.
    const list = Array.isArray(wave) ? wave
      : (Array.isArray(wave?.scopes) ? wave.scopes
        : (Array.isArray(wave?.tasks) ? wave.tasks
          : (Array.isArray(wave?.items) ? wave.items
            // A wave that IS a scope: the model flattened a one-scope wave to
            // the scope itself. Observed on a later run of the same agent —
            // three different reasonable shapes across three runs, which is the
            // point: pin the MEANING (a wave is one or more scopes), not a shape.
            : (typeof wave?.instruction === 'string' && wave.instruction.trim() ? [wave] : []))));
    const scopes = list
      .filter((s) => s && typeof s.instruction === 'string' && s.instruction.trim())
      .map((s) => ({ label: String(s.label || 'scope').trim(), instruction: s.instruction.trim(), plan: normalizePlanFiles(s.plan) }));
    if (scopes.length) norm.push(scopes);
  }
  // An EMPTY plan is an answer, not a failure to be read. On a resume where
  // every task is already checked, this agent replied `{"waves": []}` with a
  // correct explanation that no work remained — and collapsing that to null
  // made it indistinguishable from gibberish, so the driver blamed its own
  // parser in the log for the one reply that was completely right. Return the
  // empty plan and let the caller decide what no-work means.
  return waves.length && !norm.length ? null : norm;
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

export async function runBuild({ idea, cwd = process.cwd(), engine, noQa = false, noReview = false, research = false, scope, qaRetries, resume = false, dryRun = false, permissionMode = 'acceptEdits', piPermissionLevel, parallel, notify: notifyFlag } = {}) {
  // Armed before anything can reach the disk — see `previewOnly`.
  previewOnly = !!dryRun;

  let manifest = await loadManifest(cwd);

  // --scope: the tier every spec's size budget is scaled by (feedback §1).
  // Validated while aborting is still free; honored at resume time (like
  // --qa-retries) so a run whose specs came out too big can be retuned and
  // continued rather than restarted.
  if (scope !== undefined && !SCOPE_TIERS.includes(scope)) {
    console.error(chalk.red(`\n  --scope must be one of: ${SCOPE_TIERS.join(', ')} (got "${scope}").\n`));
    process.exit(1);
  }

  // --parallel: whether the driver may merge provably file-disjoint waves
  // (auto, the default) or must keep the orchestrator's order (off). Per
  // invocation, like --qa-retries: it only changes how one implement stage
  // is scheduled, never what any stage produces.
  if (parallel !== undefined && !PARALLEL_MODES.includes(parallel)) {
    console.error(chalk.red(`\n  --parallel must be one of: ${PARALLEL_MODES.join(', ')} (got "${parallel}").\n`));
    process.exit(1);
  }

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

  // Close the open interruption, if this invocation is continuing a stopped
  // run. Stamped on the way IN, before any stage runs, so the gap measured is
  // the wait itself and not the work that followed it.
  if (manifest && resume && !dryRun) {
    const open = (manifest.pauses || []).filter((p) => !p.resumedAt).pop();
    if (open) {
      open.resumedAt = new Date().toISOString();
      open.waitedMs = Math.max(0, Date.parse(open.resumedAt) - Date.parse(open.at));
      await saveManifest(cwd, manifest);
      const why = open.limit ? 'a usage limit' : 'a failure';
      console.log(chalk.dim(`  Continuing a run that stopped ${humanMs(open.waitedMs)} ago at "${open.stage}" on ${why}.`));
    } else {
      // No open interruption, but time passed anyway. A pause is only OPENED on
      // the stage-failure path, so it records the run stopping and never the
      // run being STOPPED: close the laptop, kill the driver, lose power, and
      // nothing writes the record because nothing is running to write it.
      //
      // Measured on a real run: run.json reported 3 stops totalling ~2.5 hours
      // across a build whose transcripts show 91.2 idle hours in 99.6 wall —
      // including one 75.9-hour gap that left no trace at all. A record that
      // exists to answer "how much of this run was just waiting?" was wrong by
      // 36x, which is worse than not keeping it, because the number looks like
      // an answer.
      //
      // `updatedAt` is rewritten by every saveManifest, so it is the last
      // moment the driver is known to have been alive. Anything longer than a
      // stage's own think-time means nobody was running this build.
      const last = Date.parse(manifest.updatedAt || '');
      const gapMs = Number.isFinite(last) ? Date.now() - last : 0;
      if (gapMs > STOPPED_GAP_MS) {
        const at = new Date(last).toISOString();
        const resumedAt = new Date().toISOString();
        const stage = Object.entries(manifest.stages || {})
          .filter(([, s]) => s.status === 'running' || s.status === 'pending').map(([id]) => id)[0] || 'unknown';
        // The spec-review gate is the one stop that is DELIBERATE and still
        // opens no interruption — it is not a failure, so nothing records it.
        // Counting that wait is right (it is wall clock nobody was working),
        // but calling it "the driver was stopped" would report a human reading
        // the specs as an anomaly. Read the state the pause itself recorded.
        const prior = await readStatus(cwd);
        const awaitingReview = prior?.state === 'paused_review';
        (manifest.pauses ??= []).push({
          stage,
          at,
          resumedAt,
          waitedMs: gapMs,
          // Not a failure and not a limit — say so plainly rather than let it
          // read as either. Nothing was wrong; the build simply was not running.
          reason: awaitingReview
            ? 'awaiting spec review (no driver running)'
            : 'the run was not running (the driver was stopped, not paused)',
          limit: false,
          unattended: true,
          review: awaitingReview || undefined,
        });
        await saveManifest(cwd, manifest);
        console.log(chalk.dim(awaitingReview
          ? `  Continuing after ${humanMs(gapMs)} awaiting spec review.`
          : `  Continuing a run that was not running for ${humanMs(gapMs)} (stopped at "${stage}", no failure recorded).`));
      }
    }
  }

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

    // Installed agents are COPIES. Upgrading gspec does not rewrite them, so a
    // project can run a new driver against yesterday's agent definitions — and
    // nothing said so. A measured run did this for ten hours: every one of 29
    // agents was a day stale, and a QA bar fixed that morning failed the same
    // stage seven times, twice terminally, because the fix never reached the
    // project. Warn; never block, since the mismatch is usually harmless and a
    // project may deliberately pin its agents.
    const installedVersion = (await readProjectConfig(cwd)).gspecVersion;
    if (installedVersion && installedVersion !== GSPEC_VERSION) {
      log(chalk.yellow(`  Note: this project's agents were installed by gspec v${installedVersion}, but you are running v${GSPEC_VERSION}.`));
      log(chalk.dim(`  Agent and skill files are copies — fixes since v${installedVersion} are NOT active here. Refresh with: npx gspec -t ${engineName}`));
    } else if (!installedVersion) {
      log(chalk.dim(`  Note: this project predates install-version stamping, so agent freshness cannot be checked. Refresh with \`npx gspec -t ${engineName}\` if agents look stale.`));
    }
  }

  if (!manifest) {
    manifest = initManifest(idea, { engine: engineName, noQa, noReview, research, scope, qaRetries: explicitQaRetries, permissionMode });
    await saveManifest(cwd, manifest);
  } else if (research && !manifest.research) {
    // --research is pinned at run start (like engine/noQa, unlike --no-review):
    // enabling it mid-run would hand later stages a research.md the stages that
    // already ran never saw.
    log(chalk.yellow('  Note: this run started without --research — ignoring it (research is pinned at run start).'));
  }

  // Ensure a pending-memory baseline exists (fresh run, or an older manifest
  // being resumed). Taken before any stage runs, so the end-of-run diff is
  // net-new rather than everything a previous run left waiting for review.
  manifest.learnings = manifest.learnings || [];
  if (!manifest.memoryBaseline) {
    manifest.memoryBaseline = await snapshotPending(cwd);
    await saveManifest(cwd, manifest);
  }

  // A --qa-retries at resume time is honored for this invocation (like
  // --no-review): the retried stage reruns from scratch anyway, so a different
  // revision budget never makes past stages inconsistent. Otherwise the run
  // keeps the count it started with (pre-flag manifests default to 1).
  const qaRetryCount = explicitQaRetries ?? manifest.qaRetries ?? 1;

  // Per-agent model assignment (config `models` map). Read fresh each run — like
  // --qa-retries, not pinned like the engine — so models can be tuned and the run
  // resumed. Project entries override the ~/.gspec global; most-specific selector
  // wins (agent name > role tier > default). See lib/config.js resolveModel.
  const projectConfig = await readProjectConfig(cwd);
  const globalConfig = await readGlobalConfig();

  // --notify <cmd>, else `notify` in .gspec/config.json (then ~/.gspec). Runs
  // on every pause, failure, crash and completion (lib/notify.js). Read fresh
  // each run like the models map: a command added between runs should fire on
  // the resume.
  const notifyCmd = String(notifyFlag ?? projectConfig.notify ?? globalConfig.notify ?? '').trim();

  // The user's saved-spec library (~/.gspec). Read fresh each run — a template
  // added between runs should be available on the resume.
  const templates = await loadTemplateLibrary();

  // The render floor (plugin/hooks/floors/render-lint.mjs): on when Playwright
  // is a dependency, off with `render: false` in the config or GSPEC_RENDER=0.
  // Availability is re-read at gate time — the scaffold may add Playwright.
  const renderSwitch = renderEnabled({ config: projectConfig, env: process.env, available: { playwright: true } });
  const ctx = { cwd, engine: selectedEngine, noQa: manifest.noQa, research: !!manifest.research, qaRetries: qaRetryCount, scope: scope ?? manifest.scope ?? DEFAULT_SCOPE, permissionMode: manifest.permissionMode, piPermissionLevel, dryRun, brief: '', templates, log, parallel: parallel ?? 'auto', render: renderSwitch };
  ctx.resolveModel = (agentName) => resolveModel(agentName, { project: projectConfig, global: globalConfig });
  // Record a QA FAIL the driver observed (the feedback signal a memory comes
  // from). Two durable channels: (1) a compact excerpt on the manifest's array
  // (each saveManifest persists it; drives the end-of-run report),
  // and (2) the FULL verdict appended to qa-failures.md so the failure is
  // reviewable later even if the self-heal recovers. `meta.full` overrides the
  // log text when the summarizable form differs from what's worth keeping
  // verbatim (e.g. verify.sh: a tidy excerpt vs. the whole build/test output).
  ctx.recordFeedback = async (stage, agent, text, meta = {}) => {
    manifest.learnings.push({ at: new Date().toISOString(), stage: stage.id, agent, excerpt: summarize(text) });
    if (dryRun) return;
    const { full, ...rest } = meta;
    // PERSIST THE VERDICT, not just a summary of it. The revision loops build
    // their history in-process, so after a resume attempt N started blind and
    // could repeat a fix that attempt N-1 was already told did not work — the
    // one thing revisePrompt's history exists to prevent. The durable log has
    // the full text but is prose written for a person; this is the machine copy.
    if (meta.target) {
      const st = (manifest.stages[stage.id] ??= { status: 'pending', attempts: 0, verdict: null });
      const list = ((st.verdicts ??= {})[meta.target] ??= []);
      if (!list.includes(text)) list.push(text);
      await saveManifest(cwd, manifest);
    }
    await appendQaFailure(cwd, { stage, checker: agent, retries: ctx.qaRetries, text: full ?? text, ...rest });
  };
  // Every verdict this target has already collected, across runs. Empty on a
  // first authoring; on a resume it is what the previous process knew.
  ctx.priorVerdicts = (stageId, target) => manifest.stages[stageId]?.verdicts?.[target]?.slice() ?? [];
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
  // A pass is only reusable while BOTH sides of it still hold: the deliverable
  // AND the thing that judged it. Keying on the file alone meant a fixed gate
  // never re-examined anything that had already passed — the build kept running
  // yesterday's verdicts, which is the same disease install-version stamping
  // fixed one layer up when a run was found executing yesterday's agents.
  //
  // Seen immediately: correcting the inverted [P] floor mid-run left the one
  // feature carrying a real [P]-on-[P] conflict marked "unchanged since it
  // passed", so the corrected check never saw the file it was written for.
  // Stamping the version invalidates every memo on upgrade, which is the
  // conservative direction — a redundant re-validation costs one cheap run, a
  // skipped one ships the defect.
  const memoStamp = (h) => `${GSPEC_VERSION}:${h}`;
  ctx.isMemoized = async (stageId, key, filePath) => {
    const stored = manifest.stages[stageId]?.passed?.[key];
    if (!stored) return false;
    const h = await hashFile(cwd, filePath);
    return Boolean(h) && stored === memoStamp(h);
  };
  ctx.memoize = async (stageId, key, filePath) => {
    if (dryRun) return;
    const h = await hashFile(cwd, filePath);
    if (!h) return;
    const st = (manifest.stages[stageId] ??= { status: 'pending', attempts: 0, verdict: null });
    (st.passed ??= {})[key] = memoStamp(h);
    await saveManifest(cwd, manifest);
  };
  // A stage's own manifest record, for state that isn't a QA pass — the
  // per-feature fan-outs record which features they have WRITTEN, so a resume
  // can tell "already written, re-validate" from "the writer died here".
  // Token accounting (§ cost). Kept per AGENT rather than per stage: a stage's
  // cost is dominated by which agents it runs and how often, and the per-agent
  // view is the one that answers "what should I tier, and what should I stop
  // letting read so much?".
  //
  // The arithmetic lives in lib/usage.js (pure, tested); this only owns the
  // manifest write. `kind` names how the run was spent and `flags.progress`
  // whether it moved the build — see that module for the buckets.
  ctx.recordUsage = async (agentName, out, kind = 'initial', flags = {}) => {
    if (!out?.usage || dryRun) return;
    accumulate((manifest.usage ??= {}), agentName, out, kind, flags);
    await saveManifest(cwd, manifest);
  };
  ctx.stageRecord = (stageId) =>
    (manifest.stages[stageId] ??= { status: 'pending', attempts: 0, verdict: null });
  ctx.saveManifest = () => (dryRun ? Promise.resolve() : saveManifest(cwd, manifest));

  // A --no-review at resume time is honored too (unlike engine/noQa, which stay
  // pinned): it only widens what runs unattended, never changes how a stage ran.
  const skipReview = !!(manifest.noReview || noReview);

  log(chalk.bold(`\n  gspec build — ${chalk.cyan(manifest.idea)}`));
  const qaMode = manifest.noQa ? 'off (--no-qa)' : qaRetryCount === 1 ? 'on' : `on (qa-retries: ${qaRetryCount})`;
  const researchMode = manifest.research ? ' · competitive research: on' : '';
  log(chalk.dim(`  engine: ${engineName} · QA gates: ${qaMode}${researchMode} · spec review: ${skipReview ? 'off (--no-review)' : 'pauses before implementation'} · resumable · ${dryRun ? 'DRY RUN' : 'autonomous after intake'}`));
  if (notifyCmd) log(chalk.dim(`  notify: ${notifyCmd} — runs on every pause, failure, crash and completion (GSPEC_STATE/STAGE/REASON/IDEA/CWD in its environment)`));
  // Surface the active model assignments so the cost/quality tradeoff is visible.
  const selectors = modelSelectors(projectConfig, globalConfig);
  if (Object.keys(selectors).length) {
    log(chalk.dim(`  models: ${Object.entries(selectors).map(([k, v]) => `${k}→${v}`).join(', ')} (per-agent: agent > role > default)`));
  }
  log('');

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
  // Scope tier (feedback §1), most-specific-first: an explicit --scope, then
  // the tier already pinned on the manifest, then whatever intake recorded in
  // the brief, then standard. Persisted so run.json shows what the budgets
  // were scaled by.
  ctx.scope = scope ?? manifest.scope ?? scopeFromBrief(ctx.brief) ?? DEFAULT_SCOPE;
  if (manifest.scope !== ctx.scope) { manifest.scope = ctx.scope; await saveManifest(cwd, manifest); }
  log(chalk.dim(`  scope: ${ctx.scope} — spec size budgets scale by it (small ×0.6 · standard ×1 · large ×1.5); over-budget specs are noted by QA, never blocked.`));

  // Surface the saved-spec library, so it is visible that a run had templates
  // to draw on (and which ones) rather than the writers quietly starting blank.
  const libFolders = Object.entries(templates);
  if (libFolders.length) {
    log(chalk.dim(`  templates: ${libFolders.map(([f, t]) => `${f} ${t.length}`).join(' · ')} — from ~/.gspec; the matching writer may seed from one and adapt it.`));
    for (const [folder, found] of libFolders) {
      if (found.length > MAX_TEMPLATES_LISTED) {
        log(chalk.yellow(`  ${found.length} ${folder} templates — offering the first ${MAX_TEMPLATES_LISTED} (dropping: ${found.slice(MAX_TEMPLATES_LISTED).map((t) => t.name).join(', ')}).`));
      }
    }
  }

  // --- crash safety -------------------------------------------------------
  //
  // Every OTHER way a run can end reports itself. This is the one that could
  // not: an uncaught error, an OOM kill, a closed terminal, a `kill` — the
  // process vanished mid-stage, leaving the manifest stuck at `running`, no
  // last-failure.md, and a log that simply stopped. Nothing downstream could
  // tell that from "still working", so the failure was silent by construction.
  // These handlers stamp the ending SYNCHRONOUSLY (process.exit will not wait
  // on a promise) so `--status` and any watcher always find a verdict.
  //
  // Installed here, AFTER intake: during the interview the engine owns the
  // terminal, and a Ctrl+C meant for it must keep behaving as it always has.
  // SIGHUP is deliberately not handled — `nohup` ignores it, and adding a
  // listener would resurrect the very hangup nohup exists to prevent.
  let currentStage = null;
  const fatal = (what, detail) => {
    const stage = currentStage;
    const reason = `${what}${stage ? ` during "${stage.title}"` : ''}`;
    writeStatusSync(cwd, 'crashed', { manifest, engine: engineName, stage, reason, exitCode: EXIT.CRASHED, notify: notifyCmd });
    writeLastFailureSync(cwd, `Build crashed${stage ? `: ${stage.title} (${stage.id})` : ''}`, reason, detail);
    console.error(chalk.red(`\n  ✗ Build ${reason}.`));
    console.error(chalk.yellow(`  This run did NOT finish. What is known is in ${LAST_FAILURE_PATH} and ${STATUS_PATH};`));
    console.error(chalk.yellow('  continue from where it stopped with: gspec build --resume\n'));
    process.exit(EXIT.CRASHED);
  };
  const fatalHandlers = [];
  if (!dryRun) {
    fatalHandlers.push(['uncaughtException', (e) => fatal('crashed (uncaught exception)', e?.stack || String(e))]);
    fatalHandlers.push(['unhandledRejection', (e) => fatal('crashed (unhandled rejection)', e?.stack || String(e))]);
    for (const sig of ['SIGINT', 'SIGTERM']) {
      fatalHandlers.push([sig, () => fatal(`interrupted (${sig})`, `The build process received ${sig} and stopped before finishing.`)]);
    }
    for (const [event, handler] of fatalHandlers) process.on(event, handler);
  }
  const releaseFatalHandlers = () => {
    for (const [event, handler] of fatalHandlers) process.off(event, handler);
  };
  await writeStatus(cwd, 'running', { manifest, engine: engineName, dryRun });

  // Stage loop — resume skips done/skipped stages. A manifest written before a
  // stage existed (e.g. pre-review-gate runs) has no entry for it: default one
  // so an in-flight run survives a gspec upgrade.
  for (const stage of STAGES) {
    const st = (manifest.stages[stage.id] ??= { status: 'pending', attempts: 0, verdict: null });
    if (st.status === 'done' || st.status === 'skipped') { log(chalk.dim(`  ✓ ${stage.title} — ${st.status}`)); continue; }

    // The spec-review human gate: pause (exit 2 — NOT 0, so a watcher cannot
    // mistake a pause for a finished build) on first arrival; a --resume that
    // lands on the paused gate is the approval and continues into
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
      await writeStatus(cwd, 'paused_review', { manifest, engine: engineName, stage, reason: 'awaiting spec review before implementation', exitCode: EXIT.PAUSED_REVIEW, notify: notifyCmd });
      log(chalk.bold.yellow('\n  ⏸ Paused for spec review — the specs are written; no code has been generated yet.'));
      log(chalk.yellow('  Review (and freely edit) the specs: gspec/profile.md, stack.md, practices.md, style.*, architecture.md (+ architecture/), features/, tasks/'));
      log(chalk.yellow('  When they look right, continue into implementation with: gspec build --resume'));
      log(chalk.dim('  (Skip this pause with --no-review — on the resume, or on a future fresh run.)'));
      log(chalk.dim(`  This is exit ${EXIT.PAUSED_REVIEW} — "paused for review", not "complete". State: ${STATUS_PATH} (or: gspec build --status).\n`));
      process.exit(EXIT.PAUSED_REVIEW);
    }

    currentStage = stage;
    log(chalk.bold(`  ▸ ${stage.title}`));
    // The status BEFORE this attempt drives §4's resume behavior: a `failed`
    // (or crashed `running`) stage re-validates its draft rather than skipping.
    const priorStatus = st.status;
    const startedAt = Date.now();
    st.status = 'running'; st.attempts += 1; await saveManifest(cwd, manifest);
    await writeStatus(cwd, 'running', { manifest, engine: engineName, stage, dryRun });

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
      // Record the interruption durably. A long build is routinely stopped by a
      // usage limit and continued hours later, and until now nothing kept that:
      // last-failure.md is overwritten by the next failure and DELETED when the
      // build completes, and once a stage finally passes its manifest record
      // shows a bare `attempts: 2` with no reason. A finished run could not say
      // whether it had been interrupted at all, let alone for how long — the
      // one measured run that hit a session limit lost nine hours of wall clock
      // and left no structured trace of it.
      (manifest.pauses ??= []).push({
        stage: stage.id,
        at: new Date().toISOString(),
        reason: result.reason || 'failed',
        // A limit is a clock to wait out; everything else needs a person. The
        // distinction is what makes "how much of this run was just waiting?"
        // answerable after the fact.
        limit: looksRateLimited(result.detail || result.reason || ''),
      });
      await saveManifest(cwd, manifest);
      log(chalk.red(`  ✗ ${stage.title} — ${result.reason || 'failed'}`));
      await writeStatus(cwd, 'failed', { manifest, engine: engineName, stage, reason: result.reason || 'failed', exitCode: EXIT.FAILED, dryRun, notify: notifyCmd, limit: looksRateLimited(result.detail || result.reason || '') });
      await reportFailure(cwd, stage, result, dryRun);
      await reportLearnings(cwd, manifest);
  reportUsage(manifest);
  reportPauses(manifest);
      log(chalk.yellow(`\n  ⚠ Action required: the build is paused at "${stage.title}".`));
      log(chalk.yellow(`  Review the failure above (kept in ${LAST_FAILURE_PATH} and the stage's "detail" in ${MANIFEST_PATH};`));
      log(chalk.yellow(`  every QA failure this run, including recovered ones, is in ${QA_LOG_PATH}),`));
      log(chalk.yellow('  fix it, then re-run with --resume to continue from exactly here.'));
      log(chalk.dim(`  Exit ${EXIT.FAILED} — "failed". State: ${STATUS_PATH} (or: gspec build --status).\n`));
      process.exit(EXIT.FAILED);
    }
    const took = result.status === 'skipped' ? '' : chalk.dim(` (${fmtDuration(elapsedMs)})`);
    log(chalk[result.status === 'skipped' ? 'dim' : 'green'](`  ${result.status === 'skipped' ? '↷' : '✓'} ${stage.title} — ${result.verdict || result.status}`) + took);
  }

  // Past the last stage: the run is over, so stop treating a signal as a crash
  // (a Ctrl+C during the closing report would otherwise overwrite a completed
  // run's state with "crashed").
  currentStage = null;
  releaseFatalHandlers();
  if (!dryRun) await rm(join(cwd, LAST_FAILURE_PATH), { force: true }); // a completed run has no live failure
  await writeStatus(cwd, 'complete', { manifest, engine: engineName, exitCode: EXIT.COMPLETE, dryRun, notify: notifyCmd });
  log(chalk.bold.green('\n  ✓ Build complete.') + (manifest.totalElapsedMs ? chalk.dim(` (${fmtDuration(manifest.totalElapsedMs)} of stage time across all runs)`) : ''));
  log(chalk.dim(`  Specs + code are in place; see .gspec/build/run.json for the run record.`));
  await reportLearnings(cwd, manifest);
  reportUsage(manifest);
  reportPauses(manifest);
  log('');
  // Falls off the end with the default exit code (0 === EXIT.COMPLETE). Not an
  // explicit process.exit: stdout is asynchronous when piped, and exiting here
  // could truncate the report a watcher is reading.
}

async function readBrief(cwd) {
  try { return await readFile(join(cwd, BRIEF_PATH), 'utf-8'); } catch { return ''; }
}
