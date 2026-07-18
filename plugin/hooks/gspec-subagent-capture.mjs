#!/usr/bin/env node
// gspec SubagentStop hook — feedback capture (model-free, passive).
//
// The learning loop's capture (T1) relies on a corrected agent choosing to
// self-record a lesson. This hook makes capture automatic and independent of
// that: when a subagent returns a FAILING QA verdict — the feedback signal a
// lesson should come from — it appends a compact record to a rolling log at
// .gspec/agent-runs/feedback-log.md. The distiller (/gspec-distill) reads that
// log alongside the agent memory silos as corroborating evidence of recurring
// failure modes. Feedback-driven (FAIL only), so it stays low-noise and
// consistent with the gspec-memory capture philosophy.
//
// Passive: always exit 0 — a capture hook must never disrupt a run. Fails OPEN.
// NOTE: SubagentStop is documented to fire on subagent (Task-tool) completion;
// whether it fires for the pipeline's headless `claude -p --agent` subprocesses
// is undocumented, so this mainly captures the interactive /gspec-* path. The
// pipeline has its own capture channel (verdicts in .gspec/pipeline/run.json).

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const MAX_EXCERPT = 800;

try {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, 'utf-8')); } catch { process.exit(0); }

  const msg = String(evt?.last_assistant_message || '');
  // Only capture the feedback signal: a validator/checker returning FAIL.
  if (!/VERDICT:\s*FAIL/i.test(msg)) process.exit(0);

  const agent = String(evt?.agent_type || 'unknown-agent').replace(/[^\w.-]/g, '_');
  const projectDir = process.env.CLAUDE_PROJECT_DIR || evt.cwd || process.cwd();
  const logPath = resolve(projectDir, '.gspec', 'agent-runs', 'feedback-log.md');

  const excerpt = msg.length > MAX_EXCERPT ? msg.slice(0, MAX_EXCERPT) + '\n…(truncated)' : msg;
  const stamp = new Date().toISOString();
  const entry = `## ${stamp} · ${agent}\n${excerpt.trim()}\n\n`;

  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, entry, 'utf-8');
  process.exit(0);
} catch {
  process.exit(0); // fail open — never disrupt a run
}
