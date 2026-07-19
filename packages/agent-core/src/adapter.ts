import type { GuardedTaskBrief } from './brief.js';
import type { FailingCheckFeedback } from './check-runner.js';
import type { RepoConventions } from './repo-reader.js';

/**
 * Present on the context ONLY during a bounded repair invocation: the prior
 * `execute()` already applied a diff to `workDir`, but the repo's checks
 * failed. An adapter that sees this must AMEND the existing change (which is
 * still in the working tree) so the checks pass — not start over. The diff
 * ceiling is measured cumulatively (original change + repair) from the base
 * commit, so a repair cannot smuggle in a large rewrite.
 *
 * Everything in {@link FailingCheckFeedback} is tool-generated check output,
 * never submitter-controlled text — the trust boundary is unchanged.
 */
export interface RepairContext {
  /**
   * 1-based repair attempt index. v0.2 caps repair at exactly one attempt
   * (see `MAX_REPAIR_ATTEMPTS`), so this is always 1; the field exists so the
   * cap can be lifted later without a shape change.
   */
  attempt: number;
  /** Structured feedback for the checks that failed on the prior execution. */
  failingChecks: FailingCheckFeedback[];
}

/**
 * Everything an adapter needs to do its work. Constructed by the orchestrator
 * (local runner / worker), passed through all four lifecycle methods of one
 * job. The same object identity flows through prepare → plan → execute →
 * summarize, so adapters may key internal per-job state off it.
 */
export interface AgentContext {
  /** Patchback job id this run belongs to. */
  jobId: string;
  /**
   * Trust boundary: only a {@link GuardedTaskBrief} is accepted — briefs are
   * constructible solely via `createBriefFromTriagedFeedback`, which enforces
   * the tier + triage preconditions. An unguarded object literal here is a
   * type error by design.
   */
  brief: GuardedTaskBrief;
  /**
   * Absolute path to the working copy of the target repo inside the job's
   * scratch dir. Must be a git work tree on the job's working branch.
   */
  workDir: string;
  /**
   * Target-repo conventions. Usually filled in by `prepare()` (via
   * `readRepoConventions`); orchestrators may pre-populate it.
   */
  conventions?: RepoConventions;
  /**
   * Set by the orchestrator (see `executeWithRepair`) ONLY when re-invoking
   * `execute()` to fix a change whose post-execution checks failed. Absent on
   * the first execution. Adapters render it as structured "fix your prior
   * diff" feedback; see {@link RepairContext}.
   */
  repair?: RepairContext;
}

/** Result of `plan()`: what the adapter intends to do, for logs/audit trail. */
export interface AgentPlan {
  steps: string[];
  notes?: string;
}

/** One changed file as reported by `git diff --numstat`. */
export interface ChangedFile {
  path: string;
  /** Lines added; 0 for binary files (git reports `-`). */
  additions: number;
  /** Lines deleted; 0 for binary files (git reports `-`). */
  deletions: number;
  binary: boolean;
}

/**
 * Result of `execute()`. A failed execution reports `success: false` with a
 * human-useful `error` — it does not throw, so orchestrators can move the job
 * to `patch.failed` with the message intact.
 */
export interface ExecutionResult {
  success: boolean;
  changedFiles: ChangedFile[];
  /** Total added + deleted lines across all changed files. */
  totalChangedLines: number;
  /** Tail of the agent's raw output, for logs. */
  agentOutput?: string;
  /** Present when `success` is false. */
  error?: string;
}

/** Result of `summarize()`: feeds the PR title/body. */
export interface AgentSummary {
  title: string;
  body: string;
}

/**
 * The vendor-neutral agent adapter contract.
 *
 * `@patchback/agent-core` never imports a specific vendor SDK or CLI —
 * adapters (e.g. `@patchback/agent-claude-code`) implement this interface and
 * are plugged in by the orchestrator. Lifecycle, in order, for one job:
 *
 * 1. `prepare`   — validate the working copy, read conventions, warm caches.
 * 2. `plan`      — produce an auditable plan from the brief (no code changes).
 * 3. `execute`   — make the change in `ctx.workDir`; leave the working tree
 *                  dirty (no commits — committing/branch push is the
 *                  orchestrator's job via `@patchback/github`).
 * 4. `summarize` — produce the PR title/body from what actually happened.
 */
export interface AgentAdapter {
  /** Stable adapter identifier, e.g. `claude-code`. */
  readonly name: string;
  prepare(ctx: AgentContext): Promise<void>;
  plan(ctx: AgentContext): Promise<AgentPlan>;
  execute(ctx: AgentContext): Promise<ExecutionResult>;
  summarize(ctx: AgentContext): Promise<AgentSummary>;
}
