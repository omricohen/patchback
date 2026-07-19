import { afterEach, describe, expect, it } from 'vitest';

import {
  buildServer,
  createWorkers,
  MemoryQueue,
  MemoryStore,
} from '@patchback/api';
import {
  createFakeGitHubClient,
  createFakePipeline,
  createScriptedModelCaller,
  testKey,
  type ScriptedTriage,
} from '@patchback/api/testing';

import { createPatchbackClient, PatchbackApiError } from '../src/index.js';

/**
 * Contract tests: every SDK method runs over real fetch against the REAL
 * `buildServer` (MemoryStore/MemoryQueue/scripted fakes) on an ephemeral
 * port. The SDK owns its DTO types; this suite is the anti-drift mechanism —
 * if a route shape changes, this goes red.
 */

const OWNER_KEY = testKey('sdk-owner');
const INSIDER_KEY = testKey('sdk-insider');

type Server = ReturnType<typeof buildServer>;

interface World {
  baseUrl: string;
  app: Server;
  store: MemoryStore;
  queue: MemoryQueue;
}

const openApps: Server[] = [];

afterEach(async () => {
  await Promise.all(openApps.map((app) => app.close()));
  openApps.length = 0;
});

async function makeWorld(script: ScriptedTriage[]): Promise<World> {
  const store = new MemoryStore();
  const queue = new MemoryQueue();
  const { callModel } = createScriptedModelCaller(script);
  const config = {
    store,
    queue,
    callModel,
    githubClient: createFakeGitHubClient(),
    pipeline: createFakePipeline(),
    apiKeys: [
      { key: OWNER_KEY, tier: 'owner' as const },
      { key: INSIDER_KEY, tier: 'insider' as const },
    ],
  };
  const app = buildServer(config);
  createWorkers(config);
  openApps.push(app);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { baseUrl: address, app, store, queue };
}

