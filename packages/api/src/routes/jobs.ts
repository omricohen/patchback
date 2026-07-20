import type { FastifyInstance } from 'fastify';

import {
  canInitiatePatchJob,
  isSafeHttpUrl,
  transitionJob,
} from '@patchback/types';

import type { ApiConfig } from '../config.js';
import { ApiError, notFound, StoreIntegrityError } from '../errors.js';
import { assertTrustTier } from '../trust.js';
import { canReadFeedback, firstLine, ID_PARAMS_SCHEMA } from './shared.js';

/**
 * POST /jobs/:id/start, GET /jobs/:id/status.
 *
 * Two DISTINCT tier checks guard job start — both server-side, both required:
 *
 * 1. Caller authz: the API key's tier must be patch-eligible. Anonymous
 *    callers cannot start jobs, period.
 * 2. Data-source rule (THE boundary): the STORED feedback item's tier must be
 *    patch-eligible. An owner key can NOT start a job on outsider feedback —
 *    the tier travels with the data, not the caller.
 *
 * Plus triage-before-code: only items triage classified `patchable` may
 * start, and only from the `feedback.triaged` state.
 */
export function registerJobRoutes(
  app: FastifyInstance,
  config: ApiConfig,
): void {
  const { store, queue, githubClient } = config;

  app.post<{ Params: { id: string } }>(
    '/jobs/:id/start',
    { schema: { params: ID_PARAMS_SCHEMA } },
    async (request, reply) => {
      // Check 1: caller authorization.
      if (!canInitiatePatchJob(request.auth.tier)) {
        throw new ApiError(
          403,
          'tier_forbidden',
          'an owner or insider API key is required to start a patch job',
        );
      }

      const job = await store.getJob(request.params.id);
      if (job === undefined) {
        throw notFound('job');
      }
      const item = await store.getFeedback(job.feedbackId);
      if (item === undefined) {
        throw new StoreIntegrityError(
          `job ${job.id} references missing feedback ${job.feedbackId}`,
        );
      }

      // Check 2: the data-source rule. Runtime-revalidate the stored tier
      // (fail closed on corruption), then enforce the boundary: outsider
      // feedback is data only, regardless of who is asking.
      const itemTier = assertTrustTier(item.trustTier, `feedback ${item.id}`);
      if (!canInitiatePatchJob(itemTier)) {
        throw new ApiError(
          403,
          'tier_forbidden',
          'outsider feedback is data only — it can never start a patch job, ' +
            'regardless of the caller’s tier',
        );
      }

      // State gate (also the double-click guard).
      if (job.state !== 'feedback.triaged') {
        throw new ApiError(
          409,
          'invalid_state',
          `job is at "${job.state}"; a patch can only be started from "feedback.triaged"`,
        );
      }

      // Triage gate: triage before code, server-enforced.
      const classification = item.triage?.classification;
      if (classification !== 'patchable') {
        throw new ApiError(
          403,
          'triage_gate',
          classification === undefined
            ? 'this item has not been triaged yet'
            : classification === 'needs_human'
              ? 'triage classified this item "needs_human" — a human must handle it; it cannot start a patch job'
              : 'triage classified this item "needs_clarification" — answer the clarifying question (POST /feedback/:id/reply) instead',
        );
      }

      // Issue creation is synchronous so the caller gets a real error when
      // the token is bad; it is one fast API call.
      const issue = await githubClient.createIssue({
        title: firstLine(item.message),
        body: buildIssueBody(item.message, item.triage?.reasoning, item.id),
        labels: ['patchback'],
      });

      let updated = transitionJob(job, 'issue.created', {
        note: `issue #${issue.number}`,
      });
      updated = { ...updated, issueNumber: issue.number };
      updated = transitionJob(updated, 'patch.queued');
      const swapped = await store.updateJob(updated, 'feedback.triaged');
      if (!swapped) {
        throw new ApiError(
          409,
          'conflict',
          'job state changed concurrently; patch not started',
        );
      }
      await queue.enqueue({ type: 'patch', jobId: job.id });
      return reply.status(202).send({
        id: job.id,
        state: updated.state,
        issueNumber: issue.number,
        issueUrl: issue.url,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/jobs/:id/status',
    { schema: { params: ID_PARAMS_SCHEMA } },
    async (request, reply) => {
      const job = await store.getJob(request.params.id);
      if (
        job === undefined ||
        !(await canReadFeedback(request, store, job.feedbackId))
      ) {
        throw notFound('job');
      }
      // 1:1 canonical mapping: `state` is the exact JobState string and
      // `history` is the transitionJob audit trail. No display vocabulary is
      // invented server-side; presentation is the widget's job.
      return reply.status(200).send({
        id: job.id,
        feedbackId: job.feedbackId,
        state: job.state,
        history: job.history,
        ...(job.issueNumber !== undefined
          ? { issueNumber: job.issueNumber }
          : {}),
        ...(job.branchName !== undefined ? { branchName: job.branchName } : {}),
        ...(job.prNumber !== undefined ? { prNumber: job.prNumber } : {}),
        ...(job.prUrl !== undefined ? { prUrl: job.prUrl } : {}),
        ...(job.userSummary !== undefined
          ? { userSummary: job.userSummary }
          : {}),
        // Defence in depth: only surface a previewUrl that still validates as
        // a safe http(s) URL (it was validated at write time too).
        ...(job.previewUrl !== undefined && isSafeHttpUrl(job.previewUrl)
          ? { previewUrl: job.previewUrl }
          : {}),
        ...(job.error !== undefined ? { error: job.error } : {}),
      });
    },
  );
}

function buildIssueBody(
  message: string,
  reasoning: string | undefined,
  feedbackId: string,
): string {
  const parts = [
    '## Feedback',
    '',
    message,
    '',
    '## Triage',
    '',
    reasoning ?? '(no reasoning recorded)',
    '',
    `_Patchback feedback id: ${feedbackId}_`,
  ];
  return parts.join('\n');
}
