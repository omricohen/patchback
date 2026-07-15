import type { Store } from '@patchback/api';
import type { GitHubClient } from '@patchback/github';
import { transitionJob, type Job } from '@patchback/types';

import type { DevLogger } from './logging.js';

/**
 * Dev-mode substitute for GitHub webhooks: localhost cannot receive webhook
 * deliveries, so open PRs are POLLED and merged ones walk the canonical
 * tail (`pr.opened → pr.reviewed → patch.shipped → feedback.closed` — a
 * human merging implies review, same rule as the webhook handler).
 *
 * Inbound only, like the webhook path: the poller READS PR status; the one
 * GitHubClient method it touches is `getPullRequestStatus`. Closed-without-
 * merge is logged but changes no state (unrepresentable in the canonical
 * machine — see OPEN_ISSUES).
 */
export interface PrPollerOptions {
  store: Store;
  githubClient: Pick<GitHubClient, 'getPullRequestStatus'>;
  /** Job ids to watch (the instrumented store's ledger). */
  jobIds: () => readonly string[];
  logger: DevLogger;
  intervalMs?: number;
}

export interface PrPoller {
  stop(): void;
  /** One poll pass — exposed for tests and for `stop()`-free harnesses. */
  tick(): Promise<void>;
}

export function startPrPoller(options: PrPollerOptions): PrPoller {
  const { store, githubClient, jobIds, logger } = options;
  const intervalMs = options.intervalMs ?? 15_000;
  const reportedClosed = new Set<string>();
  let ticking = false;

  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      for (const jobId of jobIds()) {
        const job = await store.getJob(jobId);
        if (
          job === undefined ||
          (job.state !== 'pr.opened' && job.state !== 'pr.reviewed') ||
          job.prNumber === undefined
        ) {
          continue;
        }
        let merged: boolean;
        let closed: boolean;
        try {
          const status = await githubClient.getPullRequestStatus(job.prNumber);
          merged = status.merged;
          closed = status.state === 'closed' && !status.merged;
        } catch (error) {
          logger.warn(
            `PR status poll failed for #${job.prNumber}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        if (merged) {
          let updated: Job = job;
          if (updated.state === 'pr.opened') {
            updated = transitionJob(updated, 'pr.reviewed', {
              note: 'merge by a human implies review',
            });
          }
          updated = transitionJob(updated, 'patch.shipped', {
            note: `PR #${job.prNumber} merged`,
          });
          updated = transitionJob(updated, 'feedback.closed');
          await store.updateJob(updated, job.state);
        } else if (closed && !reportedClosed.has(job.id)) {
          reportedClosed.add(job.id);
          logger.warn(
            `PR #${job.prNumber} was closed WITHOUT merging. The job stays at ` +
              `"${job.state}" (closed-without-merge is not part of the canonical ` +
              'state machine); reopen the PR or handle the feedback manually.',
          );
        }
      }
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  return {
    tick,
    stop(): void {
      clearInterval(timer);
    },
  };
}
