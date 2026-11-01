#!/usr/bin/env node
// gspec sessionStart hook (Cursor) — task-immutability baseline snapshot.
//
// The pre-write hook blocks edits to checked tasks when it can read the write,
// but Cursor does not document its Write input, and a shell command can edit a
// plan without any Write at all. So the stop hook re-checks the whole tree at
// the end of each turn, and needs to know which tasks were ALREADY checked when
// the session began: this snapshots every plan file into a session-scoped temp
// file. The plan-path list is shared with the scan (floors/session.mjs), so the
// two can never cover different layouts. Fails OPEN.
//
// NOTE: ./floors/ resolves at the INSTALLED location (.cursor/hooks/floors/);
// this file is never executed from the source tree.

import { writeBaseline, snapshotPlans } from './floors/session.mjs';
import { readEvent, projectDir, sessionId, none } from './event.mjs';

try {
  const evt = readEvent();
  const dir = projectDir(evt);
  writeBaseline(dir, sessionId(evt), snapshotPlans(dir));
  none(); // nothing to inject; the snapshot is the whole job
} catch {
  none(); // fail open
}
