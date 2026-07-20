import type { CaptureContext, Submitter } from '@patchback/types';

import { apiErrorFromBody, PatchbackApiError } from './errors.js';
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

/**
 * A short-lived per-user token and its expiry, as returned by the embedding
 * app's OWN backend endpoint (which exchanges its server key at Patchback's
 * `POST /tokens/exchange`). The SDK never calls `/tokens/exchange` itself — it
 * has no parent key and that endpoint rejects browsers.
 */
export interface TokenGrant {
  token: string;
  /** ISO-8601 expiry; the SDK refreshes shortly before this. */
  expiresAt: string;
}

/** A provider the embedding app supplies: fetch a fresh token from ITS backend. */
export type TokenProvider = () => Promise<TokenGrant>;

export interface PatchbackClientOptions {
  /** API base URL, e.g. `http://localhost:8787` or `/patchback-api`. */
  baseUrl: string;
  /**
   * The EMBEDDING APP's API key (owner/insider tier). Optional — absent
   * means submissions land as `outsider` (data only). See the trust-model
   * warning in the README before shipping a key to a page.
   *
   * For PUBLIC-FACING apps prefer `getToken` instead: a short-lived,
   * tier-scoped per-user token that is safe to expose in page source.
   * `apiKey` and `getToken` are mutually exclusive.
   */
  apiKey?: string;
  /**
   * A short-lived-token provider (recommended for multi-user / public-facing
   * apps). The SDK calls it to obtain the credential, caches the token, and
   * re-invokes it shortly before `expiresAt` (and once on a tier-related 4xx).
   * Mutually exclusive with `apiKey`. See the "Per-user tokens" README section.
   */
  getToken?: TokenProvider;
  /** Injectable fetch. Defaults to the global. */
  fetch?: FetchLike;
  /** Clock injection for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
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
  const getToken = options.getToken;
  if (apiKey !== undefined && getToken !== undefined) {
    throw new TypeError(
      '@patchback/sdk: pass either `apiKey` OR `getToken`, not both — the ' +
        'direct key and the per-user token path are mutually exclusive',
    );
  }
  const now = options.now ?? ((): number => Date.now());
  const doFetch: FetchLike =
    options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== 'function') {
    throw new TypeError(
      '@patchback/sdk: no fetch available — pass options.fetch',
    );
  }

  // Whether this client carries an app-level credential (key or token) — the
  // capability required to read via `useApiKey` and to start jobs.
  const hasAppCredential = apiKey !== undefined || getToken !== undefined;

  // Refresh a cached token this many ms before it actually expires.
  const REFRESH_SKEW_MS = 5000;
  let cached: { token: string; expiresAtMs: number } | undefined;

  /** The current app-credential bearer value (fresh token / static key / none). */
  async function appCredential(
    forceRefresh = false,
  ): Promise<string | undefined> {
    if (apiKey !== undefined) {
      return apiKey;
    }
    if (getToken === undefined) {
      return undefined;
    }
    if (
      !forceRefresh &&
      cached !== undefined &&
      now() < cached.expiresAtMs - REFRESH_SKEW_MS
    ) {
      return cached.token;
    }
    const grant = await getToken();
    cached = { token: grant.token, expiresAtMs: Date.parse(grant.expiresAt) };
    return grant.token;
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

  /**
   * Run an app-credentialed request. On a tier-related 403 with a token
   * provider, refresh the token ONCE and retry — a stale (expired) token
   * demotes to outsider server-side, so a refresh may recover the tier.
   */
  async function withAppCredential<T>(
    run: (bearer: string) => Promise<T>,
  ): Promise<T> {
    const bearer = await appCredential();
    if (bearer === undefined) {
      throw new TypeError(
        '@patchback/sdk: this call requires an `apiKey` or `getToken` in the ' +
          'client options',
      );
    }
    try {
      return await run(bearer);
    } catch (error) {
      if (
        getToken !== undefined &&
        error instanceof PatchbackApiError &&
        error.status === 403 &&
        (error.code === 'tier_forbidden' || error.code === 'tier_ceiling')
      ) {
        const refreshed = await appCredential(true);
        if (refreshed !== undefined && refreshed !== bearer) {
          return run(refreshed);
        }
      }
      throw error;
    }
  }

  async function authHeader(auth: ReadAuth): Promise<Record<string, string>> {
    if ('readToken' in auth) {
      return { authorization: `Bearer ${auth.readToken}` };
    }
    const bearer = await appCredential();
    if (bearer === undefined) {
      throw new TypeError(
        '@patchback/sdk: `useApiKey: true` requires an `apiKey` or `getToken` ' +
          'in the client options',
      );
    }
    return { authorization: `Bearer ${bearer}` };
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
      const bearer = await appCredential();
      const headers: Record<string, string> =
        bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {};
      return request<SubmitResponse>('POST', '/feedback', headers, body);
    },

    async getFeedback(id, auth) {
      return request<FeedbackThreadResponse>(
        'GET',
        `/feedback/${encodeURIComponent(id)}`,
        await authHeader(auth),
      );
    },

    async getJobStatus(jobId, auth) {
      return request<JobStatusResponse>(
        'GET',
        `/jobs/${encodeURIComponent(jobId)}/status`,
        await authHeader(auth),
      );
    },

    async reply(feedbackId, message, auth) {
      return request<SubmitResponse>(
        'POST',
        `/feedback/${encodeURIComponent(feedbackId)}/reply`,
        await authHeader(auth),
        { message },
      );
    },

    async startJob(jobId) {
      if (!hasAppCredential) {
        throw new TypeError(
          '@patchback/sdk: startJob requires an `apiKey` or `getToken` in the ' +
            'client options',
        );
      }
      return withAppCredential((bearer) =>
        request<StartJobResponse>(
          'POST',
          `/jobs/${encodeURIComponent(jobId)}/start`,
          { authorization: `Bearer ${bearer}` },
        ),
      );
    },
  };
}
