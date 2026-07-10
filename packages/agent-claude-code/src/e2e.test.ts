/**
 * Env-gated end-to-end run against a REAL Claude Code binary.
 *
 * Skipped (cleanly, as "skipped") unless PATCHBACK_E2E_CLAUDE=1. Requires:
 *   - the `claude` CLI installed (or PATCHBACK_E2E_CLAUDE_BIN pointing at it)
 *   - working Claude Code auth (ANTHROPIC_API_KEY or `claude` login)
 *
 * Run: PATCHBACK_E2E_CLAUDE=1 pnpm --filter @patchback/agent-claude-code test
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkoutNewBranch,
  cloneRepository,
  detectAndRunChecks,
  withScratchDir,
  type AgentContext,
} from '@patchback/agent-core';

import { createClaudeCodeAdapter } from './adapter.js';
import {
  BUTTON_FILE,
  createFixtureRepo,
  labelChangeBrief,
  NEW_LABEL,
} from './fixture.js';

const enabled = process.env.PATCHBACK_E2E_CLAUDE === '1';

describe.skipIf(!enabled)('e2e: real Claude Code CLI (env-gated)', () => {
  // NOTE: this factory also runs at collection time when the suite is
  // skipped, so nothing here may throw unless the gate is on.
  let targetRepoDir = '';
  let scratchBaseDir = '';

  beforeAll(async () => {
    targetRepoDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-e2e-'));
    scratchBaseDir = await mkdtemp(
      path.join(os.tmpdir(), 'patchback-e2e-jobs-'),
    );
    await createFixtureRepo(targetRepoDir);
  });

  afterAll(async () => {
    if (targetRepoDir !== '') {
      await rm(targetRepoDir, { recursive: true, force: true });
    }
    if (scratchBaseDir !== '') {
      await rm(scratchBaseDir, { recursive: true, force: true });
    }
  });

  it(
    'changes the button label via the real agent, under the ceiling, checks green',
    async () => {
      const jobId = 'job-e2e-claude';
      const adapter = createClaudeCodeAdapter({
        binaryPath: process.env.PATCHBACK_E2E_CLAUDE_BIN ?? 'claude',
        timeoutMs: 8 * 60 * 1000,
      });

      await withScratchDir(
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
          await adapter.prepare(ctx);
          const execution = await adapter.execute(ctx);

          expect(execution.error).toBeUndefined();
          expect(execution.success).toBe(true);
          expect(execution.changedFiles.map((file) => file.path)).toContain(
            BUTTON_FILE,
          );
          expect(execution.totalChangedLines).toBeLessThanOrEqual(300);

          const checks = await detectAndRunChecks(
            workDir,
            ctx.conventions?.scripts ?? {},
            { packageManager: ctx.conventions?.packageManager },
          );
          expect(checks.allPassed).toBe(true);

          const summary = await adapter.summarize(ctx);
          expect(summary.title).toContain(NEW_LABEL);
        },
        { baseDir: scratchBaseDir },
      );
    },
    10 * 60 * 1000,
  );
});
