// Cursor hook plumbing — parse a Cursor hook event and answer in Cursor's
// native response format. Every gspec Cursor hook imports this, so the reading
// of Cursor's payload lives once.
//
// Cursor's hooks differ from Claude Code's in two ways that matter here:
//   • the answer is JSON on stdout, not exit 2 + stderr: a pre-tool hook returns
//     `permission`/`agent_message`, a post-tool hook `additional_context`, the
//     stop hook `followup_message` (auto-submitted as the next user message);
//   • a permission hook whose stdout is not valid JSON BLOCKS the action, so
//     the pre-write hook prints an explicit allow on every non-blocking path —
//     a crash in a guard must never become a blocked write.
//
// Cursor folds Claude's Edit into its `Write` tool and does not document the
// tool_input shape for it, so the readers below accept every shape a write can
// plausibly carry (full content, a single replace, a list of replaces) and fall
// back to "unknown" rather than guess. The stop hook's full-tree scan is the
// backstop for any write these readers could not interpret.

import { readFileSync, writeSync } from 'node:fs';
import { resolve, relative } from 'node:path';

export function readEvent() {
  try { return JSON.parse(readFileSync(0, 'utf-8')) || {}; } catch { return {}; }
}

// The workspace root. CURSOR_PROJECT_DIR is documented as always present; the
// event's own fields cover a hook run outside Cursor (tests, a manual replay).
export function projectDir(evt) {
  return process.env.CURSOR_PROJECT_DIR || evt?.workspace_roots?.[0] || evt?.cwd || process.cwd();
}

// The id that stays fixed for a whole chat, so a session-start snapshot and the
// stop hook that reads it agree on the key.
export function sessionId(evt) {
  return evt?.conversation_id || evt?.session_id || 'nosession';
}

export function toolInput(evt) {
  const input = evt?.tool_input;
  if (typeof input === 'string') {
    try { return JSON.parse(input) || {}; } catch { return {}; }
  }
  return input && typeof input === 'object' ? input : {};
}

export function filePathOf(evt) {
  const input = toolInput(evt);
  return input.file_path ?? input.path ?? input.target_file ?? evt?.file_path ?? null;
}

// Project-relative, forward-slashed path of the file a write targets.
export function relPath(dir, filePath) {
  return relative(dir, resolve(dir, filePath)).replace(/\\/g, '/');
}

// The Claude-style tool name a write's input corresponds to, for the floor's
// projectedContent(): full content → Write, one replace → Edit, several →
// MultiEdit. null when the shape is not one we recognise.
export function writeShape(input) {
  if (typeof input.content === 'string') return 'Write';
  if (typeof input.contents === 'string') return 'Write';
  if (typeof input.old_string === 'string') return 'Edit';
  if (Array.isArray(input.edits)) return 'MultiEdit';
  return null;
}

// Normalise the input to the field names projectedContent() reads.
export function claudeShapedInput(input) {
  if (typeof input.content !== 'string' && typeof input.contents === 'string') {
    return { ...input, content: input.contents };
  }
  return input;
}

// writeSync, not process.stdout.write: stdout is a pipe, which Node writes
// asynchronously on macOS, and the exit that follows could cut the answer off —
// for a permission hook, a truncated answer is a blocked write.
function emit(obj) {
  writeSync(1, JSON.stringify(obj) + '\n');
  process.exit(0);
}

export const allow = () => emit({ permission: 'allow' });
export const deny = (message) => emit({ permission: 'deny', user_message: message, agent_message: message });
export const context = (message) => emit(message ? { additional_context: message } : {});
export const followup = (message) => emit(message ? { followup_message: message } : {});
export const none = () => emit({});
