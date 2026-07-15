import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  diffNumstat,
  isGitWorkTree,
  readRepoConventions,
  runProcess,
  totalChangedLines,
  type AgentAdapter,
  type AgentContext,
  type AgentPlan,
  type AgentSummary,
  type ExecutionResult,
} from '@patchback/agent-core';

import { buildPrompt } from './prompt.js';
import { parseCliOutput } from './result.js';

/** Default ceiling: a patchable item should be a small, focused change. */
export const DEFAULT_MAX_CHANGED_LINES = 300;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OUTPUT_TAIL_CHARS = 4000;

/**
 * Flag-level isolation for the spawned CLI (Claude Code >= 2.1):
 *
 * - `--bare` — skip hooks, plugin sync, LSP, auto-memory, keychain reads,
 *   and CLAUDE.md auto-discovery; auth is strictly ANTHROPIC_API_KEY.
 * - `--strict-mcp-config` — ignore every MCP server not explicitly passed
 *   via `--mcp-config` (we pass none).
 *
 * Why this matters: without isolation the CLI inherits the machine's GLOBAL
 * Claude Code configuration, and globally installed hooks/plugins can write
 * their state (caches, logs with machine-local absolute paths) into the
 * scratch clone — which the changed-file sweep would then publish into a
 * real PR. Env-level isolation (per-job empty CLAUDE_CONFIG_DIR, allowlisted
 * environment) stays on even when these flags are overridden.
 */
export const DEFAULT_ISOLATION_FLAGS = ['--bare', '--strict-mcp-config'];

/**
 * The only variables the spawned CLI inherits from the parent process.
 * Everything else (including the caller's CLAUDE_CONFIG_DIR) is dropped;
 * adapter `env` options are merged on top, and CLAUDE_CONFIG_DIR is always
 * forced to the per-job directory last.
 */
const INHERITED_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  // Windows process bootstrap essentials.
  'USERPROFILE',
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  // Auth passthrough — with --bare this is the only accepted auth source.
  'ANTHROPIC_API_KEY',
];

/** Minimal, allowlisted environment for the spawned CLI. */
function buildIsolatedEnv(
  configDir: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV_VARS) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return { ...env, ...extra, CLAUDE_CONFIG_DIR: configDir };
}

export interface ClaudeCodeAdapterOptions {
  /**
   * Path to the CLI binary. Default `claude` (resolved via PATH). Tests
   * inject `process.execPath` here with the fake CLI script in `binaryArgs`.
   */
  binaryPath?: string;
  /** Args placed before the CLI flags (e.g. a script path when binaryPath is node). */
  binaryArgs?: string[];
  /**
   * CLI flags for a headless run. Default:
   * `-p --output-format json --permission-mode acceptEdits`.
   */
  cliFlags?: string[];
  /**
   * Flags appended after `cliFlags` that cut the spawned CLI off from the
   * machine's global configuration (hooks, plugins, MCP servers). Default
   * {@link DEFAULT_ISOLATION_FLAGS}. Override only for CLI versions that
   * lack them — the env-level isolation (per-job CLAUDE_CONFIG_DIR plus an
   * allowlisted environment) applies regardless.
   */
  isolationFlags?: string[];
  /**
   * Diff-size ceiling in changed lines (additions + deletions). Exceeding it
   * fails the job: a bigger diff means triage was wrong, not that the agent
   * should try harder. Default {@link DEFAULT_MAX_CHANGED_LINES}.
   */
  maxChangedLines?: number;
  /** Kill the CLI after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** Extra environment for the CLI process (e.g. ANTHROPIC_API_KEY). */
  env?: Record<string, string>;
}

interface JobRunState {
  execution?: ExecutionResult;
}

/**
 * The default Patchback adapter: spawns the Claude Code CLI headless against
 * the job's scratch working copy with a structured prompt built from the task
 * brief. `@patchback/agent-core` stays vendor-neutral; everything
 * Claude-Code-specific lives here.
 */
