import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeGitHubClient,
  createFakePipeline,
  createScriptedModelCaller,
  testKey,
} from '../testing.js';
import type { ApiConfig } from '../config.js';
import { MemoryQueue } from '../queue/memory.js';
import { buildServer } from '../server.js';
import { MemoryStore } from '../store/memory.js';

const OWNER_KEY = testKey('owner');
const INSIDER_KEY = testKey('insider');
const SIGNING_SECRET = 'exchange-signing-secret-0123456789';
const NOW = new Date('2026-07-20T12:00:00.000Z');

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.map((app) => app.close()));
  openApps.length = 0;
});

function makeApp(overrides: Partial<ApiConfig> = {}): FastifyInstance {
  const { callModel } = createScriptedModelCaller([
    { classification: 'patchable' },
  ]);
  const app = buildServer({
    store: new MemoryStore(),
    queue: new MemoryQueue(),
    callModel,
    githubClient: createFakeGitHubClient(),
    pipeline: createFakePipeline(),
    apiKeys: [
      { key: OWNER_KEY, tier: 'owner' },
      { key: INSIDER_KEY, tier: 'insider' },
    ],
    tokenExchange: { signingSecret: SIGNING_SECRET },
    now: () => NOW,
    ...overrides,
  });
  openApps.push(app);
  return app;
}

