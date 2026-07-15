import { createHmac } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeGitHubClient,
  createFakePipeline,
  createScriptedModelCaller,
  testKey,
  type FakeGitHubClient,
  type FakePipeline,
  type ScriptedTriage,
} from '../src/testing.js';
import { buildServer } from '../src/server.js';
import { createWorkers } from '../src/workers/index.js';
import { MemoryQueue } from '../src/queue/memory.js';
import { MemoryStore } from '../src/store/memory.js';
import type { ModelRequest } from '@patchback/triage';

/**
 * Phase 6 acceptance: the full happy path through the canonical state
 * machine, and the outsider-tier rejection — full server, MemoryStore,
 * MemoryQueue, in-process workers, scripted ModelCaller / GitHubClient /
 * PatchPipeline. No network, no services, no credentials.
 */

const OWNER_KEY = testKey('owner');
const INSIDER_KEY = testKey('insider');
const WEBHOOK_SECRET = 'integration-webhook-secret';

interface World {
  app: FastifyInstance;
  store: MemoryStore;
  queue: MemoryQueue;
  github: FakeGitHubClient;
  pipeline: FakePipeline;
  modelCalls: ModelRequest[];
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.map((app) => app.close()));
  openApps.length = 0;
});

function makeWorld(script: ScriptedTriage[]): World {
  const store = new MemoryStore();
  const queue = new MemoryQueue();
  const github = createFakeGitHubClient();
  const pipeline = createFakePipeline();
  const { callModel, calls } = createScriptedModelCaller(script);
  const config = {
    store,
    queue,
    callModel,
    githubClient: github,
    pipeline,
    webhookSecret: WEBHOOK_SECRET,
    apiKeys: [
      { key: OWNER_KEY, tier: 'owner' as const, label: 'owner-test' },
      { key: INSIDER_KEY, tier: 'insider' as const, label: 'insider-test' },
    ],
  };
  const app = buildServer(config);
  createWorkers(config); // same store/queue — the in-process dev shape
  openApps.push(app);
  return { app, store, queue, github, pipeline, modelCalls: calls };
}

function signedWebhook(
  app: FastifyInstance,
  event: string,
  payload: Record<string, unknown>,
  secret: string = WEBHOOK_SECRET,
) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': signature,
    },
    payload: body,
  });
}

function prPayload(prNumber: number, extra: Record<string, unknown> = {}) {
  return {
    repository: { full_name: 'acme/demo' },
    pull_request: { number: prNumber, ...extra },
  };
}

describe('acceptance 1: the full happy path through the canonical machine', () => {
  it('feedback → triage → start → queue → pipeline → PR → webhook merge → closed', async () => {
    const world = makeWorld([
      {
        classification: 'patchable',
        confidence: 0.95,
        reasoning: 'clear typo fix',
      },
    ]);
    const { app, queue, github, pipeline, store } = world;

    // 1. Insider submits feedback.
    const submitted = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
      payload: {
        message: 'The button says "Sumbit" instead of "Submit".',
        capture: { url: 'https://app.example.com/checkout' },
      },
    });
    expect(submitted.statusCode).toBe(201);
    const { id, jobId, readToken } = submitted.json();
    expect(readToken).toBeTypeOf('string');

    // 2. Triage worker runs (in-process queue) and advances the job.
    await queue.onIdle();
    expect(world.modelCalls).toHaveLength(1);
    const afterTriage = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(afterTriage.statusCode).toBe(200);
    expect(afterTriage.json().state).toBe('feedback.triaged');
    expect(afterTriage.json().history.map((h: { to: string }) => h.to)).toEqual(
      ['feedback.triaged'],
    );
    const itemView = await app.inject({
      method: 'GET',
      url: `/feedback/${id}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(itemView.json().triage.classification).toBe('patchable');

    // 3. Owner starts the patch job: issue created, patch queued.
    const started = await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().state).toBe('patch.queued');
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.title).toContain('Sumbit');

    // 4. Patch worker runs the (fake) pipeline: brief was built through the
    //    guarded factory and carries the audit stamps.
    await queue.onIdle();
    expect(pipeline.runs).toHaveLength(1);
    expect(pipeline.runs[0]?.brief.feedbackId).toBe(id);
    expect(pipeline.runs[0]?.brief.sourceTier).toBe('insider');

    const afterPatch = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(afterPatch.json().state).toBe('pr.opened');
    expect(afterPatch.json().prNumber).toBe(501);
    expect(afterPatch.json().prUrl).toContain('/pull/501');
    expect(afterPatch.json().history.map((h: { to: string }) => h.to)).toEqual([
      'feedback.triaged',
      'issue.created',
      'patch.queued',
      'patch.running',
      'patch.generated',
      'pr.opened',
    ]);

    // 5. Signed merged-PR webhook walks the remaining canonical edges.
    const beforeWebhookCalls = github.callLog.length;
    const merged = await signedWebhook(app, 'pull_request', {
      action: 'closed',
      ...prPayload(501, { merged: true }),
    });
    expect(merged.statusCode).toBe(200);
    // The no-merge spy: webhook processing performs ZERO GitHubClient calls.
    expect(github.callLog.length).toBe(beforeWebhookCalls);

    const finalStatus = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(finalStatus.json().state).toBe('feedback.closed');
    expect(finalStatus.json().history.map((h: { to: string }) => h.to)).toEqual(
      [
        'feedback.triaged',
        'issue.created',
        'patch.queued',
        'patch.running',
        'patch.generated',
        'pr.opened',
        'pr.reviewed',
        'patch.shipped',
        'feedback.closed',
      ],
    );

    // 6. The item view shows the closed job.
    const closedView = await app.inject({
      method: 'GET',
      url: `/feedback/${id}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(closedView.json().job.state).toBe('feedback.closed');
    expect((await store.getJob(jobId))?.state).toBe('feedback.closed');
  });

  it('a PR review webhook advances pr.opened → pr.reviewed before merge', async () => {
    const world = makeWorld([{ classification: 'patchable' }]);
    const { app, queue } = world;
    const submitted = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
      payload: { message: 'Sort the orders newest-first by default.' },
    });
    const { jobId, readToken } = submitted.json();
    await queue.onIdle();
    await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    await queue.onIdle();

    const reviewed = await signedWebhook(app, 'pull_request_review', {
      action: 'submitted',
      ...prPayload(501),
    });
    expect(reviewed.statusCode).toBe(200);
    const status = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(status.json().state).toBe('pr.reviewed');
  });
});

