// The Cursor engine end to end: `gspec build` on a project installed for
// Cursor drives every stage through Cursor's headless `agent` CLI. The fake
// `agent` behaves like the real one in the two ways the adapter depends on —
// it only applies edits under --force, and it answers with a JSON result
// object rather than plain text — so a build that completes proves the
// adapter passes the right flags, injects the agent's persona, and reads the
// VERDICT out of the JSON envelope.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

const FAKE_AGENT = `#!/bin/sh
${FAKE_ENGINE_SH}
printf '%s\\n' "$@" >> "$ARGV_LOG"
case " $* " in
  *" --force "*) ;;
  *) echo "print mode without --force only proposes changes" >&2; exit 1 ;;
esac
reply() { node -e 'process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: require("fs").readFileSync(0, "utf8"), session_id: "s" }))'; }
case "$*" in
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' | reply ;;
  *) fake_default "$*" | reply ;;
esac
`;

test('a Cursor-installed project builds end to end on the agent CLI', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'cursor', { agentFiles: STAGE_AGENTS.map((a) => join('.cursor', 'agents', `${a}.md`)) });
  await writeFile(join(dir, '.gspec', 'config.json'), JSON.stringify({
    target: 'cursor',
    models: { default: 'MODEL-DEF' },
  }) + '\n');
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Build a tiny demo API.\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'agent'), FAKE_AGENT);
  await chmod(join(bin, 'agent'), 0o755);
  const argvLog = join(dir, 'argv.log');

  const r = await runCli(['build', '--no-review', 'an idea'], dir, {
    PATH: `${bin}:${process.env.PATH}`, ARGV_LOG: argvLog,
  });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /engine: cursor/);

  const argv = await readFile(argvLog, 'utf-8');
  for (const flag of ['-p', '--output-format', 'json', '--force', '--trust', '--model', 'MODEL-DEF']) {
    assert.ok(argv.split('\n').includes(flag), `every stage must pass ${flag}`);
  }
  assert.match(argv, /agent body[\s\S]*Your task for this run:/, 'the installed agent body must be injected ahead of the stage prompt');
});

// The build's VERDICT parser also finds a verdict inside the raw JSON envelope,
// so the end-to-end run above would pass without the unwrap. Pin it directly:
// the adapter hands back the message itself, and a failure's raw output intact.
test('the cursor adapter returns the JSON result as the message, and raw output on failure', async (t) => {
  const { ENGINES } = await import('../lib/engines.js');
  const dir = await makeProject();
  const savedPath = process.env.PATH;
  t.after(async () => { process.env.PATH = savedPath; await cleanup(dir); });
  await seedInstall(dir, 'cursor', { agentFiles: ['.cursor/agents/stack-writer.md'] });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'agent'), `#!/bin/sh
case "$*" in
  *FAIL*) printf 'not json: auth expired\\n'; exit 1 ;;
  *) printf '%s' '{"type":"result","subtype":"success","is_error":false,"result":"the message","session_id":"s"}' ;;
esac
`);
  await chmod(join(bin, 'agent'), 0o755);
  process.env.PATH = `${bin}:${savedPath}`;
  const ctx = { cwd: dir, log: () => {} };

  const ok = await ENGINES.cursor.runAgent('stack-writer', 'write it', ctx);
  assert.equal(ok.code, 0);
  assert.equal(ok.text, 'the message');

  const bad = await ENGINES.cursor.runAgent('stack-writer', 'FAIL', ctx);
  assert.equal(bad.code, 1);
  assert.match(bad.text, /auth expired/);
});
