import { isTerminalJobState } from '@patchback/types';

import { PatchbackApiError } from './errors.js';
import type { PatchbackClient, ReadAuth } from './client.js';
import type { JobStatusResponse } from './responses.js';

export interface PollJobStatusOptions {
  /** Called with every successful status read (including the final one). */
  onUpdate?: (status: JobStatusResponse) => void;
  /**
   * Called when a read fails transiently (network error or 5xx) and polling
   * continues with backoff. NOT called for 404 — that stops the poll.
   */
  onConnectionIssue?: (error: unknown) => void;
  /** Abort to stop polling; the returned promise rejects with the reason. */
  signal?: AbortSignal;
  /** Interval while the job is still pre-triage. Default 2500 ms. */
  fastMs?: number;
  /** Interval after `feedback.triaged` (human/agent timescales). Default 15000 ms. */
  slowMs?: number;
  /** Backoff ceiling for transient failures. Default 60000 ms. */
  maxBackoffMs?: number;
}

/**
 * Poll GET /jobs/:id/status until a terminal state.
 *
 * - Fast interval until the job leaves `feedback.received`, then slow —
 *   states after triage advance on human/agent timescales.
 * - Resolves at any terminal state (`isTerminalJobState`).
 * - Transient failures (network, 5xx) keep polling with capped exponential
 *   backoff and surface through `onConnectionIssue`.
 * - A 404 rejects immediately: the token was revoked or the item is gone,
 *   and polling a 404 forever is a probe pattern the server deliberately
 *   starves.
 * - No websockets, no SSE, no timers beyond `setTimeout` — page-visibility
 *   pausing is the widget's job via `signal`.
 */
export async function pollJobStatus(
  client: PatchbackClient,
  jobId: string,
  auth: ReadAuth,
  options: PollJobStatusOptions = {},
): Promise<JobStatusResponse> {
  const fastMs = options.fastMs ?? 2500;
  const slowMs = options.slowMs ?? 15000;
  const maxBackoffMs = options.maxBackoffMs ?? 60000;
  const signal = options.signal;

  let backoffMs: number | undefined;
  let lastState: JobStatusResponse['state'] = 'feedback.received';

  for (;;) {
    throwIfAborted(signal);
    try {
      const status = await client.getJobStatus(jobId, auth);
      backoffMs = undefined;
      lastState = status.state;
      options.onUpdate?.(status);
      if (isTerminalJobState(status.state)) {
        return status;
      }
    } catch (error) {
      if (error instanceof PatchbackApiError && error.status === 404) {
        throw error;
      }
      if (
        error instanceof PatchbackApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        // Non-transient client error — retrying cannot help.
        throw error;
      }
      const base = lastState === 'feedback.received' ? fastMs : slowMs;
      backoffMs = Math.min(
        backoffMs === undefined ? base * 2 : backoffMs * 2,
        maxBackoffMs,
      );
      options.onConnectionIssue?.(error);
    }
    const interval =
      backoffMs ?? (lastState === 'feedback.received' ? fastMs : slowMs);
    await sleep(interval, signal);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('polling aborted');
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('polling aborted'),
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
