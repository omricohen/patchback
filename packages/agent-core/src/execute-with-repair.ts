import type { AgentAdapter, AgentContext, ExecutionResult } from './adapter.js';
import {
  collectFailingChecks,
  type ChecksReport,
  type FailingCheckFeedback,
} from './check-runner.js';

/**
 * Bounded self-repair: after `execute()`, run the target repo's checks; if any
 * fail, feed the failing-check output back to the adapter as ONE repair
 * invocation, then re-run the checks. This lives in agent-core (vendor-neutral)
 * and is called from the patch pipeline — the whole loop happens inside the
 * `patch.running` window, with NO new job states.
 *
 * v0.2 rules, deliberately fixed:
 * - Exactly ONE repair attempt. Not configurable upward (see
 *   {@link MAX_REPAIR_ATTEMPTS}); repair can be turned OFF, never dialed higher.
 * - The diff ceiling is enforced by the adapter's `execute()` against the base
 *   commit, and the repair runs on the SAME working tree with the prior diff
 *   already applied — so the second `execute()` measures the CUMULATIVE diff
 *   (original + repair). A repair that pushes the total over the ceiling fails
 *   with the adapter's ceiling message.
 * - `patch.failed` only after the repair attempt ALSO fails; the failure error
 *   preserves BOTH the before- and after-repair check outputs.
 */
export const MAX_REPAIR_ATTEMPTS = 1;

export interface ExecuteWithRepairOptions {
  adapter: AgentAdapter;
  /**
   * The job context. `executeWithRepair` mutates `ctx.repair` before the
   * second `execute()` and clears it afterward — same object identity flows
   * through the adapter lifecycle.
   */
  ctx: AgentContext;
  /**
   * Run the target repo's checks against `ctx.workDir`. Injected so agent-core
   * need not own check detection; the pipeline passes `detectAndRunChecks`.
   */
  runChecks: () => Promise<ChecksReport>;
  /** Bounded repair after failing checks. Default true. */
  repairEnabled?: boolean;
  /** Operational log sink (attempt notices). Default: silent. */
  log?: (message: string) => void;
}

export interface ExecuteWithRepairOutcome {
  /** True only when the final execution succeeded AND its checks all passed. */
  ok: boolean;
  /** The final execution (the repair one if a repair ran, else the original). */
  execution: ExecutionResult;
  /** The final checks report; absent only when execution failed before checks. */
  checks?: ChecksReport;
  /** 0 when no repair ran, 1 when a repair attempt was made. */
  repairAttempts: number;
  /** Human-useful failure message when `ok` is false. */
  error?: string;
}

function checkNameList(failing: FailingCheckFeedback[]): string {
  return failing.map((check) => `${check.name} (${check.command})`).join(', ');
}

function renderFailingChecks(failing: FailingCheckFeedback[]): string {
  return failing
    .map(
      (check) =>
        `### ${check.name} — ${check.command}\n${check.outputTail.trim()}`,
    )
    .join('\n\n');
}

/**
 * The error for a check failure with no repair (repair disabled, or the
 * first-pass failure that repair is about to try to fix). Kept in the historic
 * `target repo checks failed: <list>` shape so `explainPatchFailure` and the
 * CLI recognize it.
 */
export function formatCheckFailure(failing: FailingCheckFeedback[]): string {
  return `target repo checks failed: ${checkNameList(failing)}`;
}

/** The error after a repair attempt still leaves checks failing. */
export function formatRepairFailure(
  before: FailingCheckFeedback[],
  after: FailingCheckFeedback[],
): string {
  return [
    `target repo checks still failed after ${MAX_REPAIR_ATTEMPTS} automated ` +
      `repair attempt: ${checkNameList(after)}. No PR was opened — route this ` +
      'feedback to a human.',
    '',
    'Failing checks BEFORE repair:',
    renderFailingChecks(before),
    '',
    'Failing checks AFTER repair:',
    renderFailingChecks(after),
  ].join('\n');
}

/**
 * Execute the adapter, run checks, and — if checks fail and repair is enabled —
 * run exactly one bounded repair invocation and re-check. See the module doc
 * for the guarantees. Never throws for an agent/check failure: failure is data
 * in the returned outcome, so the caller records `patch.failed` with the error.
 */
export async function executeWithRepair(
  options: ExecuteWithRepairOptions,
): Promise<ExecuteWithRepairOutcome> {
  const { adapter, ctx, runChecks } = options;
  const repairEnabled = options.repairEnabled ?? true;
  const log = options.log;

  // First execution: the adapter enforces the diff ceiling here against the
  // base commit. A failed execution never gets a repair — nothing to fix.
  const firstExecution = await adapter.execute(ctx);
  if (!firstExecution.success) {
    return {
      ok: false,
      execution: firstExecution,
      repairAttempts: 0,
      error: firstExecution.error ?? 'agent execution failed',
    };
  }

  const firstChecks = await runChecks();
  if (firstChecks.allPassed) {
    return {
      ok: true,
      execution: firstExecution,
      checks: firstChecks,
      repairAttempts: 0,
    };
  }

  const failingBefore = collectFailingChecks(firstChecks);

  if (!repairEnabled || MAX_REPAIR_ATTEMPTS < 1) {
    return {
      ok: false,
      execution: firstExecution,
      checks: firstChecks,
      repairAttempts: 0,
      error: formatCheckFailure(failingBefore),
    };
  }

  log?.(
    `Post-execution checks failed (${checkNameList(failingBefore)}); running ` +
      `${MAX_REPAIR_ATTEMPTS} bounded repair attempt.`,
  );

  // The repair operates on the SAME working tree — the prior diff is already
  // applied — so the adapter amends it, and its ceiling check sees the
  // cumulative diff from the base commit.
  ctx.repair = { attempt: 1, failingChecks: failingBefore };
  let repairExecution: ExecutionResult;
  try {
    repairExecution = await adapter.execute(ctx);
  } finally {
    delete ctx.repair;
  }

  if (!repairExecution.success) {
    // e.g. the cumulative diff blew the ceiling during repair — the adapter's
    // message already says so. patch.failed, one attempt made.
    return {
      ok: false,
      execution: repairExecution,
      checks: firstChecks,
      repairAttempts: 1,
      error: repairExecution.error ?? 'repair execution failed',
    };
  }

  const secondChecks = await runChecks();
  if (secondChecks.allPassed) {
    return {
      ok: true,
      execution: repairExecution,
      checks: secondChecks,
      repairAttempts: 1,
    };
  }

  return {
    ok: false,
    execution: repairExecution,
    checks: secondChecks,
    repairAttempts: 1,
    error: formatRepairFailure(
      failingBefore,
      collectFailingChecks(secondChecks),
    ),
  };
}
