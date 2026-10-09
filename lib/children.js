// Every subprocess the build starts, so none outlives it.
//
// A build is a tree of long-running children: engine runs (claude, codex, pi)
// and verify.sh. When the driver ends early — a crash, SIGINT/SIGTERM, a
// failed parallel wave whose sibling scopes are still running — the children
// it started kept going, still editing the project, with no one left to time
// them out. verify.sh is spawned `detached` (its own process group, so a hang
// in a grandchild can be killed), which also means a terminal Ctrl+C never
// reaches it.
//
// Children register here; killAll() signals every one still alive (the whole
// process group for a detached child). It runs from the build's fatal handler
// and, as a backstop, on process 'exit', which covers every other ending.

const live = new Set();
let exitHookInstalled = false;

function signal(entry, sig) {
  const { child, group } = entry;
  if (group && child.pid) {
    try { process.kill(-child.pid, sig); return; } catch { /* group gone; try the child */ }
  }
  try { child.kill(sig); } catch { /* already gone */ }
}

/** Register a spawned child. `group: true` for a detached process-group leader. */
export function track(child, { group = false } = {}) {
  const entry = { child, group };
  live.add(entry);
  const forget = () => live.delete(entry);
  child.once?.('exit', forget);
  child.once?.('error', forget);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Synchronous by necessity: nothing asynchronous runs during 'exit'.
    process.once('exit', () => killAll('SIGTERM'));
  }
  return child;
}

/** Signal every live child. Synchronous; returns how many were signalled. */
export function killAll(sig = 'SIGTERM') {
  let n = 0;
  for (const entry of [...live]) { signal(entry, sig); n++; }
  return n;
}

/** How many tracked children are still running (for tests and diagnostics). */
export function liveCount() { return live.size; }
