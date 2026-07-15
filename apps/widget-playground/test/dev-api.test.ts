import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DevApi } from '../scripts/dev-api.mjs';

/**
 * Default-green harness smoke test (no browser): the fake-pipeline dev API
 * composes the REAL server/store/queue/workers and walks the canonical
 * states end to end, including the signed merge helper.
 */
describe('playground dev API harness', () => {
  let api: DevApi;

  beforeAll(async () => {
    const { createDevApi } = await import('../scripts/dev-api.mjs');
    api = await createDevApi({ port: 8798, triageDelayMs: 0, patchDelayMs: 0 });
  });

  afterAll(async () => {
    await api.close();
  });

  it('walks submit → triage → start → PR → merge → closed with dev keys', async () => {
    const base = 'http://127.0.0.1:8798';
    const submit = await fetch(`${base}/feedback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${api.keys.insider}`,
      },
      body: JSON.stringify({ message: 'Fix the export button label' }),
    });
    expect(submit.status).toBe(201);
    const { id, jobId, readToken } = (await submit.json()) as {
      id: string;
      jobId: string;
      readToken: string;
    };
    await api.queue.onIdle();

    const start = await fetch(`${base}/jobs/${jobId}/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${api.keys.insider}` },
    });
    expect(start.status).toBe(202);
    await api.queue.onIdle();

    const status = await fetch(`${base}/jobs/${jobId}/status`, {
      headers: { authorization: `Bearer ${readToken}` },
    });
    const body = (await status.json()) as {
      state: string;
      prNumber?: number;
    };
    expect(body.state).toBe('pr.opened');
    expect(body.prNumber).toBeTypeOf('number');

    const merge = await fetch(`${base}/_dev/merge/${body.prNumber}`, {
      method: 'POST',
    });
    expect(merge.status).toBe(200);

    const closed = await fetch(`${base}/jobs/${jobId}/status`, {
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(((await closed.json()) as { state: string }).state).toBe(
      'feedback.closed',
    );
    expect(api.createdFeedbackIds).toContain(id);
  });

  it('keyword-scripts the clarification and needs_human branches', async () => {
    const base = 'http://127.0.0.1:8798';
    // NOTE: keyless submissions are outsiders and short-circuit to
    // needs_human with ZERO model calls — the keyword script only ever sees
    // keyed traffic.
    const outsider = await fetch(`${base}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '[clarify] what is this?' }),
    });
    const outsiderBody = (await outsider.json()) as {
      jobId: string;
      readToken: string;
    };
    await api.queue.onIdle();
    const outsiderStatus = await fetch(
      `${base}/jobs/${outsiderBody.jobId}/status`,
      { headers: { authorization: `Bearer ${outsiderBody.readToken}` } },
    );
    expect(((await outsiderStatus.json()) as { state: string }).state).toBe(
      'feedback.triaged', // needs_human rests here; data only.
    );

    const clarify = await fetch(`${base}/feedback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${api.keys.insider}`,
      },
      body: JSON.stringify({ message: '[clarify] what is this?' }),
    });
    const { jobId, readToken } = (await clarify.json()) as {
      jobId: string;
      readToken: string;
    };
    await api.queue.onIdle();
    const status = await fetch(`${base}/jobs/${jobId}/status`, {
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(((await status.json()) as { state: string }).state).toBe(
      'feedback.needs_clarification',
    );
  });
});
