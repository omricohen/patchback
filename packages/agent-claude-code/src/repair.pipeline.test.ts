/**
 * v0.2 Phase 2 acceptance: the bounded, one-attempt repair loop, exercised
 * end-to-end with the real claude-code adapter, the fake CLI, and the real
 * check-runner via agent-core's `executeWithRepair`. The fake CLI is scripted
 * (via a persistent counter file) to emit different diffs on the first vs the
 * repair invocation.
 *
 * Four scenarios:
 *  (a) fail-then-fix       → checks pass after one repair → committable
 *  (b) fail-then-fail      → patch.failed, BOTH check outputs preserved
 *  (c) repair-exceeds-cap  → cumulative diff blows the ceiling during repair
 *  (d) repair disabled     → immediate failure, exactly one CLI invocation
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkoutNewBranch,
  cloneRepository,
  detectAndRunChecks,
  executeWithRepair,
  withScratchDir,
  type AgentContext,
  type ChecksReport,
  type ExecuteWithRepairOutcome,
} from '@patchback/agent-core';

import { createClaudeCodeAdapter } from './adapter.js';
import {
  BUTTON_FILE,
  createFixtureRepo,
  fakeCliPath,
  labelChangeBrief,
  NEW_LABEL,
} from './fixture.js';

let targetRepoDir: string;
let scratchBaseDir: string;
let controlDir: string; // counter + captured prompts live OUTSIDE the scratch dir

beforeEach(async () => {
  targetRepoDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-target-'));
  scratchBaseDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-jobs-'));
  controlDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-ctl-'));
  await createFixtureRepo(targetRepoDir);
});

afterEach(async () => {
  await rm(targetRepoDir, { recursive: true, force: true });
  await rm(scratchBaseDir, { recursive: true, force: true });
  await rm(controlDir, { recursive: true, force: true });
});

interface ScenarioResult {
  outcome: ExecuteWithRepairOutcome;
  finalChecks: ChecksReport;
  buttonContent: string;
}

/** Run one repair scenario through the real adapter + fake CLI + check-runner. */
async function runScenario(
  mode: string,
  opts: { repairEnabled?: boolean } = {},
): Promise<ScenarioResult> {
  const counterPath = path.join(controlDir, 'counter');
  const promptDir = path.join(controlDir, 'prompts');
  const adapter = createClaudeCodeAdapter({
    binaryPath: process.execPath,
    binaryArgs: [fakeCliPath()],
    cliFlags: ['-p', '--output-format', 'json'],
    env: {
      FAKE_CLAUDE_MODE: mode,
      FAKE_CLAUDE_COUNTER: counterPath,
      FAKE_CLAUDE_PROMPT_DIR: promptDir,
    },
  });

  let captured!: ScenarioResult;
  await withScratchDir(
    'job-repair',
    async (scratchDir) => {
      const workDir = path.join(scratchDir, 'repo');
      await cloneRepository(targetRepoDir, workDir);
      await checkoutNewBranch(workDir, 'patchback/job-repair');

      const ctx: AgentContext = {
        jobId: 'job-repair',
        brief: labelChangeBrief(),
        workDir,
      };
      await adapter.prepare(ctx);

      const outcome = await executeWithRepair({
        adapter,
        ctx,
        runChecks: () =>
          detectAndRunChecks(workDir, ctx.conventions?.scripts ?? {}, {
            ...(ctx.conventions?.packageManager !== undefined
              ? { packageManager: ctx.conventions.packageManager }
              : {}),
            timeoutMs: 60_000,
          }),
        ...(opts.repairEnabled !== undefined
          ? { repairEnabled: opts.repairEnabled }
          : {}),
      });

      captured = {
        outcome,
        finalChecks: outcome.checks ?? {
          ran: [],
          skipped: [],
          allPassed: false,
        },
        buttonContent: await readFile(path.join(workDir, BUTTON_FILE), 'utf8'),
      };
    },
    { baseDir: scratchBaseDir },
  );
  return captured;
}

async function invocationCount(): Promise<number> {
  const raw = await readFile(path.join(controlDir, 'counter'), 'utf8');
  return Number.parseInt(raw.trim(), 10);
}

describe('bounded repair loop (fake CLI)', () => {
  it('(a) fail-then-fix: repair makes the checks pass → job proceeds', async () => {
    const { outcome, buttonContent } = await runScenario('repair-fix');

    expect(outcome.ok).toBe(true);
    expect(outcome.repairAttempts).toBe(1);
    expect(outcome.checks?.allPassed).toBe(true);
    expect(outcome.execution.success).toBe(true);
    // Exactly two CLI invocations: the original and the one repair.
    expect(await invocationCount()).toBe(2);
    // The repair produced the correct label; cumulative diff stays tiny.
    expect(buttonContent).toContain(`label: '${NEW_LABEL}'`);

    // The repair invocation's prompt carried the failing-check feedback.
    const repairPrompt = await readFile(
      path.join(controlDir, 'prompts', 'prompt-2.txt'),
      'utf8',
    );
    expect(repairPrompt).toContain('failed the repo checks');
    expect(repairPrompt).toContain('### Failing check:');
    expect(repairPrompt).toMatch(/button label missing/);
  }, 60_000);

  it('(b) fail-then-fail: patch.failed with BOTH check outputs preserved', async () => {
    const { outcome } = await runScenario('repair-fail');

    expect(outcome.ok).toBe(false);
    expect(outcome.repairAttempts).toBe(1);
    expect(await invocationCount()).toBe(2);
    expect(outcome.error).toContain('after 1 automated repair attempt');
    expect(outcome.error).toContain('Failing checks BEFORE repair:');
    expect(outcome.error).toContain('Failing checks AFTER repair:');
    // The tool output (from the repo's check) is preserved in the error.
    expect(outcome.error).toMatch(/button label missing/);
  }, 60_000);

  it('(c) repair exceeding the ceiling fails with the ceiling message', async () => {
    const { outcome } = await runScenario('repair-exceed');

    expect(outcome.ok).toBe(false);
    expect(outcome.repairAttempts).toBe(1);
    expect(await invocationCount()).toBe(2);
    expect(outcome.error).toContain('Diff too large');
    // ...and it is attributed to the repair, i.e. the CUMULATIVE diff.
    expect(outcome.error).toContain('automated repair attempt');
    expect(outcome.execution.success).toBe(false);
  }, 60_000);

  it('(d) repair disabled: immediate failure, no second invocation', async () => {
    const { outcome } = await runScenario('repair-fix', {
      repairEnabled: false,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.repairAttempts).toBe(0);
    // Exactly ONE CLI invocation — repair never ran.
    expect(await invocationCount()).toBe(1);
    expect(outcome.error).toContain('target repo checks failed');
  }, 60_000);
});
