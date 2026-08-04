// The build/test gate has to say it ran.
//
// It logged only on FAILURE, which left the two states that matter most
// indistinguishable: a run whose code compiled and whose tests all passed
// looked exactly like a run with no gate at all — silence, either way. On the
// dogfood run that set out to answer "does an autonomous build actually test a
// game?", the only way to tell was to check the timestamp on dist/.
//
// These drive the real driver against a real script, rather than asserting
// about the source, because "did it actually run?" is the whole question.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

const FAKE = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *feature-plan*) printf '\`\`\`json\\n{"features":[{"slug":"only-thing","title":"O","brief":"b","priority":"P0","dependencies":[]}]}\\n\`\`\`\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$*" ;;
esac
`;

async function seedProject(dir, { verify } = {}) {
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Product: a thing\nscope: small\n');
  await mkdir(join(dir, 'gspec'), { recursive: true });
  for (const f of ['profile.md', 'stack.md', 'practices.md', 'style.md', 'style.html']) {
    await writeFile(join(dir, 'gspec', f), 'seeded\n');
  }
  if (verify) {
    await writeFile(join(dir, 'verify.sh'), verify);
    await chmod(join(dir, 'verify.sh'), 0o755);
  }
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE);
  await chmod(join(bin, 'pi'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

test('a passing verify.sh says so, instead of passing in silence', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  // Leaves a marker, so the assertion rests on the script having really run
  // rather than on the driver's own claim about it.
  const env = await seedProject(dir, {
    verify: '#!/usr/bin/env bash\nset -euo pipefail\necho "OK: all modules verified"\ntouch ran-for-real\n',
  });

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);

  assert.match(r.output, /verify\.sh — building and running the tests/, 'the gate must announce itself');
  assert.match(r.output, /verify\.sh passed/, 'and report the outcome, not only failures');

  const { stat } = await import('node:fs/promises');
  await stat(join(dir, 'ran-for-real')); // throws if the script never ran
});

test('a project with no verify.sh is told it has no build/test gate', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  const env = await seedProject(dir); // no verify.sh

  const r = await runCli(['build', '--no-review', 'an idea'], dir, env);

  assert.match(
    r.output,
    /no verify\.sh — nothing deterministically checks/,
    'the absence of the gate is the one thing silence must never mean',
  );
  assert.doesNotMatch(r.output, /verify\.sh passed/, 'and nothing may claim it passed');
});
