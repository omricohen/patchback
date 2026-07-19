import type { FastifyInstance } from 'fastify';

import type {
  CaptureContext,
  FeedbackItem,
  Job,
  Submitter,
  TrustTier,
} from '@patchback/types';
import { INITIAL_JOB_STATE, parseSourceHint } from '@patchback/types';

import type { ApiConfig } from '../config.js';
import { ApiError, notFound } from '../errors.js';
import { generateId, generateReadToken, hashReadToken } from '../ids.js';
import type { Store } from '../store/store.js';
import { minTrustTier } from '../trust.js';
import {
  CAPTURE_SCHEMA,
  canReadFeedback,
  ID_PARAMS_SCHEMA,
  MESSAGE_SCHEMA,
  SUBMITTER_SCHEMA,
} from './shared.js';

interface FeedbackBody {
  message: string;
  submitter?: Submitter;
  capture?: CaptureContext;
}

interface ReplyBody {
  message: string;
}

/**
 * POST /feedback, GET /feedback/:id, POST /feedback/:id/reply.
 *
 * Trust boundary notes:
 * - The body schema has `additionalProperties: false` and NO `trustTier`
 *   property: a client-supplied tier is a 400, never silently ignored. Tiers
 *   are stamped exclusively from `request.auth` (server-side key map).
 * - A reply's effective tier is the MINIMUM across its whole thread — the
 *   caller's own tier deliberately does NOT enter the minimum (read access
 *   already proves thread membership; the thread's provenance decides). A
 *   capability-model consequence: a leaked read token lets its holder reply
 *   at the THREAD's tier. Outsider content anywhere in a thread still
 *   poisons every reply, so nothing outsider-rooted can ever be laundered
 *   into a patch job by a trusted replier.
 */
