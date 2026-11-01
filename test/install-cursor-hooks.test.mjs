// Cursor hooks: `gspec -t cursor` must wire .cursor/hooks.json (merge-safe,
// idempotent) and the INSTALLED hooks — run from .cursor/hooks/ so their
// ./floors/ imports resolve exactly as Cursor would resolve them — must answer
// in Cursor's native JSON format: preToolUse blocks with permission "deny",
// postToolUse feeds findings back as additional_context, stop asks for a
// follow-up. A permission hook that prints anything but valid JSON blocks the
// write in Cursor, so every allow path is asserted to print an explicit allow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runCli, makeProject, cleanup, exists } from './helpers.mjs';

function runHook(dir, file, event) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(dir, '.cursor', 'hooks', file)], {
      cwd: dir,
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let json;
      try { json = JSON.parse(stdout); } catch { json = undefined; }
      resolve({ code, stdout, stderr, json });
    });
    child.stdin.end(JSON.stringify(event));
  });
}

async function installed() {
  const dir = await makeProject();
  const r = await runCli(['-t', 'cursor'], dir);
  assert.equal(r.code, 0, r.output);
  return dir;
}

const PLAN = [
  '---',
  'spec-version: v2',
  '---',
  '# Tasks',
  '',
  '- [x] **T1** Build the thing',
  '  deps: none',
  '- [ ] **T2** Test the thing',
  '',
].join('\n');

async function withPlan(dir) {
  await mkdir(join(dir, 'gspec', 'features', 'demo'), { recursive: true });
  const path = join(dir, 'gspec', 'features', 'demo', 'tasks.md');
  await writeFile(path, PLAN, 'utf-8');
  return path;
}

test('install wires every gspec hook into .cursor/hooks.json and copies the floors', async () => {
  const dir = await installed();
  try {
    const cfg = JSON.parse(await readFile(join(dir, '.cursor', 'hooks.json'), 'utf-8'));
    assert.equal(cfg.version, 1);
    const cmds = (event) => (cfg.hooks[event] || []).map((e) => e.command);
    assert.deepEqual(cmds('preToolUse'), ['node .cursor/hooks/gspec-pre-write.mjs']);
    assert.deepEqual(cmds('postToolUse'), ['node .cursor/hooks/gspec-post-write.mjs']);
    assert.deepEqual(cmds('sessionStart'), ['node .cursor/hooks/gspec-session-start.mjs']);
    assert.deepEqual(cmds('stop'), ['node .cursor/hooks/gspec-stop.mjs']);
    assert.equal(cfg.hooks.preToolUse[0].matcher, 'Write');
    assert.equal(cfg.hooks.stop[0].loop_limit, 3, 'a stop hook with no loop limit can trap a session');
    for (const f of ['event.mjs', 'floors/scan.mjs', 'floors/session.mjs', 'floors/reconcile.mjs']) {
      assert.ok(await exists(join(dir, '.cursor', 'hooks', f)), `${f} must be installed`);
    }
    assert.ok(!(await exists(join(dir, '.claude'))), 'a Cursor install must not need a .claude/ directory');
  } finally {
    await cleanup(dir);
  }
});

test('reinstall keeps the user\'s own hooks and does not duplicate gspec\'s', async () => {
  const dir = await installed();
  try {
    const path = join(dir, '.cursor', 'hooks.json');
    const cfg = JSON.parse(await readFile(path, 'utf-8'));
    cfg.hooks.preToolUse.push({ command: './my-guard.sh', matcher: 'Shell' });
    cfg.hooks.afterFileEdit = [{ command: './fmt.sh' }];
    cfg.hooks.subagentStop = [{ command: 'node .cursor/hooks/gspec-retired.mjs' }];
    await writeFile(path, JSON.stringify(cfg), 'utf-8');

    const r = await runCli(['-t', 'cursor'], dir);
    assert.equal(r.code, 0, r.output);
    const after = JSON.parse(await readFile(path, 'utf-8'));
    assert.deepEqual(after.hooks.preToolUse.map((e) => e.command), ['./my-guard.sh', 'node .cursor/hooks/gspec-pre-write.mjs']);
    assert.deepEqual(after.hooks.afterFileEdit, [{ command: './fmt.sh' }]);
    assert.equal(after.hooks.subagentStop, undefined, 'an entry for a hook gspec no longer ships is pruned');
  } finally {
    await cleanup(dir);
  }
});

test('pre-write blocks installed-skill and committed-memory writes', async () => {
  const dir = await installed();
  try {
    for (const p of [join(dir, '.cursor/skills/gspec-practices/SKILL.md'), join(dir, '.gspec/memory/gspec-practices.md')]) {
      const r = await runHook(dir, 'gspec-pre-write.mjs', { tool_name: 'Write', tool_input: { file_path: p, content: 'x' } });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json?.permission, 'deny', `${p} must be blocked`);
      assert.match(r.json.agent_message, /gspec-teach/);
    }
  } finally {
    await cleanup(dir);
  }
});