/** A server-to-server exchange call: keyed, no browser indicators. */
function exchange(
  app: FastifyInstance,
  opts: {
    key?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {},
) {
  return app.inject({
    method: 'POST',
    url: '/tokens/exchange',
    headers: {
      'content-type': 'application/json',
      ...(opts.key !== undefined
        ? { authorization: `Bearer ${opts.key}` }
        : {}),
      ...opts.headers,
    },
    payload: opts.body ?? {},
  });
}

describe('POST /tokens/exchange — auth & no-chaining', () => {
  it('mints a token for a valid parent key (201)', async () => {
    const app = makeApp();
    const res = await exchange(app, {
      key: OWNER_KEY,
      body: { tier: 'insider' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      token: string;
      tier: string;
      expiresAt: string;
    };
    expect(body.token.startsWith('pbt_')).toBe(true);
    expect(body.tier).toBe('insider');
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(NOW.getTime());
  });

  it('rejects a keyless call (403)', async () => {
    const app = makeApp();
    const res = await exchange(app, { body: { tier: 'insider' } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'tier_forbidden',
    );
  });

  it('rejects an unknown/outsider bearer (403)', async () => {
    const app = makeApp();
    const res = await exchange(app, { key: 'not-a-real-key', body: {} });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a caller authenticated by a browser token — NO CHAINING (403)', async () => {
    const app = makeApp();
    const minted = (
      await exchange(app, { key: OWNER_KEY, body: { tier: 'owner' } })
    ).json() as { token: string };
    // Try to mint again using the minted token as the credential.
    const res = await exchange(app, { key: minted.token, body: {} });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'tier_forbidden',
    );
  });
});

describe('POST /tokens/exchange — server-only enforcement', () => {
  it('rejects a request carrying an Origin header (403 server_only)', async () => {
    const app = makeApp();
    const res = await exchange(app, {
      key: OWNER_KEY,
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'server_only',
    );
  });

  it('rejects Sec-Fetch-Site / Sec-Fetch-Dest indicators (403 server_only)', async () => {
    const app = makeApp();
    const cases: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-origin' },
      { 'sec-fetch-dest': 'empty' },
    ];
    for (const headers of cases) {
      const res = await exchange(app, { key: OWNER_KEY, headers });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        'server_only',
      );
    }
  });

  it('allows a server caller that sends only Sec-Fetch-Mode (Node fetch sets it)', async () => {
    const app = makeApp();
    const res = await exchange(app, {
      key: OWNER_KEY,
      headers: { 'sec-fetch-mode': 'cors' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('is NEVER CORS-exposed: a preflight gets no Access-Control-Allow-Origin, even with cors configured', async () => {
    const app = makeApp({
      cors: { allowedOrigins: ['http://localhost:3000'] },
    });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/tokens/exchange',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a real POST with an allowed Origin still gets no CORS header AND is 403ed', async () => {
    const app = makeApp({
      cors: { allowedOrigins: ['http://localhost:3000'] },
    });
    const res = await exchange(app, {
      key: OWNER_KEY,
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /tokens/exchange — tier ceiling', () => {
  it('an insider key requesting owner → 403 tier_ceiling', async () => {
    const app = makeApp();
    const res = await exchange(app, {
      key: INSIDER_KEY,
      body: { tier: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'tier_ceiling',
    );
  });

  it('an owner key requesting insider → 201 insider', async () => {
    const app = makeApp();
    const res = await exchange(app, {
      key: OWNER_KEY,
      body: { tier: 'insider' },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { tier: string }).tier).toBe('insider');
  });

  it('omitted tier mints at the parent tier', async () => {
    const app = makeApp();
    const res = await exchange(app, { key: INSIDER_KEY, body: {} });
    expect((res.json() as { tier: string }).tier).toBe('insider');
  });

  it('requesting outsider → 400 (schema enum: outsider is unmintable)', async () => {
    const app = makeApp();
    const res = await exchange(app, {
      key: OWNER_KEY,
      body: { tier: 'outsider' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /tokens/exchange — TTL clamping', () => {
  it('clamps a requested TTL down to maxTtlMs', async () => {
    const app = makeApp({
      tokenExchange: { signingSecret: SIGNING_SECRET, maxTtlMs: 60_000 },
    });
    const res = await exchange(app, {
      key: OWNER_KEY,
      body: { ttlMs: 999_999_999 },
    });
    const body = res.json() as { expiresAt: string };
    expect(Date.parse(body.expiresAt)).toBe(NOW.getTime() + 60_000);
  });
});

function makeClockApp(): {
  app: FastifyInstance;
  setNow: (d: Date) => void;
} {
  let current = NOW;
  const { callModel } = createScriptedModelCaller([
    { classification: 'patchable' },
  ]);
  const app = buildServer({
    store: new MemoryStore(),
    queue: new MemoryQueue(),
    callModel,
    githubClient: createFakeGitHubClient(),
    pipeline: createFakePipeline(),
    apiKeys: [{ key: OWNER_KEY, tier: 'owner' }],
    tokenExchange: { signingSecret: SIGNING_SECRET, defaultTtlMs: 60_000 },
    now: () => current,
  });
  openApps.push(app);
  return { app, setNow: (d) => (current = d) };
}

async function mintToken(app: FastifyInstance, key: string): Promise<string> {
  const res = await exchange(app, { key, body: {} });
  return (res.json() as { token: string }).token;
}

async function submit(
  app: FastifyInstance,
  token: string,
): Promise<{ status: number; id?: string; readToken?: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/feedback',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    payload: { message: 'The export button label has a typo' },
  });
  const body = res.json() as { id?: string; readToken?: string };
  return { status: res.statusCode, ...body };
}

describe('a minted token authenticates submit + read at the minted tier', () => {
  it('POST /feedback + GET /feedback/:id resolve to the minted tier', async () => {
    const app = makeApp();
    const token = await mintToken(app, OWNER_KEY);
    const submitted = await submit(app, token);
    expect(submitted.status).toBe(201);

    // The token (owner tier) can read the item; the stored tier is `owner`.
    const read = await app.inject({
      method: 'GET',
      url: `/feedback/${submitted.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { trustTier: string }).trustTier).toBe('owner');
  });
});

describe('expiry enforced on every request (route-level TTL boundary)', () => {
  it('valid at exp - ε: submission lands at the minted tier', async () => {
    const { app, setNow } = makeClockApp();
    const token = await mintToken(app, OWNER_KEY);
    setNow(new Date(NOW.getTime() + 60_000 - 1)); // just before exp
    const submitted = await submit(app, token);
    const read = await app.inject({
      method: 'GET',
      url: `/feedback/${submitted.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect((read.json() as { trustTier: string }).trustTier).toBe('owner');
  });

  it('expired at exp + ε: submission is demoted to outsider (data only)', async () => {
    const { app, setNow } = makeClockApp();
    const token = await mintToken(app, OWNER_KEY);
    setNow(new Date(NOW.getTime() + 60_000 + 1)); // just after exp
    const submitted = await submit(app, token);
    expect(submitted.status).toBe(201);
    // Read via the returned read token (the expired bearer can no longer read
    // as owner) and confirm the stored tier fell closed to outsider.
    const read = await app.inject({
      method: 'GET',
      url: `/feedback/${submitted.id}`,
      headers: { authorization: `Bearer ${submitted.readToken}` },
    });
    expect((read.json() as { trustTier: string }).trustTier).toBe('outsider');
  });
});

describe('token exchange is opt-in (absent config)', () => {
  it('does not register /tokens/exchange when tokenExchange is absent → 404', async () => {
    const app = makeApp({ tokenExchange: undefined });
    const res = await exchange(app, { key: OWNER_KEY, body: {} });
    expect(res.statusCode).toBe(404);
  });
});
