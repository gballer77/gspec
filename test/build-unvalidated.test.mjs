// A validator response with no VERDICT line is an ENGINE failure, not a finding.
//
// From a real run: the validator returned "API Error: Connection closed
// mid-response." The driver treated the missing verdict like a FAIL and sent the
// WRITER a revision prompt carrying that error as the defect to repair. A writer
// cannot repair a dropped connection, so the revision was pure waste — and when
// it changed nothing, the failure looked like the draft's fault.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, chmod, mkdir } from 'node:fs/promises';
import { runCli, makeProject, cleanup, seedInstall, FAKE_ENGINE_SH, STAGE_AGENTS } from './helpers.mjs';

const RUN_JSON = join('.gspec', 'build', 'run.json');

// A fake whose STACK validator never emits a verdict — every other stage passes.
const FAKE = `#!/bin/sh
${FAKE_ENGINE_SH}
case "$*" in
  *Validate*Technology\\ stack*|*Validate*stack.md*)
    printf 'API Error: Connection closed mid-response. The response above may be incomplete.\\n' ;;
  *Validate*) printf 'VERDICT: PASS\\nfine\\n' ;;
  *) fake_default "$*" ;;
esac
`;

test('an unparseable verdict retries the VALIDATOR and never bills the writer', async (t) => {
  const dir = await makeProject();
  t.after(() => cleanup(dir));
  await seedInstall(dir, 'pi', { agentFiles: STAGE_AGENTS.map((a) => join('.pi', 'agents', `${a}.md`)) });
  const bin = join(dir, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pi'), FAKE); await chmod(join(bin, 'pi'), 0o755);
  await mkdir(join(dir, '.gspec', 'build'), { recursive: true });
  await writeFile(join(dir, '.gspec', 'build', 'brief.md'), 'Product: a thing\nscope: small\n');
  // Seed the foundations that precede stack so the run reaches it quickly.
  await mkdir(join(dir, 'gspec'), { recursive: true });
  await writeFile(join(dir, 'gspec', 'profile.md'), '# P\n\nEnough content for the completeness check to pass.\n');

  const r = await runCli(['build', '--no-review', 'an idea'], dir, { PATH: `${bin}:${process.env.PATH}` });

  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /could not be validated/, 'the failure must name the real cause');
  assert.match(r.output, /engine error, not a finding/);
  // The writer must never have been asked to fix the transport error.
  assert.doesNotMatch(r.output, /QA flagged issues/, 'no revision should have been spent');
});
