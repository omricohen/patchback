import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentContext } from '@patchback/agent-core';

import {
  createClaudeCodeAdapter,
  DEFAULT_ISOLATION_FLAGS,
  DEFAULT_MAX_CHANGED_LINES,
} from './adapter.js';
import {
  BUTTON_FILE,
  createFixtureRepo,
  fakeCliPath,
  labelChangeBrief,
  NEW_LABEL,
} from './fixture.js';

let workDir: string;
let captureDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-adapter-test-'));
  captureDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-capture-'));
  await createFixtureRepo(workDir);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(captureDir, { recursive: true, force: true });
});

function makeContext(): AgentContext {
  return { jobId: 'job-test-1', brief: labelChangeBrief(), workDir };
}

/** Adapter wired to the fake CLI, scenario driven by env. */
function fakeAdapter(
  mode: string,
  extra?: {
    maxChangedLines?: number;
    timeoutMs?: number;
    env?: Record<string, string>;
  },
) {
  return createClaudeCodeAdapter({
    binaryPath: process.execPath,
    binaryArgs: [fakeCliPath()],
    cliFlags: ['-p', '--output-format', 'json'],
    ...(extra?.maxChangedLines !== undefined
      ? { maxChangedLines: extra.maxChangedLines }
      : {}),
    ...(extra?.timeoutMs !== undefined ? { timeoutMs: extra.timeoutMs } : {}),
    env: { FAKE_CLAUDE_MODE: mode, ...extra?.env },
  });
}

