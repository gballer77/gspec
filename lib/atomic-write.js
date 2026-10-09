// Crash-safe, ordered writes for the build's control files.
//
// run.json and status.json are what `--resume` and `--status` read back. A
// plain writeFile truncates first and writes second, so a crash between the
// two — or two writes in flight at once, which parallel waves and the feature
// fan-out produce — can leave a file that is empty or half one write and half
// another. loadManifest then throws and the run cannot be resumed.
//
// Two guarantees, both per path:
//   - atomic: the bytes go to a sibling temp file that is renamed over the
//     target, so a reader sees the old file or the new one, never a mix;
//   - ordered: writes queue behind each other in call order, so the last call
//     wins. The content is fixed when the call is made, not when it lands.

import { writeFile, rename, unlink } from 'node:fs/promises';
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

const queues = new Map();
let counter = 0;

function tempPath(path) {
  return join(dirname(path), `.${basename(path)}.${process.pid}.${++counter}.tmp`);
}

export function writeFileAtomic(path, data, encoding = 'utf-8') {
  const prev = queues.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const tmp = tempPath(path);
    try {
      await writeFile(tmp, data, encoding);
      await rename(tmp, path);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  });
  queues.set(path, next);
  // Drop the chain once it is idle so the map does not grow per path forever.
  next.catch(() => {}).finally(() => { if (queues.get(path) === next) queues.delete(path); });
  return next;
}

// For exit handlers, where nothing asynchronous will run. Still atomic.
export function writeFileAtomicSync(path, data, encoding = 'utf-8') {
  const tmp = tempPath(path);
  try {
    writeFileSync(tmp, data, encoding);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never written */ }
    throw e;
  }
}
