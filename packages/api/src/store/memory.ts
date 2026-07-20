import type {
  FeedbackItem,
  Job,
  JobState,
  TriageResult,
} from '@patchback/types';
import { isJobState } from '@patchback/types';

import { StoreIntegrityError } from '../errors.js';
import { hashReadToken, timingSafeStringEqual } from '../ids.js';
import { assertTrustTier } from '../trust.js';
import type { Store } from './store.js';

/**
 * In-memory Store — the dev default and the test driver. Zero dependencies.
 *
 * Values are deep-copied on the way in AND out so callers can never mutate
 * stored state by reference. Reads runtime-validate tier/state exactly like
 * the Postgres driver (same fail-closed posture at every boundary).
 */
export class MemoryStore implements Store {
  private readonly feedback = new Map<string, FeedbackItem>();
  private readonly readTokenHashes = new Map<string, string>();
  private readonly jobs = new Map<string, Job>();

  async createFeedback(
    item: FeedbackItem,
    readTokenHash: string,
  ): Promise<void> {
    if (this.feedback.has(item.id)) {
      throw new Error(`feedback ${item.id} already exists`);
    }
    assertTrustTier(item.trustTier, `feedback ${item.id}`);
    this.feedback.set(item.id, structuredClone(item));
    this.readTokenHashes.set(item.id, readTokenHash);
  }

  async getFeedback(id: string): Promise<FeedbackItem | undefined> {
    const item = this.feedback.get(id);
    if (item === undefined) {
      return undefined;
    }
    assertTrustTier(item.trustTier, `feedback ${id}`);
    return structuredClone(item);
  }

  async setTriage(id: string, triage: TriageResult): Promise<void> {
    const item = this.feedback.get(id);
    if (item === undefined) {
      throw new Error(`feedback ${id} not found`);
    }
    item.triage = structuredClone(triage);
    item.updatedAt = triage.triagedAt ?? new Date().toISOString();
  }

  async listThread(threadId: string): Promise<FeedbackItem[]> {
    const members = [...this.feedback.values()]
      .filter((item) => item.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const member of members) {
      assertTrustTier(member.trustTier, `feedback ${member.id}`);
    }
    return structuredClone(members);
  }

  async verifyReadToken(feedbackId: string, token: string): Promise<boolean> {
    const storedHash = this.readTokenHashes.get(feedbackId);
    if (storedHash === undefined) {
      return false;
    }
    return timingSafeStringEqual(storedHash, hashReadToken(token));
  }

  async createJob(job: Job): Promise<void> {
    if (this.jobs.has(job.id)) {
      throw new Error(`job ${job.id} already exists`);
    }
    this.assertJobState(job);
    this.jobs.set(job.id, structuredClone(job));
  }

  async getJob(id: string): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return undefined;
    }
    this.assertJobState(job);
    return structuredClone(job);
  }

  async getJobByFeedbackId(feedbackId: string): Promise<Job | undefined> {
    const job = [...this.jobs.values()].find(
      (candidate) => candidate.feedbackId === feedbackId,
    );
    if (job === undefined) {
      return undefined;
    }
    this.assertJobState(job);
    return structuredClone(job);
  }

  async getJobByPrNumber(prNumber: number): Promise<Job | undefined> {
    const job = [...this.jobs.values()].find(
      (candidate) => candidate.prNumber === prNumber,
    );
    if (job === undefined) {
      return undefined;
    }
    this.assertJobState(job);
    return structuredClone(job);
  }

  async getJobByBranchName(branchName: string): Promise<Job | undefined> {
    const job = [...this.jobs.values()].find(
      (candidate) => candidate.branchName === branchName,
    );
    if (job === undefined) {
      return undefined;
    }
    this.assertJobState(job);
    return structuredClone(job);
  }

  async updateJob(job: Job, expectedState: JobState): Promise<boolean> {
    const stored = this.jobs.get(job.id);
    if (stored === undefined) {
      return false;
    }
    if (stored.state !== expectedState) {
      return false;
    }
    this.assertJobState(job);
    this.jobs.set(job.id, structuredClone(job));
    return true;
  }

  private assertJobState(job: Job): void {
    if (!isJobState(job.state)) {
      throw new StoreIntegrityError(
        `job ${job.id}: invalid state ${JSON.stringify(job.state)} — ` +
          'refusing to proceed (corruption or bad migration).',
      );
    }
  }
}