describe('createClaudeCodeAdapter', () => {
  it('has defaults: name, real binary, 300-line ceiling', () => {
    expect(createClaudeCodeAdapter().name).toBe('claude-code');
    expect(DEFAULT_MAX_CHANGED_LINES).toBe(300);
  });

  describe('prepare', () => {
    it('rejects a workDir that is not a git work tree', async () => {
      const bare = await mkdtemp(path.join(os.tmpdir(), 'patchback-nogit-'));
      try {
        const ctx: AgentContext = { ...makeContext(), workDir: bare };
        await expect(fakeAdapter('label-change').prepare(ctx)).rejects.toThrow(
          /not a git work tree/i,
        );
      } finally {
        await rm(bare, { recursive: true, force: true });
      }
    });

    it('fills ctx.conventions from the target repo', async () => {
      const ctx = makeContext();
      await fakeAdapter('label-change').prepare(ctx);
      expect(ctx.conventions?.packageManager).toBe('npm');
      expect(ctx.conventions?.scripts.test).toBe(
        'node scripts/check-button.mjs',
      );
      expect(ctx.conventions?.docs.readme).toContain('Fixture app');
    });
  });

  describe('plan', () => {
    it('produces auditable steps from the brief', async () => {
      const ctx = makeContext();
      const plan = await fakeAdapter('label-change').plan(ctx);
      expect(plan.steps.join('\n')).toContain(ctx.brief.title);
      expect(plan.steps.join('\n')).toContain(BUTTON_FILE);
    });
  });

  describe('execute (spawn logic against the fake CLI)', () => {
    it('makes the label change and reports a minimal diff', async () => {
      const promptCapture = path.join(captureDir, 'prompt.txt');
      const adapter = fakeAdapter('label-change', {
        env: { FAKE_CLAUDE_PROMPT_CAPTURE: promptCapture },
      });
      const ctx = makeContext();
      await adapter.prepare(ctx);
      const result = await adapter.execute(ctx);

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.changedFiles).toEqual([
        { path: BUTTON_FILE, additions: 1, deletions: 1, binary: false },
      ]);
      expect(result.totalChangedLines).toBe(2);
      expect(result.agentOutput).toContain('Changed label');

      const changed = await readFile(path.join(workDir, BUTTON_FILE), 'utf8');
      expect(changed).toContain(NEW_LABEL);

      // The structured brief reached the CLI via stdin.
      const prompt = await readFile(promptCapture, 'utf8');
      expect(prompt).toContain(`# Task: ${ctx.brief.title}`);
      expect(prompt).toContain('- src/button.js');
      expect(prompt).toContain('under 300 changed lines');
      expect(prompt).toContain('Package manager: npm');
    });

    it('fails with a triage-pointing message when the diff exceeds the ceiling', async () => {
      const adapter = fakeAdapter('huge-diff');
      const ctx = makeContext();
      const result = await adapter.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/diff too large/i);
      expect(result.error).toMatch(/ceiling of 300/);
      expect(result.error).toMatch(/triage/i);
      expect(result.totalChangedLines).toBeGreaterThan(300);
    });

    it('honors a configured ceiling', async () => {
      const adapter = fakeAdapter('label-change', { maxChangedLines: 1 });
      const result = await adapter.execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ceiling of 1/);
    });

    it('fails when the agent changes nothing', async () => {
      const result = await fakeAdapter('no-op').execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/without changing any files/i);
    });

    it('trusts the diff over unparsable CLI output', async () => {
      const result = await fakeAdapter('garbage').execute(makeContext());
      expect(result.success).toBe(true);
      expect(result.totalChangedLines).toBe(2);
    });

    it('surfaces CLI-reported errors with the output tail', async () => {
      const result = await fakeAdapter('cli-error').execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exit 1/);
      expect(result.error).toContain('unable to complete');
    });

    it('surfaces hard crashes (non-zero exit, no JSON)', async () => {
      const result = await fakeAdapter('crash').execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exit 2/);
      expect(result.error).toContain('segfault (not really)');
    });

    it('kills a hung CLI at the timeout', async () => {
      const result = await fakeAdapter('hang', { timeoutMs: 2_000 }).execute(
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timed out after 2000ms/i);
    }, 20_000);

    it('fails helpfully when the binary cannot be spawned', async () => {
      const adapter = createClaudeCodeAdapter({
        binaryPath: '/nonexistent/claude-code-binary',
      });
      const result = await adapter.execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/could not spawn/i);
      expect(result.error).toMatch(/installed and on PATH/i);
    });
  });

  describe('spawn isolation (privacy boundary)', () => {
    const CALLER_CONFIG_DIR = '/tmp/patchback-test-caller-claude-config';

    /** Run one fake-CLI execute and return what it was spawned with. */
    async function captureSpawn(extraEnv?: Record<string, string>): Promise<{
      argv: string[];
      env: Record<string, string | undefined>;
      claudeConfigDirExists: boolean;
    }> {
      const capturePath = path.join(captureDir, 'spawn.json');
      const adapter = fakeAdapter('label-change', {
        env: { FAKE_CLAUDE_SPAWN_CAPTURE: capturePath, ...extraEnv },
      });
      const result = await adapter.execute(makeContext());
      expect(result.success).toBe(true);
      return JSON.parse(await readFile(capturePath, 'utf8')) as {
        argv: string[];
        env: Record<string, string | undefined>;
        claudeConfigDirExists: boolean;
      };
    }

    it("spawns with a per-job empty CLAUDE_CONFIG_DIR, never the caller's, and no env leakage", async () => {
      const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
      const savedCanary = process.env.PATCHBACK_TEST_CANARY;
      process.env.CLAUDE_CONFIG_DIR = CALLER_CONFIG_DIR;
      process.env.PATCHBACK_TEST_CANARY = 'must-not-leak';
      try {
        const spawned = await captureSpawn();
        // Isolated config dir: set, existed during the run, per-job temp —
        // NOT the caller's global one.
        expect(spawned.env.CLAUDE_CONFIG_DIR).toBeDefined();
        expect(spawned.env.CLAUDE_CONFIG_DIR).not.toBe(CALLER_CONFIG_DIR);
        expect(spawned.env.CLAUDE_CONFIG_DIR).toContain(
          'patchback-claude-cfg-',
        );
        expect(spawned.claudeConfigDirExists).toBe(true);
        // Allowlisted env only: arbitrary caller variables never reach the
        // CLI; the essentials do.
        expect(spawned.env.PATCHBACK_TEST_CANARY).toBeUndefined();
        expect(spawned.env.PATH).toBe(process.env.PATH);
      } finally {
        if (savedConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR;
        } else {
          process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
        }
        if (savedCanary === undefined) {
          delete process.env.PATCHBACK_TEST_CANARY;
        } else {
          process.env.PATCHBACK_TEST_CANARY = savedCanary;
        }
      }
    });

    it('appends the hook/plugin-disabling isolation flags to the invocation', async () => {
      const spawned = await captureSpawn();
      expect(DEFAULT_ISOLATION_FLAGS).toEqual([
        '--bare',
        '--strict-mcp-config',
      ]);
      for (const flag of DEFAULT_ISOLATION_FLAGS) {
        expect(spawned.argv).toContain(flag);
      }
    });

    it('passes ANTHROPIC_API_KEY from the adapter env through to the CLI', async () => {
      const spawned = await captureSpawn({
        ANTHROPIC_API_KEY: 'test-placeholder-not-a-real-key',
      });
      expect(spawned.env.ANTHROPIC_API_KEY).toBe(
        'test-placeholder-not-a-real-key',
      );
    });

    it('deletes the per-job config dir after the run', async () => {
      const spawned = await captureSpawn();
      await expect(
        stat(spawned.env.CLAUDE_CONFIG_DIR as string),
      ).rejects.toThrow();
    });

    it('drops artifacts a hook wrote into a new dot-dir; keeps the real change', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const adapter = fakeAdapter('dotdir-artifacts');
        const result = await adapter.execute(makeContext());
        expect(result.success).toBe(true);
        expect(result.changedFiles).toEqual([
          { path: BUTTON_FILE, additions: 1, deletions: 1, binary: false },
        ]);
        const warned = warnSpy.mock.calls
          .map((call) => call.join(' '))
          .join('\n');
        expect(warned).toContain('.a5c/');
        expect(warned).toMatch(/will not be committed/i);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('summarize', () => {
    it('summarizes a successful run for the PR body', async () => {
      const adapter = fakeAdapter('label-change');
      const ctx = makeContext();
      await adapter.prepare(ctx);
      await adapter.execute(ctx);
      const summary = await adapter.summarize(ctx);
      expect(summary.title).toBe(ctx.brief.title);
      expect(summary.body).toContain(BUTTON_FILE);
      expect(summary.body).toContain('+1 / -1');
      expect(summary.body).toContain('Feedback: feedback-fixture-1');
      expect(summary.body).toMatch(/human review required/i);
      expect(summary.body).toMatch(/never merges/i);
    });

    it('summarizes a failed run with the failure reason', async () => {
      const adapter = fakeAdapter('huge-diff');
      const ctx = makeContext();
      await adapter.execute(ctx);
      const summary = await adapter.summarize(ctx);
      expect(summary.body).toMatch(/diff too large/i);
    });
  });
});
