import type { FastifyRequest } from 'fastify';

import { canInitiatePatchJob } from '@patchback/types';

import type { Store } from '../store/store.js';

/**
 * Read authorization for a specific feedback item: an owner/insider API key
 * reads anything; otherwise the bearer token must be the item's read token.
 *
 * Callers turn `false` into a 404 (not a 401) so unauthorized probing cannot
 * distinguish "exists" from "does not exist".
 */
export async function canReadFeedback(
  request: FastifyRequest,
  store: Store,
  feedbackId: string,
): Promise<boolean> {
  if (canInitiatePatchJob(request.auth.tier)) {
    return true;
  }
  const token = request.auth.bearerToken;
  if (token === undefined) {
    return false;
  }
  return store.verifyReadToken(feedbackId, token);
}

/** First line of a message, trimmed and capped — used for titles. */
export function firstLine(message: string, cap = 80): string {
  const line = (message.split('\n', 1)[0] ?? '').trim();
  if (line.length <= cap) {
    return line;
  }
  return `${line.slice(0, cap - 1)}…`;
}

/** Shared body schema for feedback messages (10 KiB cap, mirrors triage caps). */
export const MESSAGE_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 10240,
} as const;

export const SUBMITTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 200 },
    name: { type: 'string', maxLength: 200 },
    email: { type: 'string', maxLength: 320 },
  },
} as const;

export const CAPTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string', maxLength: 2000 },
    pageTitle: { type: 'string', maxLength: 1000 },
    element: {
      type: 'object',
      additionalProperties: false,
      required: ['domPath'],
      properties: {
        domPath: { type: 'string', maxLength: 2000 },
        tagName: { type: 'string', maxLength: 100 },
        text: { type: 'string', maxLength: 2000 },
      },
    },
    screenshot: {
      type: 'object',
      additionalProperties: false,
      required: ['dataUri', 'masked'],
      properties: {
        // 512 KiB cap on the data URI, per the capture size rules.
        dataUri: { type: 'string', maxLength: 524288 },
        masked: { type: 'boolean' },
      },
    },
    console: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'message', 'timestamp'],
        properties: {
          level: { type: 'string', enum: ['error', 'warn'] },
          message: { type: 'string', maxLength: 2000 },
          timestamp: { type: 'string', maxLength: 64 },
        },
      },
    },
    viewport: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'number', minimum: 0 },
        height: { type: 'number', minimum: 0 },
      },
    },
    userAgent: { type: 'string', maxLength: 500 },
    capturedAt: { type: 'string', maxLength: 64 },
  },
} as const;

export const ID_PARAMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;
