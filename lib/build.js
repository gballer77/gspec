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
import { parseModulesTable, moduleSpecPaths } from '../plugin/hooks/floors/modules.mjs';
import { archLintViolations, designLintViolations, planLintViolations, parallelismViolations, coversViolations } from '../plugin/hooks/floors/plan-lint.mjs';
import { appliesToTokenLiterals, tokenLiteralViolations } from '../plugin/hooks/floors/token-literals.mjs';
import { filesNamedByCheckedTasks, missingWorkViolations, stubViolations, checkboxConsistency } from '../plugin/hooks/floors/implementation-lint.mjs';

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
// Where the reconcile audit's findings go. The audit produces nothing BUT a
// report, and the driver used to keep its text only when the stage failed — so
// the one run that produced a usable report was the one where the agent
// crashed. A 4-minute, ~3M-token stage ended in the word "report".
const AUDIT_REPORT_PATH = join(BUILD_DIR, 'audit-report.md');
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
// The anchor-producing stage runs one feature at a time. PRDs are file- AND
// content-disjoint, so they fan out safely; feature architectures are only
// file-disjoint. Two concurrent writers both grep for `### Entity: User`, both
// find no origin, and both declare themselves one — a race that produces two
// origins for the same anchor, which is a blocker finding after the fact.
// Named so raising it is a one-line change if it proves too slow; the cost is
// the same N sequential runs the plan stage already had.
const FEATURE_ARCH_CONCURRENCY = 1;
// How long to wait before retrying a transient agent failure. Long enough for a
// server-side overload to clear, negligible against an implement run that takes
// tens of minutes.
const TRANSIENT_BACKOFF_MS = 30_000;
// Retries for a transient engine error, each waiting longer than the last
// (30s, 120s, 270s). Bounded: a genuinely broken prompt must still surface
// rather than being retried until the run looks hung.
export const MAX_TRANSIENT_RETRIES = 3;
// The wait before retry n (0-based): 30s, 120s, 270s. Exported so the schedule
// is asserted rather than described in a comment.
export function transientBackoffMs(n) {
  return TRANSIENT_BACKOFF_MS * (n + 1) ** 2;
}
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
  // 2,100 = a 1,500-word system tier plus the 600-word module tier a
  // single-module project carries in the same file.
  'architecture.md': 2100,
  'architecture/<name>.md': 600,
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
  { id: 'architecture', title: 'Architecture',      type: 'gated',      writer: 'architecture-writer', validator: 'architecture-validator', outputs: ['gspec/architecture.md'], deliverables: architectureDeliverables },
  // Three per-feature stages, one handler. Separate stage ids (not sub-phases of
  // one stage) because the manifest already keys status/attempts/passed BY STAGE
  // ID — three entries buy three resume points and three memo namespaces for
  // free. `plan` keeps its id and title so a manifest from an in-flight run
  // still resolves. Writer-outer order (every feature gets arch.md, THEN every
  // feature gets design.html) means a crash never leaves one feature straddling
  // two writers.
  {
    id: 'feature-arch', title: 'Feature architecture', type: 'feature-plan',
    writer: 'feature-architect', validator: 'feature-architecture-validator',
    file: FEATURE_FILES.arch,
    // Serial: this is the only stage that MINTS anchors. Two concurrent writers
    // both grep for `### Entity: User`, both find nothing, and both declare
    // themselves its origin. The anchor-consuming stages stay parallel.
    concurrency: FEATURE_ARCH_CONCURRENCY,
    lint: lintFeatureArch,
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
  const proseAt = body.findIndex((l, i) => i > 0
    && !/^#{1,6}\s*$/.test(l) && !/^[-*_]{3,}$/.test(l)
    && !/^#*\s*\**\s*(SPEC|VERDICT)\b/i.test(l)
    && !/^#{1,6}\s+\S+(\s+\S+)?\s*$/.test(l)   // a short bare heading like "## Structured Verdict"
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
}

// The crash path: process.exit will not wait for a promise, so the fatal
// handler writes synchronously or not at all.
function writeStatusSync(cwd, state, opts = {}) {
  try {
    mkdirSync(join(cwd, BUILD_DIR), { recursive: true });
    writeFileSync(join(cwd, STATUS_PATH), JSON.stringify(statusRecord(state, opts), null, 2) + '\n', 'utf-8');
  } catch { /* nothing left to do if even this fails */ }
}

function writeLastFailureSync(cwd, title, reason, detail) {
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
    scope: opts.scope || null,
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
async function runAgent(agentName, prompt, ctx, extra = {}) {
  const out = await ctx.engine.runAgent(agentName, prompt, ctx, {
    needsBash: extra.allowedTools === 'Bash',
    needsWeb: extra.allowedTools === 'Web',
    // Per-agent model from the config `models` map (null → engine/CLI default).
    model: ctx.resolveModel ? ctx.resolveModel(agentName) : null,
  });
  // Account for the run. Engines that cannot report usage simply contribute
  // nothing, so this degrades to today's behavior rather than guessing.
  if (ctx.recordUsage) await ctx.recordUsage(agentName, out);
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

// A spec file that exists, has real content, and opens with frontmatter or a
// heading — "complete and well-formed enough to let QA judge it" (feedback §7).
async function looksComplete(cwd, rel) {
  try {
    const t = (await readFile(join(cwd, rel), 'utf-8')).trim();
    return t.length > 40 && (t.startsWith('---') || /^[#<]/m.test(t));
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
async function reportSize(ctx, rel) {
  const budget = budgetFor(rel, ctx.scope);
  if (!budget || ctx.dryRun) return '';
  let text;
  try { text = await readFile(join(ctx.cwd, rel), 'utf-8'); } catch { return ''; }
  const words = countSpecWords(text, rel);
  const tier = ctx.scope !== DEFAULT_SCOPE ? `, ${ctx.scope} scope` : '';
  if (words <= budget * BUDGET_TOLERANCE) {
    log(chalk.dim(`      ${rel} — ${words} words (budget ${budget}${tier})`));
    return '';
  }
  const ratio = (words / budget).toFixed(1);
  log(chalk.yellow(`      ${rel} — ${words} words, ${ratio}× its ${budget}-word budget${tier} (advisory: noted for QA, does not block)`));
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

  let out = await runAgent(agentName, prompt, ctx, extra);
  if (out.code === 0 && await delivered()) return { ...out, failure: null };

  log(chalk.dim(out.code === 0
    ? `      ${agentName} exited 0 but produced no deliverable — retrying once (the engine may have errored)…`
    : `      ${agentName} exited ${out.code} — retrying once (may be a transient post-write crash)…`));
  out = await runAgent(agentName, prompt, ctx, extra);
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
async function judgeOnce(stage, target, addressed, ctx, runOpts = {}) {
  let v = await runAgent(stage.validator, validatorPrompt(stage, target, addressed, ctx.scope), ctx, runOpts);
  let g = grade(stage, v.text, target);
  if (g.verdict === null) {
    log(chalk.dim(`      re-running ${stage.validator} — the last response carried no verdict (engine error, not a finding)…`));
    v = await runAgent(stage.validator, validatorPrompt(stage, target, addressed, ctx.scope), ctx, runOpts);
    g = grade(stage, v.text, target);
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
// trigger of the memory-capture convention (gspec-memory), so capture is a
// stated step of the run — conditional, since only some engines have a silo.
export function revisePrompt(stage, target, verdicts, sizeNote = '') {
  const history = verdicts.map((v, i) =>
    `--- Verdict ${i + 1} of ${verdicts.length}${i === verdicts.length - 1 ? ' (current — fix this one)' : ' (an earlier attempt already tried to fix this)'} ---\n${v}`).join('\n\n');
  return [
    `You are the "${stage.title}" stage of an autonomous gspec build. You cannot ask the user questions.`,
    `A prior draft of ${target} failed QA. This is a surgical revision, not a rewrite: read the existing document and make ONLY the edits the findings below name, preserving everything else byte-for-byte. Do not add sections or material no finding asks for.`,
    // PRECEDENCE FIRST, then the anti-growth rule it governs. Stated the other
    // way round, a verdict like "eight required sections are missing" (a fix
    // that multiplies the document's length) put the writer between two rules
    // with no ranking, and only its judgment decided which one gave way.
    'Precedence, when two of these rules pull against each other: resolving a blocker or major finding outranks every size rule. If a finding names content that is MISSING — a required section, a capability, an acceptance criterion — add it in full, however much the document grows, and do not water it down to stay near a word count. An unresolved blocker fails this gate; an over-budget document never does.',
    'Subject to that, resolve each finding in place: growth is for what the findings require and nothing else. Adding material no finding asks for — or growing the document by more than ~10% while resolving no blocker/major finding — is itself a defect, because precision comes from tightening what is there, not from appending prose (which only gives the next QA pass new text to fault).',
    // The measured overage (feedback §1). A draft already past its ceiling pays
    // for required additions by cutting elsewhere — but still adds them.
    ...(sizeNote ? [`${sizeNote} Because this draft is already over budget, pay for anything a finding requires you to add by cutting restatement, duplicated tables, and rationale for minor decisions elsewhere — resolve every OTHER finding by replacing text rather than appending to it. If it still ends up over budget once every finding is resolved, that is the correct outcome: say so in your summary (and, for a feature or architecture spec, say whether the overage means the scope should be split) rather than leaving a finding unresolved.`] : []),
    ...(verdicts.length > 1 ? ['Every verdict so far is included below, oldest first. A finding that reappears in a later verdict means the earlier fix did not land — fix it differently rather than repeating it.'] : []),
    'This failed verdict is corrective feedback: if the gspec-memory convention is in your instructions, record the generalizable lesson (or state in your summary why the finding was purely project-specific) before returning.',
    '',
    history,
  ].join('\n');
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
    'This is corrective feedback: if the gspec-memory convention is in your instructions, record the generalizable lesson before returning.',
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
  if (ctx.noQa || !stage.validator) return { status: 'done', verdict: ctx.noQa ? 'skipped' : null };

  return reviseUntilPass(stage, target, ctx, {
    validatorTarget,
    outputsOk,
    measure,
    sizeNote,
    writerPrompt: (verdicts, note) => revisePrompt(stage, target, verdicts, note),
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
    return { status: 'failed', reason: `${target} could not be validated — ${stage.validator} returned no verdict twice (an engine error, not a finding)`, verdict: 'unvalidated', detail: v.text };
  }

  // Seed from what earlier RUNS were told. A resume that starts this list empty
  // hands the writer a blank slate and it can repeat a fix already known to fail.
  const verdicts = [...ctx.priorVerdicts(stage.id, target).filter((t) => t !== v.text), v.text];
  for (let r = 1; r <= ctx.qaRetries; r++) {
    await ctx.recordFeedback(stage, stage.validator, v.text, { target, attempt: r });
    log(chalk.yellow(`      QA flagged issues — revision ${r}/${ctx.qaRetries}… (${summarize(v.text)})`));
    const addressed = v.text; // the verdict this revision is trying to resolve
    const out = await runWriterResilient(stage.writer, writerPrompt(verdicts, sizeNote), ctx, {}, outputsOk);
    if (out.failure) return { status: 'failed', reason: `revision ${r}: ${out.failure}` };
    sizeNote = await measure();
    ({ v, g } = await judge(addressed));
    if (g.verdict === 'PASS') return finishPass(stage, target, v, g, ctx);
    if (g.verdict === null) {
      return { status: 'failed', reason: `${target} could not be validated after revision ${r} — ${stage.validator} returned no verdict twice (an engine error, not a finding)`, verdict: 'unvalidated', detail: v.text };
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
export async function implementationLint(cwd) {
  const out = [];
  for (const slug of await listFeatureSlugs(cwd)) {
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
  return out;
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

// The feature slug a plan path belongs to, in either layout.
function featureSlugOf(rel) {
  const r = String(rel).replace(/\\/g, '/');
  return r.match(/^gspec\/features\/([^/]+)\/tasks\.md$/)?.[1]
    ?? r.match(/^gspec\/tasks\/([^/]+)\.md$/)?.[1] ?? null;
}

// The EXACT specs this scope may read, resolved by the driver.
//
// The whole context argument rests on the implementer confining itself to one
// feature folder, and until now that was prose in an agent file. The driver
// knows the feature, and the feature's arch.md names its module — which IS the
// module-tier path — so it can hand over resolved paths instead of routing rules
// to follow. Deviations then show up in the transcript.
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

  const arch = await readOr(cwd, featureFile(slug, FEATURE_FILES.arch));
  const module = arch.match(/^module:\s*(\S+)\s*$/m)?.[1];
  const moduleTier = module ? `gspec/architecture/${module}.md` : null;
  const extra = ['gspec/architecture.md', 'gspec/practices.md'];
  if (moduleTier && await pathExists(cwd, moduleTier)) extra.splice(1, 0, moduleTier);

  return [
    'Your specs for this scope are exactly these — do not read other specs:',
    ...files.map((f) => `  ${f}`),
    ...extra.map((f) => `  ${f}`),
    `(${featureFile(slug, FEATURE_FILES.prd)} is there for the capability checkboxes you flip, not for context — the enriched siblings already carry what you need.)`,
  ].join('\n');
}

// --- the deterministic lint each per-feature stage runs before its validator --
const readOr = async (cwd, rel, fallback = '') => {
  try { return await readFile(join(cwd, rel), 'utf-8'); } catch { return fallback; }
};

async function lintFeatureArch(cwd, slug) {
  const rel = featureFile(slug, FEATURE_FILES.arch);
  // Origin uniqueness is a CROSS-file property, so the lint needs every other
  // feature's arch.md — the one check that cannot be made from one file alone.
  const others = {};
  for (const other of await listFeatureSlugs(cwd)) {
    if (other === slug) continue;
    const r = featureFile(other, FEATURE_FILES.arch);
    if (await pathExists(cwd, r)) others[r] = await readOr(cwd, r);
  }
  return archLintViolations(rel, await readOr(cwd, rel), others);
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
async function featureArchPrompt(ctx, slug, rel) {
  return [
    `Write the feature architecture for "${slug}" to ${rel} (use this exact path).`,
    `Its PRD is ${await prdPath(ctx.cwd, slug)}. Read gspec/architecture.md for module boundaries and placement rules, gspec/stack.md for the technologies, and the module tier for the modules this feature touches.`,
    'Cover ## Data, ## API, ## UI, and ## Logic — every one of the four present, each either specified or marked **Not Applicable** with a reason. One H3 anchor per item, in the exact grammar from gspec-conventions.',
    'Before writing any item, grep gspec/features/*/arch.md for its anchor: no hit makes you its origin (write the full definition); a hit makes yours a delta that names what it amends and states only what changed.',
    'ENRICH: an implementer reading only this feature folder must not need the architecture, the stack, or the style guide. Inline the concrete technology names and decisions rather than citing where they live.',
  ].join('\n');
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
      log(chalk.dim(`      ✓ ${rel} — ${mine ? 'already written' : 'already present (not written by this run)'}; skipping regeneration (QA still checks it below)`));
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
    await reportSize(ctx, rel); // advisory (§1)
    return out;
  });
  const bad = runs.findIndex((r) => r.failure);
  if (bad >= 0) return { status: 'failed', reason: `feature "${targets[bad]}": ${runs[bad].failure}` };

  if (ctx.noQa || !stage.validator) return { status: 'done', verdict: ctx.noQa ? 'skipped' : 'PASS' };

  // --- validate phase ---
  let advisory = 0;
  for (const slug of targets) {
    const target = featureFile(slug, stage.file);
    if (await ctx.isMemoized(stage.id, slug, target)) {
      log(chalk.dim(`      ✓ ${target} — unchanged since it passed; skipping re-validation`));
      continue;
    }
    // Deterministic lint FIRST. Anything a regex can decide (anchor grammar,
    // section shape, screen coverage, anchors that don't resolve) goes straight
    // back to the writer with the exact violations — no agent run spent
    // discovering it, and a precise instruction instead of a vague FAIL. The
    // validator then only ever judges mechanically-clean drafts.
    if (stage.lint) {
      for (let r = 0; r <= ctx.qaRetries; r++) {
        const violations = await stage.lint(ctx.cwd, slug);
        if (!violations.length) break;
        if (r === ctx.qaRetries) {
          return { status: 'failed', reason: `${target} still fails the mechanical lint after ${countNoun(r, 'fix')}`, detail: violations.join('\n') };
        }
        log(chalk.yellow(`      ${target} — ${countNoun(violations.length, 'lint issue')}; fixing (free — no validator run)…`));
        const fix = await runWriterResilient(
          stage.writer,
          [`Fix these mechanical problems in ${target}. They are deterministic — each names exactly what is wrong.`,
            '', ...violations.map((v) => `- ${v}`), '',
            'Change nothing else.'].join('\n'),
          ctx, {}, () => wellFormed(ctx.cwd, target),
        );
        if (fix.failure) return { status: 'failed', reason: `${target} lint fix: ${fix.failure}` };
      }
    }
    const r = await reviseUntilPass(stage, target, ctx, {
      validatorTarget: target,
      outputsOk: () => wellFormed(ctx.cwd, target),
      measure: () => reportSize(ctx, target),
      sizeNote: await reportSize(ctx, target),
      writerPrompt: (verdicts, note) => revisePrompt(stage, target, verdicts, note),
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

  for (let run = 1; run <= MAX_SCOPE_RUNS; run++) {
    out = await runAgent(stage.agent, promptFor(run), ctx, { allowedTools: 'Bash' });
    const after = await countUnchecked(ctx.cwd, files);
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
            log(chalk.dim(`      ✓ ${f.slug} — PRD already written; skipping regeneration (QA re-checks it below)`));
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
          await reportSize(ctx, await prdPath(ctx.cwd, f.slug)); // advisory (§1)
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
      for (const prd of slugs) {
        const target = await prdPath(ctx.cwd, prd);
        // A PRD unchanged since it last passed QA is not re-gated (feedback §5):
        // the features stage restarts over the whole PRD list on every resume, so
        // without this an already-passing PRD burns a fresh budget each time — and
        // its verdict was observed to be unstable across re-gates.
        if (await ctx.isMemoized('features', prd, target)) {
          log(chalk.dim(`      ✓ ${target} — unchanged since it passed; skipping re-validation`));
          continue;
        }
        let v = await runAgent(stage.validator, validatorPrompt(stage, target, '', ctx.scope), ctx);
        let g = grade(stage, v.text, target);
        if (g.verdict === 'FAIL') {
          const verdicts = [v.text];
          let sizeNote = await reportSize(ctx, target);
          for (let r = 1; r <= ctx.qaRetries; r++) {
            await ctx.recordFeedback(stage, stage.validator, v.text, { target, attempt: r });
            log(chalk.yellow(`      QA flagged issues in ${target} — revision ${r}/${ctx.qaRetries}… (${summarize(v.text)})`));
            const addressed = v.text;
            const rev = await runWriterResilient(stage.writer, revisePrompt(stage, target, verdicts, sizeNote), ctx, {}, () => looksCompletePrd(ctx.cwd, prd));
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

    // One handler, three stages: feature-arch, feature-design, and plan each
    // write ONE file per feature into that feature's folder, then gate it.
    case 'feature-plan':
      return runFeaturePlanStage(stage, ctx, { rerunning });

    case 'implement': {
      // The monolithic brief — the fallback build, and the self-heal prompt (a
      // full "fix whatever's broken" pass) used by the gates below.
      const buildPrompt = stageBrief(stage, brief, 'Implement all in-scope, unchecked work. Scaffold if greenfield; generate/maintain verify.sh from the architecture Modules table; write and run tests; flip checkboxes as you go.');

      // Orchestrate (design §13 T3): the build-orchestrator turns the specs into
      // an ordered wave plan; the driver runs it, fanning out file-disjoint
      // scopes within a wave. No usable plan → one monolithic implement call.
      let plan = null;
      if (stage.orchestrator) {
        const p = await runAgent(stage.orchestrator, stageBrief(stage, brief, 'Plan this implementation run: read the in-scope features/plans and return ONLY the ordered wave build-plan JSON.'), ctx);
        plan = p.code === 0 ? parseBuildPlan(p.text) : null;
        if (Array.isArray(plan) && !plan.length) {
          // The orchestrator says there is nothing to do. Trust it as a REPORT,
          // not as an instruction: fall through to per-feature scopes, which
          // cost nothing when it is right (each skips on a zero unchecked count)
          // and still do the work when it is wrong. What changes is only that we
          // stop calling a correct answer a parser gap.
          log(chalk.dim(`      ${stage.orchestrator} reports no remaining work — checking each feature directly.`));
          plan = null;
        }
        // "no wave plan" hid two very different causes: the agent died, or it
        // answered and the driver could not read it. The second is a defect in
        // the READER and was invisible for a whole release — say which.
        if (!plan) {
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
        log(chalk.dim(`      orchestrated: ${plan.length} wave(s), ${plan.reduce((n, w) => n + w.length, 0)} scope(s)`));
        for (let i = 0; i < plan.length; i++) {
          const wave = plan[i];
          // Each scope runs to completion across fresh agents (continuation loop);
          // file-disjoint scopes within a wave still fan out in parallel.
          const runs = await Promise.all(wave.map(async (scope) => {
            const basePrompt = stageBrief(stage, brief, [
              `Build ONLY this scope (one isolated implementer run): ${scope.instruction}`,
              await scopeReadList(ctx.cwd, scope),
              'Generate/maintain verify.sh; write and run tests; flip checkboxes for the work you complete.',
            ].filter(Boolean).join('\n'));
            return runImplementScope(stage, scope, basePrompt, ctx);
          }));
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
        else log(chalk.dim(`      no wave plan — falling back to ${countNoun(scopes.length, 'per-feature scope')}`));
        for (const scope of scopes) {
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
      for (let r = 0; r <= ctx.qaRetries; r++) {
        const findings = await implementationLint(ctx.cwd);
        if (!findings.length) break;
        if (r === ctx.qaRetries) {
          return { status: 'failed', reason: `implementation lint still failing after ${countNoun(r, 'fix')}`, verdict: 'FAIL', detail: findings.join('\n') };
        }
        // Print them, don't just count them. This gate BLOCKS and spends an
        // implementer run, so a bare count leaves the one person who could spot
        // a bad finding — "that file plainly exists" — with nothing to look at.
        log(chalk.yellow(`      ${countNoun(findings.length, 'implementation lint issue')} — fixing (free — no validator run)…`));
        for (const f of findings) log(chalk.dim(`        · ${f}`));
        await ctx.recordFeedback(stage, 'implementation-lint', findings.join('\n'), { target: 'the implementation', attempt: r + 1 });
        lintHistory.push(findings.map((f) => `- ${f}`).join('\n'));
        const fix = implementRevisePrompt(stage, 'this scope', lintHistory, { deterministic: true });
        out = await runAgent(stage.agent, fix, ctx, { allowedTools: 'Bash' });
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
        return { status: 'failed', reason: `${jvTarget} could not be validated — ${stage.validator} returned no verdict twice (an engine error, not a finding)`, verdict: 'unvalidated', detail: jv.text };
      }
      const qaHistory = ctx.priorVerdicts(stage.id, jvTarget);
      for (let r = 1; r <= ctx.qaRetries; r++) {
        await ctx.recordFeedback(stage, stage.validator, jv.text, { target: jvTarget, attempt: r });
        log(chalk.yellow(`      implementation QA flagged issues — revision ${r}/${ctx.qaRetries}… (${summarize(jv.text)})`));
        const addressed = jv.text;
        qaHistory.push(jv.text);
        const revise = implementRevisePrompt(stage, jvTarget, qaHistory);
        out = await runAgent(stage.agent, revise, ctx, { allowedTools: 'Bash' });
        if (out.code !== 0) return { status: 'failed', reason: `${stage.agent} (QA revision ${r}) exited ${out.code}` };
        ({ v: jv, g: jg } = await judgeOnce(stage, jvTarget, addressed, ctx, jvOpts));
        if (jg.verdict === 'PASS') return finishPass(stage, jvTarget, jv, jg, ctx);
        if (jg.verdict === null) {
          return { status: 'failed', reason: `${jvTarget} could not be validated — ${stage.validator} returned no verdict twice (an engine error, not a finding)`, verdict: 'unvalidated', detail: jv.text };
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
        await writeFile(join(ctx.cwd, AUDIT_REPORT_PATH), `# Reconcile audit\n\n${report}\n`, 'utf-8');
        log(chalk.dim(`      findings kept in ${AUDIT_REPORT_PATH}`));
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

export async function runBuild({ idea, cwd = process.cwd(), engine, noQa = false, noReview = false, research = false, scope, qaRetries, resume = false, dryRun = false, permissionMode = 'acceptEdits', piPermissionLevel } = {}) {
  let manifest = await loadManifest(cwd);

  // --scope: the tier every spec's size budget is scaled by (feedback §1).
  // Validated while aborting is still free; honored at resume time (like
  // --qa-retries) so a run whose specs came out too big can be retuned and
  // continued rather than restarted.
  if (scope !== undefined && !SCOPE_TIERS.includes(scope)) {
    console.error(chalk.red(`\n  --scope must be one of: ${SCOPE_TIERS.join(', ')} (got "${scope}").\n`));
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

  // Per-agent model assignment (config `models` map). Read fresh each run — like
  // --qa-retries, not pinned like the engine — so models can be tuned and the run
  // resumed. Project entries override the ~/.gspec global; most-specific selector
  // wins (agent name > role tier > default). See lib/config.js resolveModel.
  const projectConfig = await readProjectConfig(cwd);
  const globalConfig = await readGlobalConfig();

  // The user's saved-spec library (~/.gspec). Read fresh each run — a template
  // added between runs should be available on the resume.
  const templates = await loadTemplateLibrary();

  const ctx = { cwd, engine: selectedEngine, noQa: manifest.noQa, research: !!manifest.research, qaRetries: qaRetryCount, scope: scope ?? manifest.scope ?? DEFAULT_SCOPE, permissionMode: manifest.permissionMode, piPermissionLevel, dryRun, brief: '', templates, log };
  ctx.resolveModel = (agentName) => resolveModel(agentName, { project: projectConfig, global: globalConfig });
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
  // A stage's own manifest record, for state that isn't a QA pass — the
  // per-feature fan-outs record which features they have WRITTEN, so a resume
  // can tell "already written, re-validate" from "the writer died here".
  // Token accounting (§ cost). Kept per AGENT rather than per stage: a stage's
  // cost is dominated by which agents it runs and how often, and the per-agent
  // view is the one that answers "what should I tier, and what should I stop
  // letting read so much?".
  ctx.recordUsage = async (agentName, out) => {
    const u = out?.usage;
    if (!u || dryRun) return;
    const acc = (manifest.usage ??= {});
    const a = (acc[agentName] ??= { runs: 0, in: 0, cacheRead: 0, cacheWrite: 0, out: 0, turns: 0, costUsd: 0 });
    a.runs += 1;
    a.in += u.input_tokens || 0;
    a.cacheRead += u.cache_read_input_tokens || 0;
    a.cacheWrite += u.cache_creation_input_tokens || 0;
    a.out += u.output_tokens || 0;
    a.turns += out.turns || 0;
    a.costUsd += out.costUsd || 0;
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
    writeStatusSync(cwd, 'crashed', { manifest, engine: engineName, stage, reason, exitCode: EXIT.CRASHED });
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
      await writeStatus(cwd, 'paused_review', { manifest, engine: engineName, stage, reason: 'awaiting spec review before implementation', exitCode: EXIT.PAUSED_REVIEW });
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
      log(chalk.red(`  ✗ ${stage.title} — ${result.reason || 'failed'}`));
      await writeStatus(cwd, 'failed', { manifest, engine: engineName, stage, reason: result.reason || 'failed', exitCode: EXIT.FAILED, dryRun });
      await reportFailure(cwd, stage, result, dryRun);
      await reportLearnings(cwd, manifest);
  reportUsage(manifest);
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
  await writeStatus(cwd, 'complete', { manifest, engine: engineName, exitCode: EXIT.COMPLETE, dryRun });
  log(chalk.bold.green('\n  ✓ Build complete.') + (manifest.totalElapsedMs ? chalk.dim(` (${fmtDuration(manifest.totalElapsedMs)} of stage time across all runs)`) : ''));
  log(chalk.dim(`  Specs + code are in place; see .gspec/build/run.json for the run record.`));
  await reportLearnings(cwd, manifest);
  reportUsage(manifest);
  log('');
  // Falls off the end with the default exit code (0 === EXIT.COMPLETE). Not an
  // explicit process.exit: stdout is asynchronous when piped, and exiting here
  // could truncate the report a watcher is reading.
}

async function readBrief(cwd) {
  try { return await readFile(join(cwd, BRIEF_PATH), 'utf-8'); } catch { return ''; }
}
