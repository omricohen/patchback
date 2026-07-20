import type { Store } from '@patchback/api';
import type { GitHubClient } from '@patchback/github';
import { isSafeHttpUrl, transitionJob, type Job } from '@patchback/types';

import type { DevLogger } from './logging.js';

/**
 * Dev-mode substitute for GitHub webhooks: localhost cannot receive webhook
 * deliveries, so open PRs are POLLED and merged ones walk the canonical
 * tail (`pr.opened → pr.reviewed → patch.shipped → feedback.closed` — a
 * human merging implies review, same rule as the webhook handler).
 *
 * Inbound only, like the webhook path: the poller READS PR status and (for
 * jobs without one yet) the host's OWN preview deployment URL. Both are
 * read-only surfacing — the poller never writes to GitHub. Closed-without-
 * merge is logged but changes no state (unrepresentable in the canonical
 * machine — see OPEN_ISSUES).
 */
export interface PrPollerOptions {
  store: Store;
  githubClient: Pick<
    GitHubClient,
    'getPullRequestStatus' | 'getPreviewDeploymentUrl'
  >;
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
        let headSha: string;
        try {
          const status = await githubClient.getPullRequestStatus(job.prNumber);
          merged = status.merged;
          closed = status.state === 'closed' && !status.merged;
          headSha = status.headSha;
        } catch (error) {
          logger.warn(
            `PR status poll failed for #${job.prNumber}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }

        // Best-effort preview surfacing: while the PR is open and the job has
        // no previewUrl yet, ask the host's OWN deploy provider (via the
        // Deployments API) for a preview URL. Error-isolated and idempotent —
        // once set, we never query deployments for this job again. A deploy
        // finishes seconds-to-minutes after the PR opens, so we keep trying
        // across ticks until the first success. The result folds into the
        // local job so the merge-tail write below cannot clobber it.
        let baseJob: Job = job;
        if (job.previewUrl === undefined) {
          try {
            const previewUrl =
              await githubClient.getPreviewDeploymentUrl(headSha);
            if (previewUrl !== undefined && isSafeHttpUrl(previewUrl)) {
              baseJob = { ...job, previewUrl };
              // Metadata-only write: state unchanged, CAS'd on it so a
              // concurrent transition simply wins and we retry next tick.
              await store.updateJob(baseJob, job.state);
            }
          } catch (error) {
            logger.warn(
              `Preview deployment poll failed for #${job.prNumber}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        if (merged) {
          let updated: Job = baseJob;
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
