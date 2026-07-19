import { describe, expect, it } from 'vitest';

import type {
  AgentAdapter,
  AgentContext,
  ExecutionResult,
  RepairContext,
} from './adapter.js';
import type { ChecksReport } from './check-runner.js';
import {
  executeWithRepair,
  MAX_REPAIR_ATTEMPTS,
} from './execute-with-repair.js';

function passing(): ChecksReport {
  return {
    ran: [
      {
        name: 'test',
        command: 'npm run test',
        passed: true,
        exitCode: 0,
        outputTail: 'ok',
        durationMs: 1,
      },
    ],
    skipped: [],
    allPassed: true,
  };
}

function failing(tail = 'AssertionError: expected true'): ChecksReport {
  return {
    ran: [
      {
        name: 'test',
        command: 'npm run test',
        passed: false,
        exitCode: 1,
        outputTail: tail,
        durationMs: 1,
      },
    ],
    skipped: [],
    allPassed: false,
  };
}

const okExecution: ExecutionResult = {
  success: true,
  changedFiles: [{ path: 'a.ts', additions: 1, deletions: 0, binary: false }],
  totalChangedLines: 1,
};

/**
 * A stub adapter whose `execute` returns scripted results in order and records
 * the `ctx.repair` value observed on each call (so tests can prove the repair
 * feedback was threaded through).
 */
function stubAdapter(executions: ExecutionResult[]): {
  adapter: AgentAdapter;
  calls: (RepairContext | undefined)[];
} {
  const calls: (RepairContext | undefined)[] = [];
  let i = 0;
  const adapter: AgentAdapter = {
    name: 'stub',
    async prepare() {},
    async plan() {
      return { steps: [] };
    },
    async execute(ctx) {
      calls.push(ctx.repair);
      const result = executions[i];
      i += 1;
      if (result === undefined)
        throw new Error('unexpected extra execute call');
      return result;
    },
    async summarize() {
      return { title: 't', body: 'b' };
    },
  };
  return { adapter, calls };
}

function ctx(): AgentContext {
  return {
    jobId: 'job-1',
    // Only identity + the repair channel matter for these tests.
    brief: {} as AgentContext['brief'],
    workDir: '/tmp/does-not-matter',
  };
}

describe('executeWithRepair', () => {
  it('caps repair at exactly one attempt', () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(1);
  });

  it('passing checks on the first try need no repair', async () => {
    const { adapter, calls } = stubAdapter([okExecution]);
    const checks = [passing()];
    const outcome = await executeWithRepair({
      adapter,
      ctx: ctx(),
      runChecks: async () => checks.shift()!,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.repairAttempts).toBe(0);
    expect(calls).toEqual([undefined]); // execute called once, no repair ctx
  });

  it('a failed first execution never triggers a repair', async () => {
    const { adapter, calls } = stubAdapter([
      { success: false, changedFiles: [], totalChangedLines: 0, error: 'boom' },
    ]);
    let checksRan = 0;
    const outcome = await executeWithRepair({
      adapter,
      ctx: ctx(),
      runChecks: async () => {
        checksRan += 1;
        return passing();
      },
    });
    expect(outcome).toMatchObject({
      ok: false,
      repairAttempts: 0,
      error: 'boom',
    });
    expect(checksRan).toBe(0); // no point checking a change that failed to apply
    expect(calls).toHaveLength(1);
  });

  it('repair disabled: fails immediately on the first check failure (no 2nd execute)', async () => {
    const { adapter, calls } = stubAdapter([okExecution]);
    const outcome = await executeWithRepair({
      adapter,
      ctx: ctx(),
      runChecks: async () => failing(),
      repairEnabled: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.repairAttempts).toBe(0);
    expect(outcome.error).toBe(
      'target repo checks failed: test (npm run test)',
    );
    expect(calls).toEqual([undefined]); // executed exactly once
  });

  it('fail-then-fix: one repair with structured feedback, then checks pass', async () => {
    const { adapter, calls } = stubAdapter([okExecution, okExecution]);
    const checks = [failing('first failure output'), passing()];
    const seen: AgentContext = ctx();
    const outcome = await executeWithRepair({
      adapter,
      ctx: seen,
      runChecks: async () => checks.shift()!,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.repairAttempts).toBe(1);
    // The repair invocation saw structured failing-check feedback...
    expect(calls[0]).toBeUndefined();
    expect(calls[1]).toEqual({
      attempt: 1,
      failingChecks: [
        {
          name: 'test',
          command: 'npm run test',
          outputTail: 'first failure output',
        },
      ],
    });
    // ...and the context is left clean afterward.
    expect(seen.repair).toBeUndefined();
  });

  it('fail-then-fail: patch.failed with BOTH check outputs preserved', async () => {
    const { adapter } = stubAdapter([okExecution, okExecution]);
    const checks = [failing('BEFORE tail'), failing('AFTER tail')];
    const outcome = await executeWithRepair({
      adapter,
      ctx: ctx(),
      runChecks: async () => checks.shift()!,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.repairAttempts).toBe(1);
    expect(outcome.error).toContain('after 1 automated repair attempt');
    expect(outcome.error).toContain('BEFORE tail');
    expect(outcome.error).toContain('AFTER tail');
  });

  it('a repair execution that itself fails (e.g. ceiling) surfaces the adapter error', async () => {
    const { adapter } = stubAdapter([
      okExecution,
      {
        success: false,
        changedFiles: [],
        totalChangedLines: 0,
        error: 'Diff too large: ... during the automated repair attempt.',
      },
    ]);
    const checks = [failing(), passing()];
    const outcome = await executeWithRepair({
      adapter,
      ctx: ctx(),
      runChecks: async () => checks.shift() ?? passing(),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.repairAttempts).toBe(1);
    expect(outcome.error).toContain('Diff too large');
    expect(outcome.error).toContain('repair attempt');
  });
});
