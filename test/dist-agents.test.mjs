// Dist invariants: every agent the build's stage graph references must be
// emitted for every engine target, in the format that engine's adapter reads
// at runtime. Catches the regression where a stage names an agent (e.g.
// profile-writer) that a target's emitter no longer produces — which today
// only surfaces mid-build as "agent file not found".
//
// Requires dist/ to be built (npm test runs the build first via pretest).

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { STAGES } from '../lib/build.js';
import { ENGINES } from '../lib/engines.js';
import { REPO_ROOT, exists } from './helpers.mjs';

const AGENT_EXT = { claude: '.md', codex: '.toml', pi: '.md' };

const stageAgents = [...new Set(
  STAGES.flatMap((s) => [s.writer, s.validator, s.agent, s.orchestrator]).filter(Boolean)
)];

test('the stage graph references at least the known core agents', () => {
  assert.ok(stageAgents.length >= 10, `unexpectedly few stage agents: ${stageAgents.join(', ')}`);
  assert.ok(stageAgents.includes('profile-writer'));
  assert.ok(stageAgents.includes('implementer'));
});

for (const engine of Object.keys(ENGINES)) {
  test(`dist/${engine} emits every agent the build stages reference`, async () => {
    const ext = AGENT_EXT[engine];
    const missing = [];
    for (const name of stageAgents) {
      if (!(await exists(join(REPO_ROOT, 'dist', engine, 'agents', `${name}${ext}`)))) {
        missing.push(`${name}${ext}`);
      }
    }
    assert.deepEqual(missing, [], `dist/${engine}/agents is missing: ${missing.join(', ')}`);
  });

  test(`${engine} adapter resolves agent files where the installer puts them`, () => {
    const installedDir = { claude: '.claude', codex: '.codex', pi: '.pi' }[engine];
    const path = ENGINES[engine].agentFile('profile-writer');
    assert.equal(path, join(installedDir, 'agents', `profile-writer${AGENT_EXT[engine]}`));
  });
}
