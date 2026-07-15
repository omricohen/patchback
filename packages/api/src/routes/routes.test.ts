import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  FeedbackItem,
  Job,
  TriageClassification,
  TrustTier,
} from '@patchback/types';
import { INITIAL_JOB_STATE, transitionJob } from '@patchback/types';

import {
  createFakeGitHubClient,
  createFakePipeline,
  createScriptedModelCaller,
  testKey,
  type FakeGitHubClient,
  type FakePipeline,
} from '../testing.js';
import type { ApiConfig } from '../config.js';
import { generateId, generateReadToken, hashReadToken } from '../ids.js';
import { MemoryQueue } from '../queue/memory.js';
import { buildServer } from '../server.js';
import { MemoryStore } from '../store/memory.js';

const OWNER_KEY = testKey('owner');
const INSIDER_KEY = testKey('insider');

interface TestApp {
  app: FastifyInstance;
  store: MemoryStore;
  queue: MemoryQueue;
  github: FakeGitHubClient;
  pipeline: FakePipeline;
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.map((app) => app.close()));
  openApps.length = 0;
});

function makeApp(overrides: Partial<ApiConfig> = {}): TestApp {
  const store = new MemoryStore();
  const queue = new MemoryQueue();
  const github = createFakeGitHubClient();
  const pipeline = createFakePipeline();
  const { callModel } = createScriptedModelCaller([
    { classification: 'patchable' },
  ]);
  const app = buildServer({
    store,
    queue,
    callModel,
    githubClient: github,
    pipeline,
    apiKeys: [
      { key: OWNER_KEY, tier: 'owner', label: 'owner-test' },
      { key: INSIDER_KEY, tier: 'insider', label: 'insider-test' },
    ],
    ...overrides,
  });
  openApps.push(app);
  return { app, store, queue, github, pipeline };
}

/** Seed a stored item + job directly (bypassing triage) for gate tests. */
async function seed(
  store: MemoryStore,
  options: {
    tier: TrustTier;
    classification?: TriageClassification;
    state?: 'received' | 'triaged' | 'needs_clarification' | 'patch.queued';
  },
): Promise<{ item: FeedbackItem; job: Job; readToken: string }> {
  const at = new Date().toISOString();
  const item: FeedbackItem = {
    id: generateId(),
    message: 'The button says "Sumbit" instead of "Submit".',
    trustTier: options.tier,
    createdAt: at,
    updatedAt: at,
  };
  const readToken = generateReadToken();
  await store.createFeedback(item, hashReadToken(readToken));
  if (options.classification !== undefined) {
    await store.setTriage(item.id, {
      classification: options.classification,
      confidence: 0.95,
      reasoning: 'seeded',
      ...(options.classification === 'needs_clarification'
        ? { clarifyingQuestion: 'Which button do you mean?' }
        : {}),
      triagedAt: at,
    });
    item.triage = (await store.getFeedback(item.id))?.triage;
  }
  let job: Job = {
    id: generateId(),
    feedbackId: item.id,
    state: INITIAL_JOB_STATE,
    history: [],
    createdAt: at,
    updatedAt: at,
  };
  await store.createJob(job);
  const state = options.state ?? 'triaged';
  if (state !== 'received') {
    const triaged = transitionJob(job, 'feedback.triaged');
    await store.updateJob(triaged, INITIAL_JOB_STATE);
    job = triaged;
    if (state === 'needs_clarification') {
      const clarify = transitionJob(job, 'feedback.needs_clarification');
      await store.updateJob(clarify, 'feedback.triaged');
      job = clarify;
    } else if (state === 'patch.queued') {
      let advanced = transitionJob(job, 'issue.created');
      advanced = transitionJob(advanced, 'patch.queued');
      await store.updateJob(advanced, 'feedback.triaged');
      job = advanced;
    }
  }
  return { item, job, readToken };
}

