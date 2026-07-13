import { describe, expect, it } from 'vitest';

import { StoreIntegrityError } from '../errors.js';
import { generateReadToken, hashReadToken } from '../ids.js';
import { MemoryStore } from './memory.js';
import { makeItem, makeJob, runStoreConformance } from './store.conformance.js';

runStoreConformance('MemoryStore', async () => new MemoryStore());

describe('MemoryStore integrity (fail closed on corrupted values)', () => {
  it('refuses to store or return an invalid trust tier', async () => {
    const store = new MemoryStore();
    const corrupted = makeItem({
      trustTier: 'superadmin' as never,
    });
    await expect(
      store.createFeedback(corrupted, hashReadToken(generateReadToken())),
    ).rejects.toThrow(StoreIntegrityError);
  });

  it('refuses to store a job with an invalid state', async () => {
    const store = new MemoryStore();
    const item = makeItem();
    await store.createFeedback(item, hashReadToken(generateReadToken()));
    const corrupted = makeJob(item.id, { state: 'patch.autoship' as never });
    await expect(store.createJob(corrupted)).rejects.toThrow(
      StoreIntegrityError,
    );
  });

  it('rejects duplicate ids', async () => {
    const store = new MemoryStore();
    const item = makeItem();
    await store.createFeedback(item, hashReadToken(generateReadToken()));
    await expect(
      store.createFeedback(item, hashReadToken(generateReadToken())),
    ).rejects.toThrow(/already exists/);
    const job = makeJob(item.id);
    await store.createJob(job);
    await expect(store.createJob(job)).rejects.toThrow(/already exists/);
  });
});
