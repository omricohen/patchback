import {
  createBriefFromTriagedFeedback,
  type TaskBrief,
} from '@patchback/agent-core';
import type { ThreadContext } from '@patchback/triage';
import type { FeedbackItem, Job } from '@patchback/types';
import { transitionJob } from '@patchback/types';

import type { ApiConfig } from '../config.js';
import type { PatchPipeline } from '../pipeline.js';
import type { Task } from '../queue/queue.js';
import { firstLine } from '../routes/shared.js';
import { buildThreadContext } from './thread.js';

/** Default constraints stamped into every brief. */
export const DEFAULT_BRIEF_CONSTRAINTS: readonly string[] = [
  'Keep the diff minimal — change only what the feedback requires.',
  'Do not add new dependencies.',
  'Do not commit; leave the working tree dirty.',
];

/**
 * Consume one `patch` task: `patch.queued → patch.running`, build the brief
 * through the guarded factory (the ONLY brief producer — it re-enforces
 * eligible tier + patchable classification), run the pipeline, and land on
 * `patch.generated → pr.opened` or `patch.failed`.
 *
 * Never throws: a failed run records `patch.failed` with the human-useful
 * error. The queue never retries patch tasks — re-running agents on retry
 * would burn money, and "failed means a human looks at it".
 */
export async function runPatchTask(
  config: ApiConfig,
  pipeline: PatchPipeline,
  task: Extract<Task, { type: 'patch' }>,
): Promise<void> {
  const { store } = config;
  const job = await store.getJob(task.jobId);
  if (job === undefined || job.state !== 'patch.queued') {
    return; // Duplicate delivery or out-of-band change.
  }
  const running = transitionJob(job, 'patch.running');
  if (!(await store.updateJob(running, 'patch.queued'))) {
    return; // Lost the CAS — someone else picked it up.
  }

  const fail = async (message: string): Promise<void> => {
    const failed: Job = {
      ...transitionJob(running, 'patch.failed', { note: message }),
      error: message,
    };
    await store.updateJob(failed, 'patch.running');
  };

  try {
    const item = await store.getFeedback(job.feedbackId);
    if (item === undefined) {
      await fail(`job references missing feedback ${job.feedbackId}`);
      return;
    }
    const thread = await buildThreadContext(store, item);
    // The guarded factory enforces the trust boundary (eligible tier AND
    // patchable classification) and is the only producer of a brief an
    // adapter will accept. It throws BriefSourceNotAllowedError /
    // BriefNotPatchableError — both land in `patch.failed` below, though the
    // route gates mean they should be unreachable here.
    const brief = createBriefFromTriagedFeedback(
      item,
      buildBriefFields(item, thread, config),
    );

    const result = await pipeline.run(brief, running);
    if (result.ok) {
      let updated = transitionJob(running, 'patch.generated', {
        note: `branch ${result.branch}`,
      });
      updated = transitionJob(updated, 'pr.opened', {
        note: `PR #${result.prNumber}`,
      });
      updated = {
        ...updated,
        branchName: result.branch,
        prNumber: result.prNumber,
        prUrl: result.prUrl,
      };
      const swapped = await store.updateJob(updated, 'patch.running');
      if (!swapped) {
        // The PR exists on GitHub but the job moved out of patch.running
        // underneath us, so the PR metadata (branch, number, URL) could not
        // be recorded. Loud, not silent — a human should reconcile.
        config.log?.(
          `patch-worker: job ${job.id} succeeded (PR #${result.prNumber}, ` +
            `${result.prUrl}) but the success CAS from patch.running failed — ` +
            'the job state changed concurrently and the PR metadata was NOT ' +
            'recorded on the job',
        );
      }
    } else {
      await fail(result.error);
    }
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Brief fields are built DETERMINISTICALLY — no extra model call. Title from
 * the message; description from message + clarifying-thread context;
 * constraints from config defaults; fileHints empty in v0.1 (capture DOM
 * paths do not map to files yet); acceptance criteria generic.
 */
export function buildBriefFields(
  item: FeedbackItem,
  thread: ThreadContext | undefined,
  config: Pick<ApiConfig, 'briefConstraints'>,
): Omit<TaskBrief, 'feedbackId'> {
  const descriptionParts: string[] = [];
  if (thread !== undefined && thread.priorMessages.length > 0) {
    descriptionParts.push('Original feedback and clarification thread:');
    for (const prior of thread.priorMessages) {
      descriptionParts.push(`> ${prior}`);
    }
    if (thread.clarifyingQuestion !== undefined) {
      descriptionParts.push(
        `Clarifying question asked: ${thread.clarifyingQuestion}`,
      );
    }
    descriptionParts.push(`User's answer / latest feedback: ${item.message}`);
  } else {
    descriptionParts.push(item.message);
  }

  return {
    title: firstLine(item.message),
    description: descriptionParts.join('\n\n'),
    constraints: [...(config.briefConstraints ?? DEFAULT_BRIEF_CONSTRAINTS)],
    fileHints: [],
    acceptanceCriteria: [
      'The change described in the feedback is implemented.',
      "The target repo's own lint/typecheck/test checks still pass.",
    ],
  };
}
