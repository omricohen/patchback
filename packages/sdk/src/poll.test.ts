import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobState } from '@patchback/types';

import type { PatchbackClient } from './client.js';
import { PatchbackApiError } from './errors.js';
import { pollJobStatus } from './poll.js';
import type { JobStatusResponse } from './responses.js';

/**
 * Poll-helper behavior under fake timers: fast→slow switchover, terminal
 * stop (for every terminal state), backoff on transient failure, hard stop
 * on 404, abort.
 */

function status(state: JobState): JobStatusResponse {
  return { id: 'job-1', feedbackId: 'fb-1', state, history: [] };
}

type Step = JobStatusResponse | Error;

function scriptedClient(steps: Step[]): {
  client: PatchbackClient;
  calls: () => number;
} {
  let call = 0;
  const client = {
    getJobStatus: async (): Promise<JobStatusResponse> => {
      const step = steps[Math.min(call, steps.length - 1)];
      call += 1;
      if (step instanceof Error) {
        throw step;
      }
      if (step === undefined) {
        throw new Error('script exhausted');
      }
      return step;
    },
  } as unknown as PatchbackClient;
  return { client, calls: () => call };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pollJobStatus', () => {
  it('resolves at every terminal state without further polling', async () => {
    const terminals: JobState[] = [
      'feedback.needs_clarification',
      'patch.failed',
      'feedback.closed',
    ];
    for (const terminal of terminals) {
      const { client, calls } = scriptedClient([status(terminal)]);
      const result = await pollJobStatus(client, 'job-1', {
        readToken: 't',
      });
      expect(result.state).toBe(terminal);
      expect(calls()).toBe(1);
    }
  });

  it('reports every canonical state through onUpdate and stops at terminal', async () => {
    const walk: JobState[] = [
      'feedback.received',
      'feedback.triaged',
      'patch.queued',
      'patch.running',
      'pr.opened',
      'feedback.closed',
    ];
    const { client } = scriptedClient(walk.map(status));
    const seen: JobState[] = [];
    const promise = pollJobStatus(
      client,
      'job-1',
      { readToken: 't' },
      { onUpdate: (s) => seen.push(s.state) },
    );
    await vi.runAllTimersAsync();
    const final = await promise;
    expect(final.state).toBe('feedback.closed');
    expect(seen).toEqual(walk);
  });

  it('polls fast before triage and slow after', async () => {
    const { client, calls } = scriptedClient([
      status('feedback.received'),
      status('feedback.triaged'),
      status('patch.queued'),
      status('feedback.closed'),
    ]);
    const promise = pollJobStatus(
      client,
      'job-1',
      { readToken: 't' },
      { fastMs: 1000, slowMs: 10000 },
    );
    // First read happens immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    // Still pre-triage → fast interval.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(2);
    // Now triaged → the fast interval must NOT trigger another read.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(9000);
    expect(calls()).toBe(3);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({
      state: 'feedback.closed',
    });
  });

  it('backs off on transient failures (capped) and keeps polling', async () => {
    const boom = new Error('ECONNREFUSED');
    const { client, calls } = scriptedClient([
      status('feedback.received'),
      boom,
      boom,
      status('feedback.closed'),
    ]);
    const issues: unknown[] = [];
    const promise = pollJobStatus(
      client,
      'job-1',
      { readToken: 't' },
      {
        fastMs: 1000,
        slowMs: 10000,
        maxBackoffMs: 3000,
        onConnectionIssue: (e) => issues.push(e),
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    // Normal fast interval → first failure.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(2);
    // Backoff 2×fast = 2000 → second failure.
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(3);
    // Backoff doubles but is capped at 3000.
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls()).toBe(4);
    await expect(promise).resolves.toMatchObject({
      state: 'feedback.closed',
    });
    expect(issues).toEqual([boom, boom]);
  });

  it('treats a 5xx PatchbackApiError as transient', async () => {
    const { client } = scriptedClient([
      new PatchbackApiError(500, 'internal', 'internal server error'),
      status('feedback.closed'),
    ]);
    const issues: unknown[] = [];
    const promise = pollJobStatus(
      client,
      'job-1',
      { readToken: 't' },
      { onConnectionIssue: (e) => issues.push(e) },
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({
      state: 'feedback.closed',
    });
    expect(issues).toHaveLength(1);
  });

  it('stops hard on 404 — never polls a revoked/missing item', async () => {
    const gone = new PatchbackApiError(404, 'not_found', 'job not found');
    const { client, calls } = scriptedClient([gone]);
    await expect(
      pollJobStatus(client, 'job-1', { readToken: 't' }),
    ).rejects.toBe(gone);
    expect(calls()).toBe(1);
  });

  it('rejects on abort, including mid-sleep', async () => {
    const { client } = scriptedClient([status('feedback.received')]);
    const controller = new AbortController();
    const promise = pollJobStatus(
      client,
      'job-1',
      { readToken: 't' },
      { signal: controller.signal },
    );
    const expectation = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expectation;
  });
});
