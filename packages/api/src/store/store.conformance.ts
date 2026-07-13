import type { FeedbackItem, Job } from '@patchback/types';
import { INITIAL_JOB_STATE, transitionJob } from '@patchback/types';
import { describe, expect, it } from 'vitest';

import { generateReadToken, hashReadToken } from '../ids.js';
import type { Store } from './store.js';

/**
 * One conformance suite, parameterized over Store implementations.
 * MemoryStore runs it always; DrizzleStore runs it env-gated behind
 * PATCHBACK_TEST_DATABASE_URL.
 */

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  const now = new Date().toISOString();
  return {
    id: uid('fb'),
    message: 'The button says "Sumbit" instead of "Submit".',
    trustTier: 'insider',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeJob(feedbackId: string, overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: uid('job'),
    feedbackId,
    state: INITIAL_JOB_STATE,
    history: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function runStoreConformance(
  name: string,
  makeStore: () => Promise<Store>,
): void {
  describe(`${name} store conformance`, () => {
    it('round-trips a feedback item', async () => {
      const store = await makeStore();
      const item = makeItem({
        submitter: { id: 'user-1', name: 'Test User' },
        capture: { url: 'https://app.example.com/orders', pageTitle: 'Orders' },
      });
      await store.createFeedback(item, hashReadToken(generateReadToken()));
      const loaded = await store.getFeedback(item.id);
      expect(loaded).toEqual(item);
      expect(await store.getFeedback(uid('missing'))).toBeUndefined();
    });

    it('stored items cannot be mutated through returned references', async () => {
      const store = await makeStore();
      const item = makeItem();
      await store.createFeedback(item, hashReadToken(generateReadToken()));
      const loaded = await store.getFeedback(item.id);
      expect(loaded).toBeDefined();
      if (loaded) {
        loaded.message = 'MUTATED';
        (loaded as { trustTier: string }).trustTier = 'owner';
      }
      const reloaded = await store.getFeedback(item.id);
      expect(reloaded?.message).toBe(item.message);
      expect(reloaded?.trustTier).toBe('insider');
    });

    it('setTriage attaches a triage result', async () => {
      const store = await makeStore();
      const item = makeItem();
      await store.createFeedback(item, hashReadToken(generateReadToken()));
      const triage = {
        classification: 'patchable' as const,
        confidence: 0.95,
        reasoning: 'simple copy change',
        triagedAt: new Date().toISOString(),
      };
      await store.setTriage(item.id, triage);
      const loaded = await store.getFeedback(item.id);
      expect(loaded?.triage).toEqual(triage);
    });

    it('lists thread members oldest first, excluding the root', async () => {
      const store = await makeStore();
      const root = makeItem();
      await store.createFeedback(root, hashReadToken(generateReadToken()));
      const replyA = makeItem({
        threadId: root.id,
        inReplyTo: root.id,
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
      });
      const replyB = makeItem({
        threadId: root.id,
        inReplyTo: replyA.id,
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
      // Insert out of order to prove ordering comes from createdAt.
      await store.createFeedback(replyB, hashReadToken(generateReadToken()));
      await store.createFeedback(replyA, hashReadToken(generateReadToken()));
      const thread = await store.listThread(root.id);
      expect(thread.map((member) => member.id)).toEqual([replyA.id, replyB.id]);
      expect(await store.listThread(uid('missing'))).toEqual([]);
    });

    it('verifies read tokens by hash and rejects wrong ones', async () => {
      const store = await makeStore();
      const item = makeItem();
      const token = generateReadToken();
      await store.createFeedback(item, hashReadToken(token));
      expect(await store.verifyReadToken(item.id, token)).toBe(true);
      expect(await store.verifyReadToken(item.id, generateReadToken())).toBe(
        false,
      );
      expect(await store.verifyReadToken(item.id, '')).toBe(false);
      expect(await store.verifyReadToken(uid('missing'), token)).toBe(false);
    });

    it('round-trips a job and finds it by feedback id', async () => {
      const store = await makeStore();
      const item = makeItem();
      await store.createFeedback(item, hashReadToken(generateReadToken()));
      const job = makeJob(item.id);
      await store.createJob(job);
      expect(await store.getJob(job.id)).toEqual(job);
      expect(await store.getJobByFeedbackId(item.id)).toEqual(job);
      expect(await store.getJob(uid('missing'))).toBeUndefined();
      expect(await store.getJobByFeedbackId(uid('missing'))).toBeUndefined();
    });

    it('finds a job by PR number for webhook correlation', async () => {
      const store = await makeStore();
      const item = makeItem();
      await store.createFeedback(item, hashReadToken(generateReadToken()));
      const prNumber = 100000 + Math.floor(Math.random() * 800000);
      let job = makeJob(item.id);
      await store.createJob(job);
      job = transitionJob(job, 'feedback.triaged');
      job = transitionJob(job, 'issue.created');
      job = transitionJob(job, 'patch.queued');
      job = transitionJob(job, 'patch.running');
      job = transitionJob(job, 'patch.generated');
      job = transitionJob(job, 'pr.opened');
      job = { ...job, prNumber };
      expect(await store.updateJob(job, INITIAL_JOB_STATE)).toBe(true);
      const found = await store.getJobByPrNumber(prNumber);
      expect(found?.id).toBe(job.id);
      expect(found?.state).toBe('pr.opened');
      expect(found?.history).toHaveLength(6);
      expect(await store.getJobByPrNumber(999999999)).toBeUndefined();
    });

    it('updateJob is compare-and-swap: stale expected state writes nothing', async () => {
      const store = await makeStore();
      const item = makeItem();
      await store.createFeedback(item, hashReadToken(generateReadToken()));
      const job = makeJob(item.id);
      await store.createJob(job);

      const triaged = transitionJob(job, 'feedback.triaged');
      expect(await store.updateJob(triaged, INITIAL_JOB_STATE)).toBe(true);

      // A duplicate delivery still holding the old snapshot must lose.
      const duplicate = transitionJob(job, 'feedback.triaged');
      expect(await store.updateJob(duplicate, INITIAL_JOB_STATE)).toBe(false);

      const stored = await store.getJob(job.id);
      expect(stored?.state).toBe('feedback.triaged');
      expect(stored?.history).toHaveLength(1);
      // Unknown job id: false, not an exception.
      expect(
        await store.updateJob(makeJob(item.id), INITIAL_JOB_STATE),
      ).toBe(false);
    });
  });
}
