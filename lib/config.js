// Project-local gspec config (.gspec/config.json) — install-time metadata the
// CLI consults later (e.g. `gspec build` defaults its engine to the target the
// project was installed for, instead of blindly assuming Claude).
//
// The same file also carries an optional `models` map (see resolveModel) that
// assigns a model to each build agent; a `~/.gspec/config.json` provides the
// user-global defaults the project file overrides.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const PROJECT_CONFIG_PATH = join('.gspec', 'config.json');

// Missing or unreadable config is not an error — older installs predate it.
export async function readProjectConfig(cwd) {
  try {
    return JSON.parse(await readFile(join(cwd, PROJECT_CONFIG_PATH), 'utf-8'));
  } catch {
    return {};
  }
}

// User-global config at ~/.gspec/config.json (homedir honors $HOME, so tests
// with an isolated HOME never touch a developer's real file). Same shape as the
// project config; only its `models` map is consulted today.
export async function readGlobalConfig() {
  try {
    return JSON.parse(await readFile(join(homedir(), '.gspec', 'config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

// --- per-agent model resolution (config `models` map) ----------------------
//
// The `models` map keys a model onto a SELECTOR: an exact agent name, a role
// tier, or `default`. Role tiers let one entry cover a whole class of agents
// without naming each — `qa` is every `*-validator`, `writer` every `*-writer`,
// and the producers that don't follow those suffixes are named below.
const ROLE_BY_NAME = {
  'feature-planner': 'planner',
  'research-planner': 'planner',
  'plan-decomposer': 'planner',
  'build-orchestrator': 'planner',
  'implementer': 'implementer',
  'competitor-researcher': 'researcher',
  'codebase-inspector': 'inspector',
  // The per-feature writers don't carry the `-writer` suffix the tier rule keys
  // on, so without these they'd match only `default` — invisible, and exactly
  // the kind of gap a role-tier selector is supposed to close.
  'feature-architect': 'writer',
  'feature-designer': 'writer',
};

// The role tier an agent belongs to, or null if it matches no tier (then only an
// exact-name entry or `default` applies). Suffix rules cover the generated
// families (*-writer / *-validator); the table above covers the rest.
export function roleOf(agentName) {
  if (ROLE_BY_NAME[agentName]) return ROLE_BY_NAME[agentName];
  if (agentName.endsWith('-validator')) return 'qa';
  if (agentName.endsWith('-writer')) return 'writer';
  return null;
}

// Resolve the model for one agent from the project + global `models` maps, most
// specific selector first, project breaking ties WITHIN a level: exact agent
// name (project→global), then role tier (project→global), then `default`
// (project→global). Returns null when nothing matches (engine/CLI default).
export function resolveModel(agentName, { project = {}, global = {} } = {}) {
  const pm = project.models || {};
  const gm = global.models || {};
  const role = roleOf(agentName);
  const candidates = [
    pm[agentName],               // 1. project, exact agent
    gm[agentName],               // 2. global,  exact agent
    role ? pm[role] : undefined, // 3. project, role tier
    role ? gm[role] : undefined, // 4. global,  role tier
    pm.default,                  // 5. project, default
    gm.default,                  // 6. global,  default
  ];
  return candidates.find((m) => typeof m === 'string' && m.trim()) || null;
}

// The distinct selectors configured across both files (project overlaying
// global), for a compact "which models are in play" line at run start.
export function modelSelectors(projectConfig = {}, globalConfig = {}) {
  return { ...(globalConfig.models || {}), ...(projectConfig.models || {}) };
}

// --- the recommended tiering -----------------------------------------------
//
// The `models` map has shipped since 2.6.0 and almost nobody sets one, so every
// agent — validators included — runs on the engine's default, which is usually
// the top tier. Validators are roughly half of all agent runs in a v3 build and
// they are the cheapest thing to move: a deterministic lint now handles the
// mechanical checks, so what's left for them is focused judgment over one small
// file.
//
// Three tiers, expressed through the existing selectors: `qa` catches every
// *-validator by suffix, `writer` every *-writer plus the two named above, and
// exact names override for the two load-bearing jobs — the system design and
// the code, where a mistake propagates into everything downstream.
//
// Model IDs are the ones each CLI accepts; this table is the ONLY place they
// live, so keeping up with a new model is a one-line edit here.
export const RECOMMENDED_MODELS = {
  claude: {
    default: 'claude-sonnet-5',
    writer: 'claude-sonnet-5',
    qa: 'claude-haiku-4-5',
    'architecture-writer': 'claude-opus-5',
    'feature-architect': 'claude-opus-5',
    implementer: 'claude-opus-5',
  },
  codex: {
    default: 'gpt-5',
    writer: 'gpt-5',
    qa: 'gpt-5-mini',
    'architecture-writer': 'gpt-5-codex',
    'feature-architect': 'gpt-5-codex',
    implementer: 'gpt-5-codex',
  },
};

// The recommendation for an install target, or null when there isn't one.
// Only the two engines that actually run the build's agents are covered:
// cursor/opencode don't, and pi's roster moves too fast to recommend from a
// table that ships in a release.
export function recommendedModels(target) {
  return RECOMMENDED_MODELS[target] ?? null;
}

// Whether either config already assigns models. A user who has configured this
// is never second-guessed — the offer is for the empty case only.
export function hasModelsConfigured(projectConfig = {}, globalConfig = {}) {
  const n = (c) => Object.keys(c?.models || {}).length;
  return n(projectConfig) > 0 || n(globalConfig) > 0;
}

// Shallow-merges `patch` over the existing config so unrelated keys survive.
export async function writeProjectConfig(cwd, patch) {
  const merged = { ...(await readProjectConfig(cwd)), ...patch };
  const path = join(cwd, PROJECT_CONFIG_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  return merged;
}
