import { triageFeedback } from '@patchback/triage';
import { transitionJob } from '@patchback/types';

import type { ApiConfig } from '../config.js';
import type { Task } from '../queue/queue.js';
import { assertTrustTier } from '../trust.js';
import { buildThreadContext } from './thread.js';

/**
 * Consume one `triage` task: classify the item, persist the result, advance
 * the job `feedback.received → feedback.triaged` (and on to the terminal
 * `feedback.needs_clarification` when that is the classification).
 *
 * - Outsider items short-circuit INSIDE triageFeedback — zero model calls,
 *   deterministic `needs_human`. This worker additionally revalidates the
 *   tier before the prompt path as defense-in-depth (the tier value is
 *   interpolated into prompt metadata; only a validated tier may pass).
 * - A thrown TriageModelError (transport) propagates so the queue retries;
 *   exhausted retries leave the job at `feedback.received` — never a
 *   fabricated classification.
 * - `needs_human` and `patchable` items REST at `feedback.triaged`:
 *   classification lives on the item, not the state machine.
 */
export async function runTriageTask(
  config: ApiConfig,
  task: Extract<Task, { type: 'triage' }>,
): Promise<void> {
  const { store } = config;
  const item = await store.getFeedback(task.feedbackId);
  if (item === undefined) {
    return; // Nothing to triage; retrying would not change that.
  }
  assertTrustTier(item.trustTier, `feedback ${item.id}`);

  const thread = await buildThreadContext(store, item);
  const result = await triageFeedback(item, {
    callModel: config.callModel,
    ...(config.confidenceThreshold !== undefined
      ? { confidenceThreshold: config.confidenceThreshold }
      : {}),
    ...(thread !== undefined ? { thread } : {}),
    ...(config.now !== undefined ? { now: config.now } : {}),
    ...(config.repoProbe !== undefined ? { repoProbe: config.repoProbe } : {}),
  });

  await store.setTriage(item.id, result);

  const job = await store.getJob(task.jobId);
  if (job === undefined || job.state !== 'feedback.received') {
    return; // Duplicate delivery — the transition already happened.
  }
  let updated = transitionJob(job, 'feedback.triaged', {
    note: `triage: ${result.classification} (confidence ${result.confidence})`,
  });
  if (result.classification === 'needs_clarification') {
    updated = transitionJob(
      updated,
      'feedback.needs_clarification',
      result.clarifyingQuestion !== undefined
        ? { note: `question: ${result.clarifyingQuestion}` }
        : undefined,
    );
  }
  await store.updateJob(updated, 'feedback.received');
}
