import { describe, expect, it } from 'vitest';

import { createThreadStore, threadStorageKey } from './storage.js';

const ENTRY = {
  feedbackId: 'fb-1',
  jobId: 'job-1',
  readToken: 'token-1',
  createdAt: '2026-07-15T12:00:00.000Z',
};

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe('thread store (read-token custody)', () => {
  it('defaults to MEMORY ONLY — nothing touches storage', () => {
    const storage = fakeStorage();
    const store = createThreadStore({
      persist: false,
      apiUrl: 'http://localhost:8787',
      storage,
    });
    store.append('fb-1', ENTRY);
    expect(store.get('fb-1')?.entries).toEqual([ENTRY]);
    expect(storage.dump()).toEqual({});
  });

  it('persists per apiUrl when opted in and reloads records', () => {
    const storage = fakeStorage();
    const apiUrl = 'http://localhost:8787';
    const store = createThreadStore({ persist: true, apiUrl, storage });
    store.append('fb-1', ENTRY);
    store.append('fb-1', { ...ENTRY, feedbackId: 'fb-2', jobId: 'job-2' });

    const key = threadStorageKey(apiUrl);
    expect(storage.dump()[key]).toBeDefined();

    const reloaded = createThreadStore({ persist: true, apiUrl, storage });
    expect(reloaded.get('fb-1')?.entries).toHaveLength(2);
    // Different apiUrl → different key, no records.
    const other = createThreadStore({
      persist: true,
      apiUrl: 'http://other:9999',
      storage,
    });
    expect(other.list()).toEqual([]);
  });

  it('survives corrupted storage payloads', () => {
    const apiUrl = 'http://localhost:8787';
    const storage = fakeStorage({
      [threadStorageKey(apiUrl)]: '{not json[',
    });
    const store = createThreadStore({ persist: true, apiUrl, storage });
    expect(store.list()).toEqual([]);
  });

  it('returns copies — callers cannot mutate stored records', () => {
    const store = createThreadStore({
      persist: false,
      apiUrl: 'x',
    });
    store.append('fb-1', ENTRY);
    const record = store.get('fb-1');
    record?.entries.push({ ...ENTRY, feedbackId: 'evil' });
    expect(store.get('fb-1')?.entries).toHaveLength(1);
  });
});