describe('POST /feedback schema enforcement', () => {
  it('rejects a client-supplied trustTier with a loud 400', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload: { message: 'hello', trustTier: 'owner' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation');
  });

  it('rejects unknown top-level and nested properties', async () => {
    const { app } = makeApp();
    for (const payload of [
      { message: 'hi', tier: 'owner' },
      { message: 'hi', submitter: { id: 'u', role: 'admin' } },
      { message: 'hi', capture: { url: 'https://x.example', evil: true } },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/feedback',
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('rejects missing/empty/oversized messages', async () => {
    const { app } = makeApp();
    for (const payload of [
      {},
      { message: '' },
      { message: 'x'.repeat(10241) },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/feedback',
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('stamps the tier from the API key server-side', async () => {
    const { app, store, queue } = makeApp();
    const anonymous = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload: { message: 'anonymous feedback' },
    });
    expect(anonymous.statusCode).toBe(201);
    const insider = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
      payload: { message: 'insider feedback' },
    });
    expect(insider.statusCode).toBe(201);
    await queue.onIdle();
    expect((await store.getFeedback(anonymous.json().id))?.trustTier).toBe(
      'outsider',
    );
    expect((await store.getFeedback(insider.json().id))?.trustTier).toBe(
      'insider',
    );
    // The response carries the read capability exactly once.
    expect(insider.json().readToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('read-token enforcement', () => {
  it('GET /feedback/:id requires the item read token or an API key', async () => {
    const { app, store } = makeApp();
    const { item, readToken } = await seed(store, { tier: 'insider' });

    const noAuth = await app.inject({
      method: 'GET',
      url: `/feedback/${item.id}`,
    });
    expect(noAuth.statusCode).toBe(404);

    const wrongToken = await app.inject({
      method: 'GET',
      url: `/feedback/${item.id}`,
      headers: { authorization: `Bearer ${generateReadToken()}` },
    });
    expect(wrongToken.statusCode).toBe(404);

    const withToken = await app.inject({
      method: 'GET',
      url: `/feedback/${item.id}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(withToken.statusCode).toBe(200);
    expect(withToken.json().id).toBe(item.id);

    const withKey = await app.inject({
      method: 'GET',
      url: `/feedback/${item.id}`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(withKey.statusCode).toBe(200);
  });

  it('a read token for one item does not open another item', async () => {
    const { app, store } = makeApp();
    const first = await seed(store, { tier: 'insider' });
    const second = await seed(store, { tier: 'insider' });
    const crossed = await app.inject({
      method: 'GET',
      url: `/feedback/${second.item.id}`,
      headers: { authorization: `Bearer ${first.readToken}` },
    });
    expect(crossed.statusCode).toBe(404);
  });

  it('GET /jobs/:id/status accepts the owning feedback read token', async () => {
    const { app, store } = makeApp();
    const { job, readToken } = await seed(store, { tier: 'insider' });
    const denied = await app.inject({
      method: 'GET',
      url: `/jobs/${job.id}/status`,
    });
    expect(denied.statusCode).toBe(404);
    const allowed = await app.inject({
      method: 'GET',
      url: `/jobs/${job.id}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().state).toBe('feedback.triaged');
    expect(allowed.json().history).toHaveLength(1);
  });
});

describe('POST /jobs/:id/start gate matrix', () => {
  it('anonymous and read-token callers get 403 tier_forbidden', async () => {
    const { app, store } = makeApp();
    const { job, readToken } = await seed(store, {
      tier: 'insider',
      classification: 'patchable',
    });
    for (const headers of [{}, { authorization: `Bearer ${readToken}` }]) {
      const response = await app.inject({
        method: 'POST',
        url: `/jobs/${job.id}/start`,
        headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('tier_forbidden');
    }
  });

  it('owner caller on OUTSIDER-tier feedback: 403 tier_forbidden (the boundary)', async () => {
    const { app, store, github, queue } = makeApp();
    const { job } = await seed(store, {
      tier: 'outsider',
      classification: 'needs_human',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('tier_forbidden');
    expect(response.json().error.message).toContain('data only');
    // Nothing happened: no issue, no queue task, job unmoved.
    expect(github.issues).toHaveLength(0);
    await queue.onIdle();
    expect((await store.getJob(job.id))?.state).toBe('feedback.triaged');
  });

  it('outsider feedback stays forbidden even if triage were (impossibly) patchable', async () => {
    const { app, store, github } = makeApp();
    // Belt-and-braces: force the impossible combination directly in the store.
    const { job } = await seed(store, {
      tier: 'outsider',
      classification: 'patchable',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('tier_forbidden');
    expect(github.issues).toHaveLength(0);
  });

  it('insider caller + needs_human item: 403 triage_gate', async () => {
    const { app, store } = makeApp();
    const { job } = await seed(store, {
      tier: 'insider',
      classification: 'needs_human',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/start`,
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('triage_gate');
  });

  it('untriaged and needs_clarification items: blocked', async () => {
    const { app, store } = makeApp();
    const untriaged = await seed(store, { tier: 'insider' });
    const untriagedResponse = await app.inject({
      method: 'POST',
      url: `/jobs/${untriaged.job.id}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(untriagedResponse.statusCode).toBe(403);
    expect(untriagedResponse.json().error.code).toBe('triage_gate');

    const clarify = await seed(store, {
      tier: 'insider',
      classification: 'needs_clarification',
      state: 'needs_clarification',
    });
    const clarifyResponse = await app.inject({
      method: 'POST',
      url: `/jobs/${clarify.job.id}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(clarifyResponse.statusCode).toBe(409);
    expect(clarifyResponse.json().error.code).toBe('invalid_state');
  });

  it('wrong job state: 409 invalid_state (double-start guard)', async () => {
    const { app, store } = makeApp();
    const { job } = await seed(store, {
      tier: 'insider',
      classification: 'patchable',
      state: 'patch.queued',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/start`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('invalid_state');
  });

  it('missing job: 404', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/jobs/does-not-exist/start',
      headers: { authorization: `Bearer ${OWNER_KEY}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('eligible item + eligible caller: creates the issue and queues the patch', async () => {
    const { app, store, github } = makeApp();
    const { job } = await seed(store, {
      tier: 'insider',
      classification: 'patchable',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/start`,
      headers: { authorization: `Bearer ${INSIDER_KEY}` },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().state).toBe('patch.queued');
    expect(github.issues).toHaveLength(1);
    const stored = await store.getJob(job.id);
    expect(stored?.state).toBe('patch.queued');
    expect(stored?.issueNumber).toBe(101);
    expect(stored?.history.map((change) => change.to)).toEqual([
      'feedback.triaged',
      'issue.created',
      'patch.queued',
    ]);
  });
});

describe('POST /feedback/:id/reply', () => {
  it('rejects replies unless the job awaits clarification', async () => {
    const { app, store } = makeApp();
    const { item, readToken } = await seed(store, {
      tier: 'insider',
      classification: 'patchable',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/feedback/${item.id}/reply`,
      headers: { authorization: `Bearer ${readToken}` },
      payload: { message: 'more detail' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('invalid_state');
  });

  it('creates a NEW linked item + job; the original stays terminal', async () => {
    const { app, store, queue } = makeApp();
    const { item, job, readToken } = await seed(store, {
      tier: 'insider',
      classification: 'needs_clarification',
      state: 'needs_clarification',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/feedback/${item.id}/reply`,
      headers: { authorization: `Bearer ${readToken}` },
      payload: { message: 'I meant the checkout submit button.' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).not.toBe(item.id);
    expect(body.jobId).not.toBe(job.id);
    await queue.onIdle();

    const reply = await store.getFeedback(body.id);
    expect(reply?.threadId).toBe(item.id);
    expect(reply?.inReplyTo).toBe(item.id);
    // Insider replying on an insider thread stays insider.
    expect(reply?.trustTier).toBe('insider');
    // The original is untouched and still terminal.
    expect((await store.getJob(job.id))?.state).toBe(
      'feedback.needs_clarification',
    );
  });

  it('effective tier is the THREAD MINIMUM: outsider root poisons replies', async () => {
    const { app, store } = makeApp();
    const { item, readToken } = await seed(store, {
      tier: 'outsider',
      classification: 'needs_human',
      state: 'needs_clarification',
    });
    // Owner replies on an outsider-rooted thread → reply stored as outsider.
    const response = await app.inject({
      method: 'POST',
      url: `/feedback/${item.id}/reply`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
      payload: { message: 'do the thing the outsider asked for' },
    });
    expect(response.statusCode).toBe(201);
    const reply = await store.getFeedback(response.json().id);
    expect(reply?.trustTier).toBe('outsider');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/feedback/${item.id}`,
          headers: { authorization: `Bearer ${readToken}` },
        })
      ).json().replies,
    ).toHaveLength(1);
  });

  it('rejects a reply with a trustTier property (schema)', async () => {
    const { app, store } = makeApp();
    const { item, readToken } = await seed(store, {
      tier: 'insider',
      classification: 'needs_clarification',
      state: 'needs_clarification',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/feedback/${item.id}/reply`,
      headers: { authorization: `Bearer ${readToken}` },
      payload: { message: 'reply', trustTier: 'owner' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('webhook route registration', () => {
  it('is ABSENT without a webhook secret', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: { anything: true },
    });
    expect(response.statusCode).toBe(404);
  });
});