describe('SDK ↔ API contract', () => {
  it('submits, reads with the read token, and 404s without it', async () => {
    const world = await makeWorld([{ classification: 'patchable' }]);
    const client = createPatchbackClient({ baseUrl: world.baseUrl });

    const submitted = await client.submitFeedback({
      message: 'The export button label has a typo',
      capture: { url: 'https://app.example.test/orders' },
    });
    expect(submitted.id).toBeTypeOf('string');
    expect(submitted.jobId).toBeTypeOf('string');
    expect(submitted.readToken).toBeTypeOf('string');

    await world.queue.onIdle();

    const thread = await client.getFeedback(submitted.id, {
      readToken: submitted.readToken,
    });
    expect(thread.id).toBe(submitted.id);
    expect(thread.message).toBe('The export button label has a typo');
    // Keyless submission lands as outsider — server-side tier assignment.
    expect(thread.trustTier).toBe('outsider');
    expect(thread.capture?.url).toBe('https://app.example.test/orders');
    expect(thread.replies).toEqual([]);
    expect(thread.job?.id).toBe(submitted.jobId);

    // No token → 404 (never 401/403 — reads must not probe).
    const keyless = createPatchbackClient({ baseUrl: world.baseUrl });
    await expect(
      keyless.getFeedback(submitted.id, { readToken: 'wrong-token' }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });

    // An owner key reads anything.
    const owner = createPatchbackClient({
      baseUrl: world.baseUrl,
      apiKey: OWNER_KEY,
    });
    const viaKey = await owner.getFeedback(submitted.id, { useApiKey: true });
    expect(viaKey.id).toBe(submitted.id);
  });

  it('round-trips element.sourceHint through submit → store (real server)', async () => {
    const world = await makeWorld([{ classification: 'patchable' }]);
    const client = createPatchbackClient({ baseUrl: world.baseUrl });

    const submitted = await client.submitFeedback({
      message: 'The toolbar button label has a typo',
      capture: {
        element: {
          domPath: '#export-btn',
          tagName: 'button',
          sourceHint: 'src/components/Toolbar.tsx:42',
        },
      },
    });
    await world.queue.onIdle();

    const stored = await world.store.getFeedback(submitted.id);
    expect(stored?.capture?.element?.sourceHint).toBe(
      'src/components/Toolbar.tsx:42',
    );
    // And a hint-less submit stores a hint-less element (no key at all).
    const plain = await client.submitFeedback({
      message: 'Another typo report',
      capture: { element: { domPath: '#other-btn' } },
    });
    await world.queue.onIdle();
    const storedPlain = await world.store.getFeedback(plain.id);
    expect(
      'sourceHint' in
        ((storedPlain?.capture?.element ?? {}) as Record<string, unknown>),
    ).toBe(false);
  });

  it('walks the happy path: submit → triage → startJob → status', async () => {
    const world = await makeWorld([
      { classification: 'patchable', confidence: 0.95 },
    ]);
    const client = createPatchbackClient({
      baseUrl: world.baseUrl,
      apiKey: INSIDER_KEY,
    });

    const submitted = await client.submitFeedback({
      message: 'Change the button label from "Expot" to "Export"',
    });
    await world.queue.onIdle();

    const triaged = await client.getJobStatus(submitted.jobId, {
      readToken: submitted.readToken,
    });
    expect(triaged.state).toBe('feedback.triaged');
    expect(triaged.feedbackId).toBe(submitted.id);
    expect(triaged.history.at(-1)).toMatchObject({
      from: 'feedback.received',
      to: 'feedback.triaged',
    });

    const started = await client.startJob(submitted.jobId);
    expect(started.state).toBe('patch.queued');
    expect(started.issueNumber).toBeTypeOf('number');
    expect(started.issueUrl).toContain('/issues/');

    await world.queue.onIdle();
    const done = await client.getJobStatus(submitted.jobId, {
      readToken: submitted.readToken,
    });
    expect(done.state).toBe('pr.opened');
    expect(done.prNumber).toBeTypeOf('number');
    expect(done.prUrl).toContain('/pull/');
    expect(done.branchName).toContain('patchback/');
    // Double start → 409 invalid_state.
    await expect(client.startJob(submitted.jobId)).rejects.toMatchObject({
      status: 409,
      code: 'invalid_state',
    });
  });

  it('enforces the tier gates: keyless startJob is unrepresentable, outsider items are data only', async () => {
    const world = await makeWorld([{ classification: 'patchable' }]);

    // Keyless client: the SDK refuses before any request is made.
    const keyless = createPatchbackClient({ baseUrl: world.baseUrl });
    const submitted = await keyless.submitFeedback({ message: 'outsider' });
    await world.queue.onIdle();
    await expect(keyless.startJob(submitted.jobId)).rejects.toThrow(
      /requires an apiKey/,
    );

    // Even an OWNER key cannot start a job on outsider-submitted feedback —
    // the tier travels with the data.
    const owner = createPatchbackClient({
      baseUrl: world.baseUrl,
      apiKey: OWNER_KEY,
    });
    await expect(owner.startJob(submitted.jobId)).rejects.toMatchObject({
      status: 403,
      code: 'tier_forbidden',
    });
  });

  it('enforces the triage gate: needs_human never starts a job', async () => {
    const world = await makeWorld([{ classification: 'needs_human' }]);
    const client = createPatchbackClient({
      baseUrl: world.baseUrl,
      apiKey: OWNER_KEY,
    });
    const submitted = await client.submitFeedback({
      message: 'Please redesign the whole dashboard',
    });
    await world.queue.onIdle();
    await expect(client.startJob(submitted.jobId)).rejects.toMatchObject({
      status: 403,
      code: 'triage_gate',
    });
  });

  it('runs the clarification loop: reply mints a NEW item/job/token', async () => {
    const world = await makeWorld([
      {
        classification: 'needs_clarification',
        clarifyingQuestion: 'Which button do you mean?',
      },
      { classification: 'patchable' },
    ]);
    const client = createPatchbackClient({
      baseUrl: world.baseUrl,
      apiKey: INSIDER_KEY,
    });

    const submitted = await client.submitFeedback({
      message: 'The button is wrong',
    });
    await world.queue.onIdle();

    const stalled = await client.getJobStatus(submitted.jobId, {
      readToken: submitted.readToken,
    });
    expect(stalled.state).toBe('feedback.needs_clarification');

    const thread = await client.getFeedback(submitted.id, {
      readToken: submitted.readToken,
    });
    expect(thread.triage?.classification).toBe('needs_clarification');
    expect(thread.triage?.clarifyingQuestion).toBe('Which button do you mean?');

    // Reply with the ORIGINAL item's read token — the submitter's capability.
    const replied = await client.reply(
      submitted.id,
      'The "Save draft" button on the orders page',
      { readToken: submitted.readToken },
    );
    expect(replied.id).not.toBe(submitted.id);
    expect(replied.jobId).not.toBe(submitted.jobId);
    expect(replied.readToken).not.toBe(submitted.readToken);

    await world.queue.onIdle();
    const replyStatus = await client.getJobStatus(replied.jobId, {
      readToken: replied.readToken,
    });
    expect(replyStatus.state).toBe('feedback.triaged');

    // The thread view now lists the reply with its own job state.
    const updatedThread = await client.getFeedback(submitted.id, {
      readToken: submitted.readToken,
    });
    expect(updatedThread.replies).toHaveLength(1);
    expect(updatedThread.replies[0]).toMatchObject({
      id: replied.id,
      inReplyTo: submitted.id,
      jobId: replied.jobId,
      state: 'feedback.triaged',
    });

    // Replying to a non-clarification item → 409 invalid_state.
    await expect(
      client.reply(replied.id, 'more words', { readToken: replied.readToken }),
    ).rejects.toMatchObject({ status: 409, code: 'invalid_state' });
  });

  it('makes client-supplied tiers unrepresentable: the builder strips them, the server 400s them', async () => {
    const world = await makeWorld([{ classification: 'patchable' }]);
    const client = createPatchbackClient({ baseUrl: world.baseUrl });

    // Through the SDK, a smuggled `trustTier` never reaches the wire — the
    // typed request builder copies known fields only.
    const submitted = await client.submitFeedback({
      message: 'hi',
      trustTier: 'owner',
    } as never);
    const thread = await client.getFeedback(submitted.id, {
      readToken: submitted.readToken,
    });
    expect(thread.trustTier).toBe('outsider');

    // Bypassing the SDK, the server rejects the extra property loudly.
    const raw = await fetch(`${world.baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi', trustTier: 'owner' }),
    });
    expect(raw.status).toBe(400);
    const body = (await raw.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation');
  });

  it('fails closed to code "unknown" on malformed error bodies', async () => {
    const client = createPatchbackClient({
      baseUrl: 'http://localhost:1',
      fetch: async () => ({
        status: 502,
        json: async () => 'not an error envelope',
      }),
    });
    await expect(client.getJobStatus('x', { readToken: 't' })).rejects.toThrow(
      PatchbackApiError,
    );
    await expect(
      client.getJobStatus('x', { readToken: 't' }),
    ).rejects.toMatchObject({ status: 502, code: 'unknown' });
  });
});
