/**
 * Phase 4 acceptance: given a local fixture repo and a task brief
 * ("change button label X to Y"), the pipeline produces a branch with a
 * correct minimal diff and passing checks — with the scratch dir cleaned up
 * afterwards. The agent is the fake CLI; the real-binary run lives in
 * e2e.test.ts behind PATCHBACK_E2E_CLAUDE=1.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkoutNewBranch,
  cloneRepository,
  currentBranch,
  detectAndRunChecks,
  runGit,
  scratchDirPath,
  withScratchDir,
  type AgentContext,
  type ChecksReport,
  type ExecutionResult,
} from '@patchback/agent-core';

import { createClaudeCodeAdapter } from './adapter.js';
import {
  BUTTON_FILE,
  createFixtureRepo,
  fakeCliPath,
  labelChangeBrief,
  NEW_LABEL,
  OLD_LABEL,
} from './fixture.js';

let targetRepoDir: string;
let scratchBaseDir: string;

beforeEach(async () => {
  targetRepoDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-target-'));
  scratchBaseDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-jobs-'));
  await createFixtureRepo(targetRepoDir);
});

afterEach(async () => {
  await rm(targetRepoDir, { recursive: true, force: true });
  await rm(scratchBaseDir, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('acceptance: fixture repo + label-change brief → branch, minimal diff, green checks', () => {
  it('runs the full pipeline with the fake CLI', async () => {
    const jobId = 'job-accept-1';
    const branchName = `patchback/${jobId}`;
    const adapter = createClaudeCodeAdapter({
      binaryPath: process.execPath,
      binaryArgs: [fakeCliPath()],
      cliFlags: ['-p', '--output-format', 'json'],
      env: { FAKE_CLAUDE_MODE: 'label-change' },
    });

    let execution!: ExecutionResult;
    let checks!: ChecksReport;
    let branchDuringRun = '';
    let diffDuringRun = '';

    await withScratchDir(
      jobId,
      async (scratchDir) => {
        const workDir = path.join(scratchDir, 'repo');
        await cloneRepository(targetRepoDir, workDir);
        await checkoutNewBranch(workDir, branchName);

        const ctx: AgentContext = { jobId, brief: labelChangeBrief(), workDir };
        await adapter.prepare(ctx);
        const plan = await adapter.plan(ctx);
        expect(plan.steps.length).toBeGreaterThan(0);

        execution = await adapter.execute(ctx);

        branchDuringRun = await currentBranch(workDir);
        diffDuringRun = await runGit(workDir, ['diff']);
        checks = await detectAndRunChecks(
          workDir,
          ctx.conventions?.scripts ?? {},
          {
            packageManager: ctx.conventions?.packageManager,
            timeoutMs: 60_000,
          },
        );

        const summary = await adapter.summarize(ctx);
        expect(summary.title).toContain(NEW_LABEL);
      },
      { baseDir: scratchBaseDir },
    );

    // The agent produced exactly the minimal, correct diff.
    expect(execution.success).toBe(true);
    expect(execution.changedFiles).toEqual([
      { path: BUTTON_FILE, additions: 1, deletions: 1, binary: false },
    ]);
    expect(execution.totalChangedLines).toBe(2);

    // ...on the job's branch...
    expect(branchDuringRun).toBe(branchName);
    expect(diffDuringRun).toContain(`-  label: '${OLD_LABEL}',`);
    expect(diffDuringRun).toContain(`+  label: '${NEW_LABEL}',`);

    // ...with the target repo's own checks passing (lint + test detected).
    expect(checks.ran.map((check) => check.name)).toEqual(['lint', 'test']);
    expect(checks.allPassed).toBe(true);

    // ...and the scratch dir is gone afterwards.
    expect(
      await exists(scratchDirPath(jobId, { baseDir: scratchBaseDir })),
    ).toBe(false);
  }, 60_000);

  it('cleans the scratch dir even when the agent fails mid-job', async () => {
    const jobId = 'job-accept-fail';
    const adapter = createClaudeCodeAdapter({
      binaryPath: process.execPath,
      binaryArgs: [fakeCliPath()],
      cliFlags: ['-p', '--output-format', 'json'],
      env: { FAKE_CLAUDE_MODE: 'crash' },
    });

    await expect(
      withScratchDir(
        jobId,
        async (scratchDir) => {
          const workDir = path.join(scratchDir, 'repo');
          await cloneRepository(targetRepoDir, workDir);
          await checkoutNewBranch(workDir, `patchback/${jobId}`);
          const ctx: AgentContext = {
            jobId,
            brief: labelChangeBrief(),
            workDir,
          };
          const result = await adapter.execute(ctx);
          expect(result.success).toBe(false);
          // Orchestrators treat a failed execution as a thrown job failure.
          throw new Error(`job failed: ${result.error}`);
        },
        { baseDir: scratchBaseDir },
      ),
    ).rejects.toThrow(/job failed/);

    expect(
      await exists(scratchDirPath(jobId, { baseDir: scratchBaseDir })),
    ).toBe(false);
  }, 60_000);
});
