// Notify on a pause — the cheapest fix in the efficiency brief.
//
// 691 minutes of a measured build (43% of wall clock) were spent waiting:
// a review gate opened, a usage limit hit, a stage failed, and nobody was
// told. The tokens cost nothing while waiting; the time did. `gspec build
// --notify <cmd>` (or `notify` in .gspec/config.json) runs a user command
// on every transition a person needs to hear about, with the facts in the
// environment so the command can be anything — a desktop notification, a
// webhook, a bell.
//
// Never throws, never blocks the build for long: the command gets ten
// seconds and its exit code is reported, not raised.

import { spawn, spawnSync } from 'node:child_process';

export const NOTIFY_TIMEOUT_MS = 10_000;

// The states worth a notification. `running` and the per-stage churn are not:
// a notification is for "you are needed" or "it is over".
export const NOTIFY_STATES = new Set(['paused_review', 'paused_limit', 'failed', 'crashed', 'complete']);

/** The environment a notify command runs with, from a payload. Pure. */
export function notifyEnv({ state, stage, reason, idea, cwd } = {}) {
  return {
    GSPEC_STATE: String(state ?? ''),
    GSPEC_STAGE: String(stage ?? ''),
    GSPEC_REASON: String(reason ?? ''),
    GSPEC_IDEA: String(idea ?? ''),
    GSPEC_CWD: String(cwd ?? ''),
  };
}

/**
 * Run `cmd` (a shell string) with the payload in its environment. Resolves
 * `{ ran: false }` when there is no command, else `{ ran: true, code,
 * timedOut }`. Never rejects.
 */
export async function notify(cmd, payload = {}, { timeoutMs = NOTIFY_TIMEOUT_MS, spawnFn = spawn } = {}) {
  const command = String(cmd || '').trim();
  if (!command) return { ran: false };
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawnFn(command, {
        cwd: payload.cwd || process.cwd(),
        env: { ...process.env, ...notifyEnv(payload) },
        shell: true,
        stdio: 'ignore',
        detached: false,
      });
    } catch (e) {
      return done({ ran: true, code: null, timedOut: false, error: e?.message || String(e) });
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done({ ran: true, code: null, timedOut: true });
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); done({ ran: true, code: null, timedOut: false, error: e?.message || String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); done({ ran: true, code: code ?? null, timedOut: false }); });
  });
}

/**
 * The crash path cannot await: process.exit will not wait on a promise, so
 * the fatal handler notifies synchronously or not at all. Same contract —
 * never throws, ten-second cap.
 */
export function notifySync(cmd, payload = {}, { timeoutMs = NOTIFY_TIMEOUT_MS, spawnSyncFn = spawnSync } = {}) {
  const command = String(cmd || '').trim();
  if (!command) return { ran: false };
  try {
    const r = spawnSyncFn(command, { cwd: payload.cwd || process.cwd(), env: { ...process.env, ...notifyEnv(payload) }, shell: true, stdio: 'ignore', timeout: timeoutMs });
    return { ran: true, code: r.status ?? null, timedOut: r.error?.code === 'ETIMEDOUT', error: r.error && r.error.code !== 'ETIMEDOUT' ? r.error.message : undefined };
  } catch (e) {
    return { ran: true, code: null, timedOut: false, error: e?.message || String(e) };
  }
}

// Where the notify command comes from, and whether to trust it.
//
// The command runs through a shell. A flag and ~/.gspec/config.json are the
// user's own; a project's .gspec/config.json is whatever the repository
// commits — so `gspec build` in a freshly cloned repo would run a command its
// author chose. A project command is honoured only when the user has opted in
// with `"trustProjectNotify": true` in ~/.gspec/config.json, or when it is the
// same command the global config already names. Otherwise it is ignored, and
// the caller says so.
//
// Returns { cmd, source: 'flag' | 'project' | 'global' | null, ignoredProject }.
export function resolveNotifyCommand({ flag, projectConfig = {}, globalConfig = {} } = {}) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const fromFlag = clean(flag);
  const fromProject = clean(projectConfig.notify);
  const fromGlobal = clean(globalConfig.notify);
  if (fromFlag) return { cmd: fromFlag, source: 'flag', ignoredProject: null };
  if (fromProject) {
    const trusted = globalConfig.trustProjectNotify === true || fromProject === fromGlobal;
    if (trusted) return { cmd: fromProject, source: 'project', ignoredProject: null };
    return { cmd: fromGlobal, source: fromGlobal ? 'global' : null, ignoredProject: fromProject };
  }
  return { cmd: fromGlobal, source: fromGlobal ? 'global' : null, ignoredProject: null };
}