test('pre-write blocks an edit to a checked task, in every write shape, and allows the rest', async () => {
  const dir = await installed();
  try {
    const path = await withPlan(dir);
    const edits = [
      { file_path: path, content: PLAN.replace('Build the thing', 'Build it') },
      { file_path: path, old_string: 'Build the thing', new_string: 'Build it' },
      { path, edits: [{ old_string: '- [x] **T1**', new_string: '- [ ] **T1**' }] },
      JSON.stringify({ file_path: path, old_string: '  deps: none\n', new_string: '' }),
    ];
    for (const tool_input of edits) {
      const r = await runHook(dir, 'gspec-pre-write.mjs', { tool_name: 'Write', tool_input });
      assert.equal(r.json?.permission, 'deny', `must block ${JSON.stringify(tool_input)}`);
      assert.match(r.json.agent_message, /T1/);
    }

    const ok = [
      { file_path: path, old_string: '- [ ] **T2**', new_string: '- [x] **T2**' }, // checking off is allowed
      { file_path: path, something_unknown: true }, // unreadable shape fails open
      { file_path: join(dir, 'src', 'app.js'), content: 'x' },
      {},
    ];
    for (const tool_input of ok) {
      const r = await runHook(dir, 'gspec-pre-write.mjs', { tool_name: 'Write', tool_input });
      assert.deepEqual(r.json, { permission: 'allow' }, `must allow ${JSON.stringify(tool_input)}: ${r.stdout}`);
    }
  } finally {
    await cleanup(dir);
  }
});

test('pre-write answers allow, as valid JSON, on garbage input', async () => {
  const dir = await installed();
  try {
    const child = spawn(process.execPath, [join(dir, '.cursor', 'hooks', 'gspec-pre-write.mjs')], { cwd: dir });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const code = await new Promise((resolve) => { child.on('close', resolve); child.stdin.end('not json'); });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out), { permission: 'allow' });
  } finally {
    await cleanup(dir);
  }
});

test('post-write feeds spec-integrity findings back as additional_context', async () => {
  const dir = await installed();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    const path = join(dir, 'gspec', 'stack.md');
    await writeFile(path, '# Stack\n', 'utf-8');
    const r = await runHook(dir, 'gspec-post-write.mjs', { tool_name: 'Write', tool_input: { file_path: path } });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.json?.additional_context || '', /spec-integrity/);

    await writeFile(path, '---\nspec-version: v2\n---\n# Stack\n', 'utf-8');
    const clean = await runHook(dir, 'gspec-post-write.mjs', { tool_name: 'Write', tool_input: { file_path: path } });
    assert.deepEqual(clean.json, {});
  } finally {
    await cleanup(dir);
  }
});

test('stop: a checked task altered behind the pre-write hook is caught against the session baseline', async () => {
  const dir = await installed();
  const conversation_id = randomUUID();
  try {
    const path = await withPlan(dir);
    await runHook(dir, 'gspec-session-start.mjs', { conversation_id, session_id: conversation_id });
    await writeFile(path, PLAN.replace('Build the thing', 'Rewritten'), 'utf-8'); // e.g. via the shell

    const r = await runHook(dir, 'gspec-stop.mjs', { conversation_id, status: 'completed', loop_count: 0 });
    assert.match(r.json?.followup_message || '', /task-immutability[\s\S]*T1/);

    const capped = await runHook(dir, 'gspec-stop.mjs', { conversation_id, status: 'completed', loop_count: 3 });
    assert.deepEqual(capped.json, {}, 'must give up after the follow-up cap so a session is never trapped');

    const aborted = await runHook(dir, 'gspec-stop.mjs', { conversation_id, status: 'aborted', loop_count: 0 });
    assert.deepEqual(aborted.json, {}, 'a turn the user aborted is not nagged');
  } finally {
    await cleanup(dir);
  }
});

test('stop: source written with no spec update gets one reconcile nudge', async () => {
  const dir = await installed();
  const conversation_id = randomUUID();
  try {
    await mkdir(join(dir, 'gspec'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    const src = join(dir, 'src', 'app.js');
    await writeFile(src, 'export const x = 1;\n', 'utf-8');
    await runHook(dir, 'gspec-post-write.mjs', { conversation_id, tool_name: 'Write', tool_input: { file_path: src } });

    const r = await runHook(dir, 'gspec-stop.mjs', { conversation_id, status: 'completed', loop_count: 0 });
    assert.match(r.json?.followup_message || '', /gspec reconcile[\s\S]*src\/app\.js/);

    const again = await runHook(dir, 'gspec-stop.mjs', { conversation_id, status: 'completed', loop_count: 1 });
    assert.deepEqual(again.json, {}, 'the nudge is consumed — the follow-up turn stops cleanly');
  } finally {
    await cleanup(dir);
  }
});
