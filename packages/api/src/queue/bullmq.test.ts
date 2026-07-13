import { describe, expect, it } from 'vitest';

import { BullMQQueue, connectionOptionsFromUrl } from './bullmq.js';

describe('connectionOptionsFromUrl (no Redis needed)', () => {
  it('parses host, port, credentials, and db index', () => {
    expect(
      connectionOptionsFromUrl('redis://user:pass@redis.internal:6380/2'),
    ).toEqual({
      host: 'redis.internal',
      port: 6380,
      username: 'user',
      password: 'pass',
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it('defaults to port 6379 and db 0, adds tls for rediss://', () => {
    expect(connectionOptionsFromUrl('redis://localhost')).toEqual({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    });
    expect(connectionOptionsFromUrl('rediss://secure.example')).toMatchObject({
      tls: {},
    });
  });

  it('rejects non-redis URLs and bad db indexes', () => {
    expect(() => connectionOptionsFromUrl('http://localhost')).toThrow(
      /unsupported Redis URL protocol/,
    );
    expect(() => connectionOptionsFromUrl('redis://localhost/abc')).toThrow(
      /database index/,
    );
  });
});

const redisUrl = process.env.PATCHBACK_TEST_REDIS_URL;

describe.skipIf(redisUrl === undefined)(
  'BullMQQueue against a live Redis (PATCHBACK_TEST_REDIS_URL)',
  () => {
    it('delivers tasks to the handler and retries triage tasks', async () => {
      const queue = new BullMQQueue(redisUrl as string, `patchback-test-${Date.now()}`);
      try {
        const delivered: string[] = [];
        let triageAttempts = 0;
        const done = new Promise<void>((resolve) => {
          queue.process(async (task) => {
            if (task.type === 'triage') {
              triageAttempts += 1;
              if (triageAttempts === 1) {
                throw new Error('transient transport error');
              }
              delivered.push(task.feedbackId);
              resolve();
            }
          });
        });
        await queue.enqueue({ type: 'triage', feedbackId: 'fb-1', jobId: 'j1' });
        await Promise.race([
          done,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timed out')), 15000),
          ),
        ]);
        expect(delivered).toEqual(['fb-1']);
        expect(triageAttempts).toBe(2);
      } finally {
        await queue.close();
      }
    }, 20000);
  },
);
