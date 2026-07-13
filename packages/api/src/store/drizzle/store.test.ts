import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { StoreIntegrityError } from '../../errors.js';
import { runStoreConformance } from '../store.conformance.js';
import { createDrizzleStore, mapFeedbackRow, mapJobRow } from './store.js';

/**
 * Row-mapping corruption tests run everywhere (pure functions, no DB).
 * The live conformance suite is env-gated behind PATCHBACK_TEST_DATABASE_URL
 * and skips cleanly without it (repo precedent: github integration tests).
 */

const baseFeedbackRow = {
  id: 'fb-1',
  message: 'msg',
  trustTier: 'insider',
  submitter: null,
  capture: null,
  triage: null,
  threadId: null,
  inReplyTo: null,
  readTokenHash: 'hash',
  createdAt: new Date('2026-07-10T00:00:00.000Z'),
  updatedAt: new Date('2026-07-10T00:00:00.000Z'),
};

const baseJobRow = {
  id: 'job-1',
  feedbackId: 'fb-1',
  state: 'feedback.received',
  history: [],
  issueNumber: null,
  branchName: null,
  prNumber: null,
  prUrl: null,
  error: null,
  createdAt: new Date('2026-07-10T00:00:00.000Z'),
  updatedAt: new Date('2026-07-10T00:00:00.000Z'),
};

describe('drizzle row mapping (fail closed on corruption)', () => {
  it('maps a valid feedback row', () => {
    const item = mapFeedbackRow({
      ...baseFeedbackRow,
      triage: { classification: 'patchable', confidence: 0.9 },
      threadId: 'root-1',
      inReplyTo: 'root-1',
    });
    expect(item.trustTier).toBe('insider');
    expect(item.triage?.classification).toBe('patchable');
    expect(item.threadId).toBe('root-1');
    expect(item.submitter).toBeUndefined();
  });

  it('throws StoreIntegrityError on a corrupted trust tier', () => {
    expect(() =>
      mapFeedbackRow({ ...baseFeedbackRow, trustTier: 'superadmin' }),
    ).toThrow(StoreIntegrityError);
    expect(() =>
      mapFeedbackRow({ ...baseFeedbackRow, trustTier: '' }),
    ).toThrow(StoreIntegrityError);
  });

  it('throws StoreIntegrityError on a corrupted triage payload', () => {
    for (const triage of [
      { classification: 'auto_approve', confidence: 1 },
      { classification: 'patchable' }, // missing confidence
      'patchable',
      [],
    ]) {
      expect(() => mapFeedbackRow({ ...baseFeedbackRow, triage })).toThrow(
        StoreIntegrityError,
      );
    }
  });

  it('maps a valid job row', () => {
    const job = mapJobRow({
      ...baseJobRow,
      state: 'pr.opened',
      history: [
        {
          from: 'feedback.received',
          to: 'feedback.triaged',
          at: '2026-07-10T00:00:01.000Z',
        },
      ],
      prNumber: 42,
      prUrl: 'https://github.com/acme/demo/pull/42',
    });
    expect(job.state).toBe('pr.opened');
    expect(job.prNumber).toBe(42);
    expect(job.error).toBeUndefined();
  });

  it('throws StoreIntegrityError on a corrupted job state — never coerces toward runnable', () => {
    expect(() => mapJobRow({ ...baseJobRow, state: 'patch.autoship' })).toThrow(
      StoreIntegrityError,
    );
    expect(() =>
      mapJobRow({ ...baseJobRow, history: 'not-an-array' }),
    ).toThrow(StoreIntegrityError);
    expect(() =>
      mapJobRow({
        ...baseJobRow,
        history: [{ from: 'feedback.received', to: 'merged!', at: 'x' }],
      }),
    ).toThrow(StoreIntegrityError);
  });
});

const databaseUrl = process.env.PATCHBACK_TEST_DATABASE_URL;

describe.skipIf(databaseUrl === undefined)(
  'DrizzleStore against a live Postgres (PATCHBACK_TEST_DATABASE_URL)',
  () => {
    it('applies committed migrations and passes the conformance suite', async () => {
      // Covered by the parameterized suite registered below.
      expect(databaseUrl).toBeDefined();
    });
  },
);

if (databaseUrl !== undefined) {
  // Reset the scratch database and apply the COMMITTED migrations exactly
  // once per run — the suite exercises the same SQL that ships.
  let migrated: Promise<void> | undefined;
  const migrateOnce = (): Promise<void> => {
    migrated ??= (async () => {
      const migrationsDir = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../migrations',
      );
      const files = (await readdir(migrationsDir))
        .filter((file) => file.endsWith('.sql'))
        .sort();
      const { drizzle } = await import('drizzle-orm/node-postgres');
      const pgModule = await import('pg');
      const pool = new pgModule.default.Pool({ connectionString: databaseUrl });
      const db = drizzle(pool);
      try {
        await db.execute(sql.raw('drop table if exists "jobs" cascade'));
        await db.execute(sql.raw('drop table if exists "feedback" cascade'));
        for (const file of files) {
          const content = await readFile(path.join(migrationsDir, file), 'utf8');
          for (const statement of content.split('--> statement-breakpoint')) {
            await db.execute(sql.raw(statement));
          }
        }
      } finally {
        await pool.end();
      }
    })();
    return migrated;
  };

  runStoreConformance('DrizzleStore', async () => {
    await migrateOnce();
    return createDrizzleStore(databaseUrl).store;
  });
}