export function createClaudeCodeAdapter(
  options?: ClaudeCodeAdapterOptions,
): AgentAdapter {
  const binaryPath = options?.binaryPath ?? 'claude';
  const binaryArgs = options?.binaryArgs ?? [];
  const cliFlags = options?.cliFlags ?? [
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'acceptEdits',
  ];
  const isolationFlags = options?.isolationFlags ?? DEFAULT_ISOLATION_FLAGS;
  const maxChangedLines = options?.maxChangedLines ?? DEFAULT_MAX_CHANGED_LINES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Per-job state, keyed by context identity (one ctx flows through a job).
  const runState = new WeakMap<AgentContext, JobRunState>();
  const stateFor = (ctx: AgentContext): JobRunState => {
    let state = runState.get(ctx);
    if (state === undefined) {
      state = {};
      runState.set(ctx, state);
    }
    return state;
  };

  const fail = (
    ctx: AgentContext,
    error: string,
    partial?: Partial<ExecutionResult>,
  ): ExecutionResult => {
    const execution: ExecutionResult = {
      success: false,
      changedFiles: [],
      totalChangedLines: 0,
      error,
      ...partial,
    };
    stateFor(ctx).execution = execution;
    return execution;
  };

  return {
    name: 'claude-code',

    async prepare(ctx) {
      if (!(await isGitWorkTree(ctx.workDir))) {
        throw new Error(
          `workDir is not a git work tree: ${ctx.workDir}. ` +
            'Clone the target repo into the scratch dir before prepare().',
        );
      }
      ctx.conventions ??= await readRepoConventions(ctx.workDir);
    },

    async plan(ctx) {
      const plan: AgentPlan = {
        steps: [
          `Read the task brief: ${ctx.brief.title}`,
          ctx.brief.fileHints.length > 0
            ? `Inspect hinted files: ${ctx.brief.fileHints.join(', ')}`
            : 'Locate the code responsible for the described behavior',
          `Apply the minimal change (ceiling: ${maxChangedLines} changed lines)`,
          'Leave the change uncommitted for diff review and checks',
        ],
        notes:
          'Executed headless via the Claude Code CLI; the diff and the ' +
          'check-runner are the source of truth for success.',
      };
      return plan;
    },

    async execute(ctx) {
      const prompt = buildPrompt(ctx.brief, ctx.conventions, maxChangedLines);
      const args = [...binaryArgs, ...cliFlags, ...isolationFlags];

      // Per-job empty config dir: the CLI must never see the machine's
      // global Claude Code configuration (hooks, plugins, settings). Created
      // fresh per run, deleted after — nothing accumulates.
      const configDir = await mkdtemp(
        path.join(os.tmpdir(), 'patchback-claude-cfg-'),
      );
      let outcome;
      try {
        outcome = await runProcess(binaryPath, args, {
          cwd: ctx.workDir,
          timeoutMs,
          input: prompt,
          inheritEnv: false,
          env: buildIsolatedEnv(configDir, options?.env),
        });
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }

      if (outcome.spawnError !== undefined) {
        return fail(
          ctx,
          `Could not spawn the Claude Code CLI ("${binaryPath}"): ` +
            `${outcome.spawnError}. Is Claude Code installed and on PATH, ` +
            'or is binaryPath pointing at the right binary?',
        );
      }
      if (outcome.timedOut) {
        return fail(
          ctx,
          `Claude Code CLI timed out after ${timeoutMs}ms and was killed. ` +
            'The scratch dir will be discarded; nothing was committed.',
        );
      }

      const parsed = parseCliOutput(outcome.stdout);
      const outputTail = parsed.resultText.slice(-DEFAULT_OUTPUT_TAIL_CHARS);

      if (outcome.exitCode !== 0 || parsed.isError) {
        const detail = (parsed.resultText || outcome.stderr).slice(
          -DEFAULT_OUTPUT_TAIL_CHARS,
        );
        return fail(
          ctx,
          `Claude Code CLI reported failure (exit ${outcome.exitCode ?? 'signal'}). ` +
            `Output tail:\n${detail}`,
          { agentOutput: outputTail },
        );
      }

      const changedFiles = await diffNumstat(ctx.workDir);
      const changedLines = totalChangedLines(changedFiles);

      if (changedFiles.length === 0) {
        return fail(
          ctx,
          'The agent finished without changing any files. Nothing to turn ' +
            'into a PR — the feedback may need clarification or a human.',
          { agentOutput: outputTail },
        );
      }

      if (changedLines > maxChangedLines) {
        return fail(
          ctx,
          `Diff too large: ${changedLines} changed lines across ` +
            `${changedFiles.length} file(s) exceeds the ceiling of ` +
            `${maxChangedLines}. A patchable feedback item should be a ` +
            'small, focused change — a diff this size usually means triage ' +
            'misclassified the item. Failing the job; route this feedback ' +
            'to a human instead of retrying.',
          {
            changedFiles,
            totalChangedLines: changedLines,
            agentOutput: outputTail,
          },
        );
      }

      const execution: ExecutionResult = {
        success: true,
        changedFiles,
        totalChangedLines: changedLines,
        agentOutput: outputTail,
      };
      stateFor(ctx).execution = execution;
      return execution;
    },

    async summarize(ctx) {
      const execution = stateFor(ctx).execution;
      const bodyParts: string[] = [ctx.brief.description, ''];

      if (ctx.brief.feedbackId !== undefined) {
        bodyParts.push(`Feedback: ${ctx.brief.feedbackId}`, '');
      }

      if (execution?.success === true) {
        bodyParts.push('## Changes');
        for (const file of execution.changedFiles) {
          bodyParts.push(
            `- \`${file.path}\` (+${file.additions} / -${file.deletions}${
              file.binary ? ', binary' : ''
            })`,
          );
        }
        bodyParts.push(
          '',
          `Total: ${execution.totalChangedLines} changed line(s).`,
        );
        if (
          execution.agentOutput !== undefined &&
          execution.agentOutput !== ''
        ) {
          bodyParts.push('', '## Agent notes', execution.agentOutput);
        }
      } else if (execution !== undefined) {
        bodyParts.push('## Outcome', execution.error ?? 'Execution failed.');
      }

      bodyParts.push(
        '',
        '---',
        'Generated by Patchback (claude-code adapter). Human review required — Patchback never merges.',
      );

      const summary: AgentSummary = {
        title: ctx.brief.title,
        body: bodyParts.join('\n'),
      };
      return summary;
    },
  };
}
