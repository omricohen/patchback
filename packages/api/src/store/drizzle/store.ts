import { and, asc, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import type {
  CaptureContext,
  FeedbackItem,
  Job,
  JobState,
  JobStateChange,
  Submitter,
  TriageResult,
} from '@patchback/types';
import { isJobState, isTriageClassification } from '@patchback/types';

import { StoreIntegrityError } from '../../errors.js';
import { hashReadToken, timingSafeStringEqual } from '../../ids.js';
import { assertTrustTier } from '../../trust.js';
import type { Store } from '../store.js';
import { feedback, jobs } from './schema.js';

/**
 * Postgres Store via drizzle-orm. This is the ONLY file importing `pg`.
 *
 * - `updateJob` is a real compare-and-swap:
 *   `UPDATE … WHERE id = $id AND state = $expected` — zero rows means
 *   conflict, so duplicate queue deliveries cannot corrupt the audit trail.
 * - Every row → domain mapping runtime-validates the trust tier and job
 *   state (fail closed with StoreIntegrityError; never coerced).
 */
export interface DrizzleStoreHandle {
  store: Store;
  close(): Promise<void>;
}

export function createDrizzleStore(databaseUrl: string): DrizzleStoreHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  return {
    store: new DrizzleStore(db),
    close: async () => {
      await pool.end();
    },
  };
}

type FeedbackRow = typeof feedback.$inferSelect;
type JobRow = typeof jobs.$inferSelect;

export class DrizzleStore implements Store {
  constructor(private readonly db: NodePgDatabase) {}

  async createFeedback(
    item: FeedbackItem,
    readTokenHash: string,
  ): Promise<void> {
    assertTrustTier(item.trustTier, `feedback ${item.id}`);
    await this.db.insert(feedback).values({
      id: item.id,
      message: item.message,
      trustTier: item.trustTier,
      submitter: item.submitter ?? null,
      capture: item.capture ?? null,
      triage: item.triage ?? null,
      threadId: item.threadId ?? null,
      inReplyTo: item.inReplyTo ?? null,
      readTokenHash,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    });
  }

  async getFeedback(id: string): Promise<FeedbackItem | undefined> {
    const rows = await this.db
      .select()
      .from(feedback)
      .where(eq(feedback.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : mapFeedbackRow(row);
  }

  async setTriage(id: string, triage: TriageResult): Promise<void> {
    const updated = await this.db
      .update(feedback)
      .set({
        triage,
        updatedAt: new Date(triage.triagedAt ?? Date.now()),
      })
      .where(eq(feedback.id, id))
      .returning({ id: feedback.id });
    if (updated.length === 0) {
      throw new Error(`feedback ${id} not found`);
    }
  }

  async listThread(threadId: string): Promise<FeedbackItem[]> {
    const rows = await this.db
      .select()
      .from(feedback)
      .where(eq(feedback.threadId, threadId))
      .orderBy(asc(feedback.createdAt));
    return rows.map(mapFeedbackRow);
  }

  async verifyReadToken(feedbackId: string, token: string): Promise<boolean> {
    const rows = await this.db
      .select({ readTokenHash: feedback.readTokenHash })
      .from(feedback)
      .where(eq(feedback.id, feedbackId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return false;
    }
    return timingSafeStringEqual(row.readTokenHash, hashReadToken(token));
  }

  async createJob(job: Job): Promise<void> {
    assertJobStateValue(job.id, job.state);
    await this.db.insert(jobs).values(jobToRow(job));
  }

  async getJob(id: string): Promise<Job | undefined> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : mapJobRow(row);
  }

  async getJobByFeedbackId(feedbackId: string): Promise<Job | undefined> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.feedbackId, feedbackId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : mapJobRow(row);
  }

  async getJobByPrNumber(prNumber: number): Promise<Job | undefined> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.prNumber, prNumber))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : mapJobRow(row);
  }

  async getJobByBranchName(branchName: string): Promise<Job | undefined> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.branchName, branchName))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : mapJobRow(row);
  }

  async updateJob(job: Job, expectedState: JobState): Promise<boolean> {
    assertJobStateValue(job.id, job.state);
    const updated = await this.db
      .update(jobs)
      .set(jobToRow(job))
      .where(and(eq(jobs.id, job.id), eq(jobs.state, expectedState)))
      .returning({ id: jobs.id });
    return updated.length > 0;
  }
}

function assertJobStateValue(
  jobId: string,
  state: unknown,
): asserts state is JobState {
  if (!isJobState(state)) {
    throw new StoreIntegrityError(
      `job ${jobId}: invalid state ${JSON.stringify(state)} — refusing to ` +
        'proceed (corruption or bad migration).',
    );
  }
}

function jobToRow(job: Job): typeof jobs.$inferInsert {
  return {
    id: job.id,
    feedbackId: job.feedbackId,
    state: job.state,
    history: job.history,
    issueNumber: job.issueNumber ?? null,
    branchName: job.branchName ?? null,
    prNumber: job.prNumber ?? null,
    prUrl: job.prUrl ?? null,
    userSummary: job.userSummary ?? null,
    previewUrl: job.previewUrl ?? null,
    error: job.error ?? null,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
  };
}

/**
 * Row → domain mapping, exported for corruption unit tests (no DB needed).
 * Validates the tier, the triage jsonb, and the thread fields — fail closed.
 */
export function mapFeedbackRow(row: FeedbackRow): FeedbackItem {
  const trustTier = assertTrustTier(row.trustTier, `feedback ${row.id}`);
  const triage = validateTriage(row.id, row.triage);
  return {
    id: row.id,
    message: row.message,
    trustTier,
    ...(row.submitter !== null
      ? { submitter: row.submitter as Submitter }
      : {}),
    ...(row.capture !== null ? { capture: row.capture as CaptureContext } : {}),
    ...(triage !== undefined ? { triage } : {}),
    ...(row.threadId !== null ? { threadId: row.threadId } : {}),
    ...(row.inReplyTo !== null ? { inReplyTo: row.inReplyTo } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Row → domain mapping, exported for corruption unit tests (no DB needed). */
export function mapJobRow(row: JobRow): Job {
  assertJobStateValue(row.id, row.state);
  if (!Array.isArray(row.history)) {
    throw new StoreIntegrityError(
      `job ${row.id}: history is not an array — refusing to proceed.`,
    );
  }
  for (const entry of row.history as JobStateChange[]) {
    if (!isJobState(entry?.from) || !isJobState(entry?.to)) {
      throw new StoreIntegrityError(
        `job ${row.id}: history contains an invalid state — refusing to proceed.`,
      );
    }
  }
  return {
    id: row.id,
    feedbackId: row.feedbackId,
    state: row.state,
    history: row.history as JobStateChange[],
    ...(row.issueNumber !== null ? { issueNumber: row.issueNumber } : {}),
    ...(row.branchName !== null ? { branchName: row.branchName } : {}),
    ...(row.prNumber !== null ? { prNumber: row.prNumber } : {}),
    ...(row.prUrl !== null ? { prUrl: row.prUrl } : {}),
    ...(row.userSummary !== null ? { userSummary: row.userSummary } : {}),
    ...(row.previewUrl !== null ? { previewUrl: row.previewUrl } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateTriage(id: string, value: unknown): TriageResult | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !isTriageClassification(
      (value as { classification?: unknown }).classification,
    ) ||
    typeof (value as { confidence?: unknown }).confidence !== 'number'
  ) {
    throw new StoreIntegrityError(
      `feedback ${id}: invalid triage payload — refusing to proceed.`,
    );
  }
  return value as TriageResult;
}
