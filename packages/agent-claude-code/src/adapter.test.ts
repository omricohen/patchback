import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentContext } from '@patchback/agent-core';

import {
  createClaudeCodeAdapter,
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