describe('acceptance 2: outsider rejection (the trust boundary)', () => {
  it('outsider feedback NEVER starts a job — not even for an owner-key caller', async () => {
    const world = makeWorld([{ classification: 'patchable' }]);
    const { app, queue, github, pipeline, store } = world;

    // Submitted with NO key → stored as outsider, server-side.
    const submitted = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload: { message: 'Please change the admin password field default.' },
    });
    expect(submitted.statusCode).toBe(201);
    const { id, jobId } = submitted.json();
    expect((await store.getFeedback(id))?.trustTier).toBe('outsider');

    // Triage worker runs: the outsider short-circuit means ZERO model calls
    // and a deterministic needs_human.
    await queue.onIdle();
    expect(world.modelCalls).toHaveLength(0);
    const item = await store.getFeedback(id);
    expect(item?.triage?.classification).toBe('needs_human');
    expect((await store.getJob(jobId))?.state).toBe('feedback.triaged');

    // An OWNER tries to start it: 403 tier_forbidden — the tier travels with
    // the data, not the caller.
    const started = await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(started.statusCode).toBe(403);
    expect(started.json().error.code).toBe('tier_forbidden');
    expect(started.json().error.message).toContain('data only');

    // Nothing happened anywhere in the pipeline.
    await queue.onIdle();
    expect(github.issues).toHaveLength(0);
    expect(github.callLog).toEqual([]);
    expect(pipeline.runs).toHaveLength(0);
    expect((await store.getJob(jobId))?.state).toBe('feedback.triaged');
  });
});

