import type { FastifyInstance } from 'fastify';

import type { RepoRef } from '@patchback/github';
import type { Job } from '@patchback/types';
import { transitionJob } from '@patchback/types';

import type { Store } from '../store/store.js';
import { verifyWebhookSignature } from '../webhook-verify.js';

/**
 * POST /webhooks/github — inbound PR status only.
 *
 * Structural no-auto-merge: this module receives a Store and a plain RepoRef
 * — it is constructed WITHOUT a GitHubClient, so an outbound GitHub call
 * (let alone a merge) is impossible by wiring, on top of GitHubClient having
 * no merge method at all. State flows IN only.
 *
 * The route is registered ONLY when a webhook secret is configured (see
 * buildServer): an unverified webhook endpoint would be an unauthenticated
 * state-transition API, so it simply does not exist without a secret.
 */
export interface WebhookRouteOptions {
  webhookSecret: string;
  store: Store;
  /** Plain owner/repo value for event correlation — data, not capability. */
  repo: RepoRef;
}

export function registerWebhookRoutes(
  app: FastifyInstance,
  options: WebhookRouteOptions,
): void {
  const { webhookSecret, store, repo } = options;

  // Scoped plugin: a buffer content-type parser so the HMAC is computed over
  // the raw bytes, before ANY parsing. Encapsulated — other routes keep the
  // normal JSON parser.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scope.post('/webhooks/github', async (request, reply) => {
      const raw = request.body;
      if (!Buffer.isBuffer(raw)) {
        return reply.status(400).send({
          error: { code: 'validation', message: 'expected a JSON body' },
        });
      }
      const signature = headerValue(request.headers['x-hub-signature-256']);
      if (!verifyWebhookSignature(webhookSecret, raw, signature)) {
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'invalid webhook signature' },
        });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.status(400).send({
          error: { code: 'validation', message: 'invalid JSON payload' },
        });
      }

      const event = headerValue(request.headers['x-github-event']);
      const result = await handleWebhookEvent(store, repo, event, payload);
      return reply.status(result.status).send({ handled: result.handled });
    });
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

interface WebhookOutcome {
  status: 200 | 202;
  handled: boolean;
}

const IGNORED: WebhookOutcome = { status: 202, handled: false };
const NO_OP: WebhookOutcome = { status: 200, handled: false };
const HANDLED: WebhookOutcome = { status: 200, handled: true };

async function handleWebhookEvent(
  store: Store,
  repo: RepoRef,
  event: string | undefined,
  payload: unknown,
): Promise<WebhookOutcome> {
  if (event !== 'pull_request' && event !== 'pull_request_review') {
    return IGNORED;
  }
  const body = asRecord(payload);
  if (body === undefined) {
    return IGNORED;
  }
  const repository = asRecord(body.repository);
  const fullName = repository?.full_name;
  if (fullName !== `${repo.owner}/${repo.repo}`) {
    return IGNORED;
  }
  const pullRequest = asRecord(body.pull_request);
  if (pullRequest === undefined) {
    return IGNORED;
  }
  const prNumber = pullRequest.number;
  if (typeof prNumber !== 'number') {
    return IGNORED;
  }
  const job = await store.getJobByPrNumber(prNumber);
  if (job === undefined) {
    return IGNORED;
  }

  if (event === 'pull_request_review') {
    if (body.action !== 'submitted') {
      return IGNORED;
    }
    if (job.state !== 'pr.opened') {
      // Already reviewed/shipped/closed — idempotent no-op.
      return NO_OP;
    }
    const reviewed = transitionJob(job, 'pr.reviewed', {
      note: `PR #${prNumber} review submitted`,
    });
    return (await store.updateJob(reviewed, 'pr.opened')) ? HANDLED : NO_OP;
  }

  // event === 'pull_request'
  if (body.action !== 'closed') {
    return IGNORED;
  }
  if (pullRequest.merged !== true) {
    // Closed WITHOUT merge is unrepresentable in the canonical machine — we
    // do not invent an edge. The job rests where it is (see OPEN_ISSUES).
    return IGNORED;
  }
  if (job.state === 'feedback.closed') {
    return NO_OP;
  }
  if (
    job.state !== 'pr.opened' &&
    job.state !== 'pr.reviewed' &&
    job.state !== 'patch.shipped'
  ) {
    return IGNORED;
  }

  // Walk the remaining canonical edges in order — every hop goes through
  // transitionJob; no edge is invented.
  let updated: Job = job;
  if (updated.state === 'pr.opened') {
    updated = transitionJob(updated, 'pr.reviewed', {
      note: `PR #${prNumber} merged by a human (merge implies review)`,
    });
  }
  if (updated.state === 'pr.reviewed') {
    updated = transitionJob(updated, 'patch.shipped', {
      note: `PR #${prNumber} merged`,
    });
  }
  updated = transitionJob(updated, 'feedback.closed');
  return (await store.updateJob(updated, job.state)) ? HANDLED : NO_OP;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
