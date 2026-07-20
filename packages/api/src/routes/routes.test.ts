import { createHmac } from 'node:crypto';

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

  it('accepts a shape-valid element.sourceHint and stores it round-trip', async () => {
    const { app, store } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload: {
        message: 'The toolbar button label has a typo',
        capture: {
          element: {
            domPath: '#export-btn',
            tagName: 'button',
            sourceHint: 'src/components/Toolbar.tsx:42',
          },
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const id = response.json().id as string;
    const stored = await store.getFeedback(id);
    expect(stored?.capture?.element?.sourceHint).toBe(
      'src/components/Toolbar.tsx:42',
    );
  });

  it('rejects malformed element.sourceHint values at the schema (first line)', async () => {
    const { app } = makeApp();
    for (const sourceHint of [
      'no-line-suffix.tsx',
      'has spaces.tsx:1',
      'newline\nsmuggle.tsx:1',
      `${'a'.repeat(600)}.tsx:1`,
      'back\\slash.tsx:1',
      'unicode-Аpp.tsx:1',
      'line-too-long.tsx:12345678',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/feedback',
        payload: {
          message: 'hi',
          capture: { element: { domPath: '#x', sourceHint } },
        },
      });
      expect(response.statusCode, sourceHint).toBe(400);
    }
  });

  it('drops a shape-valid but semantically-invalid sourceHint at ingest', async () => {
    const { app, store } = makeApp();
    // Passes the loose ajv charset+line pattern, but parseSourceHint rejects it
    // (traversal + dot-prefixed segment). It must never persist or reach triage.
    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload: {
        message: 'The toolbar button label has a typo',
        capture: {
          element: { domPath: '#export-btn', sourceHint: '../../.env:1' },
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const stored = await store.getFeedback(response.json().id as string);
    // Element is kept; the poisoned hint is stripped.
    expect(stored?.capture?.element?.domPath).toBe('#export-btn');
    expect(stored?.capture?.element?.sourceHint).toBeUndefined();
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

  it('GET /jobs/:id/status omits userSummary/previewUrl when absent (byte-identical)', async () => {
    const { app, store } = makeApp();
    const { job, readToken } = await seed(store, { tier: 'insider' });
    const res = await app.inject({
      method: 'GET',
      url: `/jobs/${job.id}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect('userSummary' in body).toBe(false);
    expect('previewUrl' in body).toBe(false);
  });

  it('GET /jobs/:id/status exposes userSummary + previewUrl to the read-token holder', async () => {
    const { app, store } = makeApp();
    const { job, readToken } = await seed(store, { tier: 'insider' });
    const withOutcome = {
      ...job,
      userSummary: 'The button now reads Submit instead of Sumbit.',
      previewUrl: 'https://preview.example.com/pr/7',
    };
    expect(await store.updateJob(withOutcome, 'feedback.triaged')).toBe(true);

    const allowed = await app.inject({
      method: 'GET',
      url: `/jobs/${job.id}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().userSummary).toBe(
      'The button now reads Submit instead of Sumbit.',
    );
    expect(allowed.json().previewUrl).toBe('https://preview.example.com/pr/7');

    // A non-holder is still denied (404), same boundary as today.
    const denied = await app.inject({
      method: 'GET',
      url: `/jobs/${job.id}/status`,
      headers: { authorization: `Bearer ${generateReadToken()}` },
    });
    expect(denied.statusCode).toBe(404);
  });

  it('GET /jobs/:id/status drops a previewUrl that is not a safe http(s) URL', async () => {
    const { app, store } = makeApp();
    const { job, readToken } = await seed(store, { tier: 'insider' });
    // A corrupt/hostile stored value must never reach the client as an href.
    const poisoned = { ...job, previewUrl: 'javascript:alert(1)' };
    expect(await store.updateJob(poisoned, 'feedback.triaged')).toBe(true);
    const res = await app.inject({
      method: 'GET',
      url: `/jobs/${job.id}/status`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect('previewUrl' in res.json()).toBe(false);
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

describe('deployment_status webhook → previewUrl (payload-only, no GitHub call)', () => {
  const WEBHOOK_SECRET = 'test-webhook-secret';

  function signed(body: unknown): {
    payload: string;
    signature: string;
  } {
    const payload = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET)
      .update(payload)
      .digest('hex')}`;
    return { payload, signature };
  }

  async function seedPrOpenedJob(store: MemoryStore, branchName: string) {
    const at = new Date().toISOString();
    const item: FeedbackItem = {
      id: generateId(),
      message: 'x',
      trustTier: 'insider',
      createdAt: at,
      updatedAt: at,
    };
    await store.createFeedback(item, hashReadToken(generateReadToken()));
    let job: Job = {
      id: generateId(),
      feedbackId: item.id,
      state: INITIAL_JOB_STATE,
      history: [],
      branchName,
      createdAt: at,
      updatedAt: at,
    };
    await store.createJob(job);
    for (const state of [
      'feedback.triaged',
      'issue.created',
      'patch.queued',
      'patch.running',
      'patch.generated',
      'pr.opened',
    ] as const) {
      const next = transitionJob(job, state);
      await store.updateJob(next, job.state);
      job = next;
    }
    return job;
  }

  function deploymentEvent(overrides: {
    ref: string;
    state?: string;
    environment?: string;
    environmentUrl?: string;
  }) {
    return {
      repository: { full_name: 'acme/demo' },
      deployment: {
        ref: overrides.ref,
        environment: overrides.environment ?? 'preview',
      },
      deployment_status: {
        state: overrides.state ?? 'success',
        environment_url:
          overrides.environmentUrl ?? 'https://preview.example.com/pr/1',
      },
    };
  }

  async function post(app: TestApp['app'], event: unknown) {
    const { payload, signature } = signed(event);
    return app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'deployment_status',
        'x-hub-signature-256': signature,
      },
      payload,
    });
  }

  it('sets previewUrl from the payload, correlating by branch, with ZERO GitHub calls', async () => {
    const { app, store, github } = makeApp({ webhookSecret: WEBHOOK_SECRET });
    const branch = 'patchback/job-deploy-1';
    const job = await seedPrOpenedJob(store, branch);

    const res = await post(
      app,
      deploymentEvent({
        ref: branch,
        environmentUrl: 'https://preview.example.com/pr/1',
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().handled).toBe(true);

    const updated = await store.getJob(job.id);
    expect(updated?.previewUrl).toBe('https://preview.example.com/pr/1');
    // The no-client boundary: the webhook never touches the GitHub client.
    expect(github.callLog).toEqual([]);
  });

  it('rejects a non-http(s) environment_url', async () => {
    const { app, store } = makeApp({ webhookSecret: WEBHOOK_SECRET });
    const branch = 'patchback/job-deploy-2';
    const job = await seedPrOpenedJob(store, branch);
    const res = await post(
      app,
      deploymentEvent({ ref: branch, environmentUrl: 'javascript:alert(1)' }),
    );
    expect(res.statusCode).toBe(202);
    expect((await store.getJob(job.id))?.previewUrl).toBeUndefined();
  });

  it('ignores a production deployment', async () => {
    const { app, store } = makeApp({ webhookSecret: WEBHOOK_SECRET });
    const branch = 'patchback/job-deploy-3';
    const job = await seedPrOpenedJob(store, branch);
    const res = await post(
      app,
      deploymentEvent({ ref: branch, environment: 'production' }),
    );
    expect(res.statusCode).toBe(202);
    expect((await store.getJob(job.id))?.previewUrl).toBeUndefined();
  });

  it('ignores a failed deployment', async () => {
    const { app, store } = makeApp({ webhookSecret: WEBHOOK_SECRET });
    const branch = 'patchback/job-deploy-4';
    const job = await seedPrOpenedJob(store, branch);
    const res = await post(
      app,
      deploymentEvent({ ref: branch, state: 'failure' }),
    );
    expect(res.statusCode).toBe(202);
    expect((await store.getJob(job.id))?.previewUrl).toBeUndefined();
  });

  it('ignores an event whose branch matches no job', async () => {
    const { app } = makeApp({ webhookSecret: WEBHOOK_SECRET });
    const res = await post(app, deploymentEvent({ ref: 'patchback/job-none' }));
    expect(res.statusCode).toBe(202);
  });
});