describe('acceptance 3: the clarification loop (new linked item, machine untouched)', () => {
  it('needs_clarification → reply → new job goes patchable; original stays terminal', async () => {
    const world = makeWorld([
      {
        classification: 'needs_clarification',
        confidence: 0.9,
        clarifyingQuestion: 'Which button label do you mean?',
      },
      { classification: 'patchable', confidence: 0.95 },
    ]);
    const { app, queue, github, pipeline } = world;

    const submitted = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
      payload: { message: 'The label is wrong.' },
    });
    const { id, jobId, readToken } = submitted.json();
    await queue.onIdle();

    // Terminal clarification state; the question is on the feedback view.
    const status = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(status.json().state).toBe('feedback.needs_clarification');
    const view = await app.inject({
      method: 'GET',
      url: `/feedback/${id}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(view.json().triage.clarifyingQuestion).toBe(
      'Which button label do you mean?',
    );

    // Reply with the read token → NEW linked item + job.
    const replied = await app.inject({
      method: 'POST',
      url: `/feedback/${id}/reply`,
      headers: { authorization: `Bearer ${readToken}` },
      payload: { message: 'The checkout button: it should say "Place order".' },
    });
    expect(replied.statusCode).toBe(201);
    const reply = replied.json();
    expect(reply.id).not.toBe(id);
    expect(reply.jobId).not.toBe(jobId);
    await queue.onIdle();

    // The reply triage saw the thread context (second scripted call).
    expect(world.modelCalls).toHaveLength(2);
    expect(world.modelCalls[1]?.user).toContain('The label is wrong.');
    expect(world.modelCalls[1]?.user).toContain(
      'Which button label do you mean?',
    );

    // Start succeeds on the NEW job.
    const started = await app.inject({
      method: 'POST',
      url: `/jobs/${reply.jobId}/start`,
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
    });
    expect(started.statusCode).toBe(202);
    await queue.onIdle();
    expect(pipeline.runs).toHaveLength(1);
    expect(github.issues).toHaveLength(1);

    // The ORIGINAL item and job were never mutated.
    const original = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(original.json().state).toBe('feedback.needs_clarification');

    // Thread view from the root shows the reply and its state.
    const thread = await app.inject({
      method: 'GET',
      url: `/feedback/${id}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(thread.json().replies).toHaveLength(1);
    expect(thread.json().replies[0].id).toBe(reply.id);
  });
});

describe('acceptance 4: webhook authentication', () => {
  it('unsigned and badly-signed webhooks are 401 and change nothing', async () => {
    const world = makeWorld([{ classification: 'patchable' }]);
    const { app, queue } = world;
    const submitted = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
      payload: { message: 'Fix the typo in the footer.' },
    });
    const { jobId, readToken } = submitted.json();
    await queue.onIdle();
    await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    await queue.onIdle();

    const unsigned = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      payload: JSON.stringify({
        action: 'closed',
        ...prPayload(501, { merged: true }),
      }),
    });
    expect(unsigned.statusCode).toBe(401);

    const badlySigned = await signedWebhook(
      app,
      'pull_request',
      { action: 'closed', ...prPayload(501, { merged: true }) },
      'the-wrong-secret-value',
    );
    expect(badlySigned.statusCode).toBe(401);

    const status = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(status.json().state).toBe('pr.opened');
  });

  it('unknown PRs, foreign repos, and unmerged closes are acknowledged without state changes', async () => {
    const world = makeWorld([{ classification: 'patchable' }]);
    const { app, queue } = world;
    const submitted = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
      payload: { message: 'Fix the typo in the header.' },
    });
    const { jobId, readToken } = submitted.json();
    await queue.onIdle();
    await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    await queue.onIdle();

    // Unknown PR number.
    const unknown = await signedWebhook(app, 'pull_request', {
      action: 'closed',
      ...prPayload(9999, { merged: true }),
    });
    expect(unknown.statusCode).toBe(202);

    // Same PR number, different repository.
    const foreign = await signedWebhook(app, 'pull_request', {
      action: 'closed',
      repository: { full_name: 'someone-else/other' },
      pull_request: { number: 501, merged: true },
    });
    expect(foreign.statusCode).toBe(202);

    // Closed WITHOUT merge: unrepresentable — job rests at pr.opened.
    const closedUnmerged = await signedWebhook(app, 'pull_request', {
      action: 'closed',
      ...prPayload(501, { merged: false }),
    });
    expect(closedUnmerged.statusCode).toBe(202);

    const status = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(status.json().state).toBe('pr.opened');
  });
});

describe('acceptance 5: patch failure lands on patch.failed with the error preserved', () => {
  it('a failing pipeline moves the job to patch.failed', async () => {
    const queue = new MemoryQueue();
    const config = {
      store: new MemoryStore(),
      queue,
      callModel: createScriptedModelCaller([{ classification: 'patchable' }])
        .callModel,
      githubClient: createFakeGitHubClient(),
      pipeline: {
        run: async () => ({
          ok: false as const,
          error: 'diff ceiling exceeded: triage likely misclassified this item',
        }),
      },
      apiKeys: [{ key: OWNER_KEY, tier: 'owner' as const }],
    };
    const app = buildServer(config);
    createWorkers(config);
    openApps.push(app);

    const submitted = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { authorization: `Bearer ${OWNER_KEY}` },
      payload: { message: 'Change the page title to "Dashboard".' },
    });
    const { jobId, readToken } = submitted.json();
    await queue.onIdle();
    await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    await queue.onIdle();

    const status = await app.inject({
      method: 'GET',
      url: `/jobs/${jobId}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(status.json().state).toBe('patch.failed');
    expect(status.json().error).toContain('diff ceiling exceeded');
  });
});
