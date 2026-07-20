import type {
  FeedbackItem,
  Job,
  JobState,
  TriageResult,
} from '@patchback/types';

/**
 * Storage seam for the API. Two implementations:
 *
 * - `MemoryStore` (memory.ts) — the dev default and the test driver. Zero
 *   dependencies, so `npx patchback dev` needs no services.
 * - `DrizzleStore` (drizzle/store.ts) — Postgres via drizzle-orm, the prod
 *   driver. The ONLY file importing `pg`.
 *
 * Contract notes:
 * - Reads MUST runtime-validate tier and state on the way out (fail closed
 *   with `StoreIntegrityError`) — stored bytes are outside-the-compiler input.
 * - `updateJob` is compare-and-swap on the job's state so duplicate queue
 *   deliveries and double-starts cannot corrupt the audit trail.
 */
export interface Store {
  /** Persist a new feedback item plus the SHA-256 hash of its read token. */
  createFeedback(item: FeedbackItem, readTokenHash: string): Promise<void>;
  getFeedback(id: string): Promise<FeedbackItem | undefined>;
  /** Attach a triage result to an existing item. Throws if the item is missing. */
  setTriage(id: string, triage: TriageResult): Promise<void>;
  /** All items whose threadId === `threadId`, oldest first (excludes the root). */
  listThread(threadId: string): Promise<FeedbackItem[]>;
  /** Constant-time check of `token` against the item's stored hash. */
  verifyReadToken(feedbackId: string, token: string): Promise<boolean>;
  createJob(job: Job): Promise<void>;
  getJob(id: string): Promise<Job | undefined>;
  /** The (single) job created with the feedback item. */
  getJobByFeedbackId(feedbackId: string): Promise<Job | undefined>;
  /** Webhook correlation: the job whose PR number matches. */
  getJobByPrNumber(prNumber: number): Promise<Job | undefined>;
  /**
   * Webhook correlation for `deployment_status` events: the job whose working
   * branch matches. Patch branches are deterministic
   * (`patchback/job-<id>`), so the deployment's `ref` correlates to a job
   * WITHOUT any outbound GitHub call — preserving the webhook's no-client
   * boundary.
   */
  getJobByBranchName(branchName: string): Promise<Job | undefined>;
  /**
   * Compare-and-swap: persist `job` only if the STORED state still equals
   * `expectedState`. Returns false on conflict (no write happened).
   */
  updateJob(job: Job, expectedState: JobState): Promise<boolean>;
}
