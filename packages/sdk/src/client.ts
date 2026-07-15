import type { CaptureContext, Submitter } from '@patchback/types';

import { apiErrorFromBody } from './errors.js';
import type {
  FeedbackThreadResponse,
  JobStatusResponse,
  StartJobResponse,
  SubmitResponse,
} from './responses.js';

/**
 * Minimal structural fetch type so the SDK stays environment-neutral (works
 * against both the DOM `fetch` and Node's built-in fetch without pulling in
 * either type universe).
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface PatchbackClientOptions {
  /** API base URL, e.g. `http://localhost:8787` or `/patchback-api`. */
  baseUrl: string;
  /**
   * The EMBEDDING APP's API key (owner/insider tier). Optional — absent
   * means submissions land as `outsider` (data only). See the trust-model
   * warning in the README before shipping a key to a page.
   */
  apiKey?: string;
  /** Injectable fetch. Defaults to the global. */
  fetch?: FetchLike;
}

/**
 * How a read/reply call authenticates. Explicit, never guessy: the caller
 * chooses the per-item read token, or (for trusted dashboard use) the
 * configured API key. There is no silent fallback from one to the other.
 */
export type ReadAuth = { readToken: string } | { useApiKey: true };

export interface SubmitFeedbackInput {
  message: string;
  submitter?: Submitter;
  capture?: CaptureContext;
}

export interface PatchbackClient {
  /** POST /feedback. Sends the API key iff configured. */
  submitFeedback(input: SubmitFeedbackInput): Promise<SubmitResponse>;
  /** GET /feedback/:id — thread view. Unauthorized reads are 404s. */
  getFeedback(id: string, auth: ReadAuth): Promise<FeedbackThreadResponse>;
  /** GET /jobs/:id/status. `state` is the exact canonical JobState. */
  getJobStatus(jobId: string, auth: ReadAuth): Promise<JobStatusResponse>;
  /**
   * POST /feedback/:id/reply. Only accepted while the item's job is at
   * `feedback.needs_clarification` (409 otherwise). Returns a NEW item,
   * NEW job, NEW read token.
   */
  reply(
    feedbackId: string,
    message: string,
    auth: ReadAuth,
  ): Promise<SubmitResponse>;
  /**
   * POST /jobs/:id/start. Requires a configured apiKey; every gate (caller
   * tier, stored-item tier, state, triage classification) is re-enforced
   * server-side — this is a plain wrapper, not an authority.
   */
  startJob(jobId: string): Promise<StartJobResponse>;
}

export function createPatchbackClient(
  options: PatchbackClientOptions,
): PatchbackClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const apiKey = options.apiKey;
  const doFetch: FetchLike =
    options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== 'function') {
    throw new TypeError(
      '@patchback/sdk: no fetch available — pass options.fetch',
    );
  }

  function authHeader(auth: ReadAuth): Record<string, string> {
    if ('readToken' in auth) {
      return { authorization: `Bearer ${auth.readToken}` };
    }
    if (apiKey === undefined) {
      throw new TypeError(
        '@patchback/sdk: `useApiKey: true` requires an apiKey in the client options',
      );
    }
    return { authorization: `Bearer ${apiKey}` };
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    if (response.status < 200 || response.status >= 300) {
      throw apiErrorFromBody(response.status, parsed);
    }
    return parsed as T;
  }

  return {
    async submitFeedback(input) {
      // Typed request builder — never a spread of a caller object, so the
      // `additionalProperties: false` schemas can never see stray fields.
      const body: SubmitFeedbackInput = {
        message: input.message,
        ...(input.submitter !== undefined
          ? { submitter: input.submitter }
          : {}),
        ...(input.capture !== undefined ? { capture: input.capture } : {}),
      };
      const headers: Record<string, string> =
        apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {};
      return request<SubmitResponse>('POST', '/feedback', headers, body);
    },

    async getFeedback(id, auth) {
      return request<FeedbackThreadResponse>(
        'GET',
        `/feedback/${encodeURIComponent(id)}`,
        authHeader(auth),
      );
    },

    async getJobStatus(jobId, auth) {
      return request<JobStatusResponse>(
        'GET',
        `/jobs/${encodeURIComponent(jobId)}/status`,
        authHeader(auth),
      );
    },

    async reply(feedbackId, message, auth) {
      return request<SubmitResponse>(
        'POST',
        `/feedback/${encodeURIComponent(feedbackId)}/reply`,
        authHeader(auth),
        { message },
      );
    },

    async startJob(jobId) {
      if (apiKey === undefined) {
        throw new TypeError(
          '@patchback/sdk: startJob requires an apiKey in the client options',
        );
      }
      return request<StartJobResponse>(
        'POST',
        `/jobs/${encodeURIComponent(jobId)}/start`,
        { authorization: `Bearer ${apiKey}` },
      );
    },
  };
}
