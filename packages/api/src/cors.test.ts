import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeGitHubClient,
  createFakePipeline,
  createScriptedModelCaller,
  testKey,
} from './testing.js';
import { ConfigError, type ApiConfig } from './config.js';
import { MemoryQueue } from './queue/memory.js';
import { buildServer } from './server.js';
import { MemoryStore } from './store/memory.js';

const APP_ORIGIN = 'http://localhost:3000';
const EVIL_ORIGIN = 'http://evil.example';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.map((app) => app.close()));
  openApps.length = 0;
});

function makeConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  const { callModel } = createScriptedModelCaller([
    { classification: 'patchable' },
  ]);
  return {
    store: new MemoryStore(),
    queue: new MemoryQueue(),
    callModel,
    githubClient: createFakeGitHubClient(),
    pipeline: createFakePipeline(),
    apiKeys: [{ key: testKey('owner'), tier: 'owner' }],
    ...overrides,
  };
}

function makeApp(overrides: Partial<ApiConfig> = {}): FastifyInstance {
  const app = buildServer(makeConfig(overrides));
  openApps.push(app);
  return app;
}

describe('CORS is off by default', () => {
  it('sends no CORS headers when `cors` is not configured', async () => {
    const app = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
      payload: { message: 'The export button label has a typo.' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS with explicit allowed origins', () => {
  it('answers a preflight from a listed origin', async () => {
    const app = makeApp({ cors: { allowedOrigins: [APP_ORIGIN] } });
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/feedback',
      headers: {
        origin: APP_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    // Bearer auth must survive the preflight.
    expect(String(response.headers['access-control-allow-methods'])).toContain(
      'POST',
    );
  });

  it('reflects the listed origin on an actual request', async () => {
    const app = makeApp({ cors: { allowedOrigins: [APP_ORIGIN] } });
    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
      payload: { message: 'The export button label has a typo.' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
  });

  it('never reflects an unlisted origin', async () => {
    const app = makeApp({ cors: { allowedOrigins: [APP_ORIGIN] } });
    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { 'content-type': 'application/json', origin: EVIL_ORIGIN },
      payload: { message: 'The export button label has a typo.' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('CORS config validation (fail closed at startup)', () => {
  it('rejects a wildcard origin', () => {
    expect(() => makeApp({ cors: { allowedOrigins: ['*'] } })).toThrow(
      ConfigError,
    );
    expect(() =>
      makeApp({ cors: { allowedOrigins: ['https://*.example.com'] } }),
    ).toThrow(ConfigError);
  });

  it('rejects an empty origin list', () => {
    expect(() => makeApp({ cors: { allowedOrigins: [] } })).toThrow(
      ConfigError,
    );
  });

  it('rejects values that are not origins', () => {
    expect(() =>
      makeApp({ cors: { allowedOrigins: ['http://localhost:3000/app'] } }),
    ).toThrow(ConfigError);
    expect(() => makeApp({ cors: { allowedOrigins: ['localhost'] } })).toThrow(
      ConfigError,
    );
  });
});
