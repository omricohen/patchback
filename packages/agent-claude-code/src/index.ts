/**
 * @patchback/agent-claude-code — the default agent adapter.
 *
 * Spawns the Claude Code CLI headless (`claude -p --output-format json`)
 * against a job's scratch working copy with a structured prompt built from
 * the task brief, then judges the run by its git diff: no changes fails,
 * a diff over the ceiling fails (triage was wrong), and only a small,
 * focused diff proceeds toward a PR.
 */
export {
  createClaudeCodeAdapter,
  DEFAULT_MAX_CHANGED_LINES,
  type ClaudeCodeAdapterOptions,
} from './adapter.js';
export { buildPrompt } from './prompt.js';
export { parseCliOutput, type ParsedCliResult } from './result.js';
