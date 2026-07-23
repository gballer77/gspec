// Per-target install integration tests: `gspec -t <target>` into a fresh temp
// project must produce that target's layout, record the target in
// .gspec/config.json, and append the preamble to the right rules file.
// These drive out the class of bug where one platform's install silently
// diverges from what the build/runtime later expects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { runCli, makeProject, cleanup, exists } from './helpers.mjs';

// Per target: the files that prove the install landed where the runtime and
// harness will look. Agent paths for claude/codex/pi must match what
// lib/engines.js agentFile() resolves at build time.
const TARGETS = {
  claude: {
    files: ['.claude/agents/profile-writer.md', '.claude/commands/gspec-build.md', '.claude/skills'],
    rulesFile: 'CLAUDE.md',
  },
  codex: {
    files: ['.codex/agents/profile-writer.toml', '.agents/skills'],
    rulesFile: 'AGENTS.md',
  },
  pi: {
    files: ['.pi/agents/profile-writer.md', '.pi/prompts/gspec-build.md', '.pi/skills'],
    rulesFile: 'AGENTS.md',
  },
  cursor: {
    files: ['.cursor/agents', '.cursor/commands', '.cursor/skills'],
    rulesFile: '.cursor/rules/gspec.mdc',
  },
  antigravity: {
    files: ['.agents'],
    rulesFile: '.agents/rules/gspec.md',
  },
  opencode: {
    files: ['.opencode'],
    rulesFile: 'AGENTS.md',
  },
};

for (const [target, expected] of Object.entries(TARGETS)) {
  test(`install -t ${target}: layout, recorded target, preamble`, async (t) => {
    const dir = await makeProject();
    t.after(() => cleanup(dir));

    const r = await runCli(['-t', target], dir);
    assert.equal(r.code, 0, `install exited ${r.code}:\n${r.output}`);

    for (const rel of expected.files) {
      assert.ok(await exists(join(dir, rel)), `expected ${rel} after install -t ${target}`);
    }

    const config = JSON.parse(await readFile(join(dir, '.gspec', 'config.json'), 'utf-8'));
    assert.equal(config.target, target, 'install must record its target for later commands');

    const rules = await readFile(join(dir, expected.rulesFile), 'utf-8');
    assert.match(rules, /gspec/, `${expected.rulesFile} should carry the gspec preamble`);
    assert.match(rules, /not shell programs/, 'preamble must warn that gspec-* are not shell binaries');
  });
}