export function registerFeedbackRoutes(
  app: FastifyInstance,
  config: ApiConfig,
): void {
  const { store, queue } = config;
  const nowIso = (): string => (config.now?.() ?? new Date()).toISOString();

  app.post<{ Body: FeedbackBody }>(
    '/feedback',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['message'],
          properties: {
            message: MESSAGE_SCHEMA,
            submitter: SUBMITTER_SCHEMA,
            capture: CAPTURE_SCHEMA,
          },
        },
      },
    },
    async (request, reply) => {
      const created = await createItemWithJob(store, {
        message: request.body.message,
        trustTier: request.auth.tier,
        ...(request.body.submitter !== undefined
          ? { submitter: request.body.submitter }
          : {}),
        ...(request.body.capture !== undefined
          ? { capture: request.body.capture }
          : {}),
        at: nowIso(),
      });
      await queue.enqueue({
        type: 'triage',
        feedbackId: created.item.id,
        jobId: created.job.id,
      });
      return reply.status(201).send({
        id: created.item.id,
        jobId: created.job.id,
        readToken: created.readToken,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/feedback/:id',
    { schema: { params: ID_PARAMS_SCHEMA } },
    async (request, reply) => {
      const { id } = request.params;
      const item = await store.getFeedback(id);
      if (item === undefined || !(await canReadFeedback(request, store, id))) {
        throw notFound('feedback');
      }
      const job = await store.getJobByFeedbackId(id);
      const members = await store.listThread(item.threadId ?? item.id);
      const replies = [];
      for (const member of members) {
        if (member.id === item.id) {
          continue;
        }
        const memberJob = await store.getJobByFeedbackId(member.id);
        replies.push({
          id: member.id,
          message: member.message,
          ...(member.triage !== undefined ? { triage: member.triage } : {}),
          ...(member.inReplyTo !== undefined
            ? { inReplyTo: member.inReplyTo }
            : {}),
          ...(memberJob !== undefined
            ? { jobId: memberJob.id, state: memberJob.state }
            : {}),
          createdAt: member.createdAt,
        });
      }
      return reply.status(200).send({
        id: item.id,
        message: item.message,
        trustTier: item.trustTier,
        ...(item.submitter !== undefined ? { submitter: item.submitter } : {}),
        ...(item.capture !== undefined ? { capture: item.capture } : {}),
        ...(item.triage !== undefined ? { triage: item.triage } : {}),
        ...(item.threadId !== undefined ? { threadId: item.threadId } : {}),
        ...(item.inReplyTo !== undefined ? { inReplyTo: item.inReplyTo } : {}),
        ...(job !== undefined ? { job: { id: job.id, state: job.state } } : {}),
        replies,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    },
  );

  app.post<{ Params: { id: string }; Body: ReplyBody }>(
    '/feedback/:id/reply',
    {
      schema: {
        params: ID_PARAMS_SCHEMA,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['message'],
          properties: { message: MESSAGE_SCHEMA },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const target = await store.getFeedback(id);
      if (
        target === undefined ||
        !(await canReadFeedback(request, store, id))
      ) {
        throw notFound('feedback');
      }
      const targetJob = await store.getJobByFeedbackId(id);
      if (
        targetJob === undefined ||
        targetJob.state !== 'feedback.needs_clarification'
      ) {
        throw new ApiError(
          409,
          'invalid_state',
          'replies are only accepted while the item is awaiting ' +
            `clarification; this item's job is at "${targetJob?.state ?? 'unknown'}"`,
        );
      }

      // Effective tier = MINIMUM across the whole thread (root + members +
      // target). Read access already proves thread membership (read token or
      // trusted key); the thread minimum — not the caller's key — decides,
      // so outsider content anywhere in the thread poisons every reply
      // (nothing outsider-rooted can ever be laundered toward a patch job),
      // while the original submitter replying via read token keeps the tier
      // their submission key earned.
      const threadId = target.threadId ?? target.id;
      const tiers: TrustTier[] = [target.trustTier];
      if (threadId !== target.id) {
        const root = await store.getFeedback(threadId);
        if (root !== undefined) {
          tiers.push(root.trustTier);
        }
      }
      for (const member of await store.listThread(threadId)) {
        tiers.push(member.trustTier);
      }
      const effectiveTier = minTrustTier(tiers);

      const created = await createItemWithJob(store, {
        message: request.body.message,
        trustTier: effectiveTier,
        threadId,
        inReplyTo: target.id,
        at: nowIso(),
      });
      await queue.enqueue({
        type: 'triage',
        feedbackId: created.item.id,
        jobId: created.job.id,
      });
      return reply.status(201).send({
        id: created.item.id,
        jobId: created.job.id,
        readToken: created.readToken,
      });
    },
  );
}

interface CreateItemInput {
  message: string;
  trustTier: TrustTier;
  submitter?: Submitter;
  capture?: CaptureContext;
  threadId?: string;
  inReplyTo?: string;
  at: string;
}

// Defense in depth: the ingest schema is only a loose shape gate, so a hint
// like `../../.env:1` is shape-valid and would otherwise be stored and rendered
// into the triage prompt (the brief factory drops it later, but it should never
// persist). Re-run the authoritative parseSourceHint at ingest and drop any hint
// that fails, so hostile hints never reach the store, the triage LLM, or a
// dashboard. A valid hint is normalized to its file:line form.
function sanitizeCapture(capture: CaptureContext): CaptureContext {
  const element = capture.element;
  if (element?.sourceHint === undefined) return capture;
  const parsed = parseSourceHint(element.sourceHint);
  const normalized = { ...element };
  if (parsed) {
    normalized.sourceHint = `${parsed.file}:${parsed.line}`;
  } else {
    delete normalized.sourceHint;
  }
  return { ...capture, element: normalized };
}

async function createItemWithJob(
  store: Store,
  input: CreateItemInput,
): Promise<{ item: FeedbackItem; job: Job; readToken: string }> {
  const { at, capture, ...fields } = input;
  const item: FeedbackItem = {
    id: generateId(),
    ...fields,
    ...(capture !== undefined ? { capture: sanitizeCapture(capture) } : {}),
    createdAt: at,
    updatedAt: at,
  };
  const readToken = generateReadToken();
  await store.createFeedback(item, hashReadToken(readToken));
  const job: Job = {
    id: generateId(),
    feedbackId: item.id,
    state: INITIAL_JOB_STATE,
    history: [],
    createdAt: at,
    updatedAt: at,
  };
  await store.createJob(job);
  return { item, job, readToken };
}
