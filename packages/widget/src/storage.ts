/**
 * Thread/read-token custody.
 *
 * Default: MEMORY ONLY — a reload forgets past threads (read tokens are
 * shown once by the server and gone). Correct-by-default privacy.
 *
 * `persistThreads: true` opts into localStorage, keyed per API URL.
 * Documented tradeoff: a read token grants read access to the item
 * INCLUDING capture context — persistence is for internal apps on trusted
 * machines. Tokens are never logged and never put in URLs; they leave the
 * widget only as Authorization headers.
 */

export interface ThreadEntry {
  feedbackId: string;
  jobId: string;
  readToken: string;
  createdAt: string;
}

export interface ThreadRecord {
  rootId: string;
  /** First entry is the root submission; replies append. */
  entries: ThreadEntry[];
}

export interface ThreadStore {
  list(): ThreadRecord[];
  get(rootId: string): ThreadRecord | undefined;
  append(rootId: string, entry: ThreadEntry): void;
}

export interface ThreadStoreOptions {
  persist: boolean;
  apiUrl: string;
  /** Injectable for tests. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

export function threadStorageKey(apiUrl: string): string {
  return `patchback:v1:threads:${fnv1a(apiUrl)}`;
}

export function createThreadStore(options: ThreadStoreOptions): ThreadStore {
  const memory = new Map<string, ThreadRecord>();
  const storage = options.persist
    ? (options.storage ?? defaultStorage())
    : undefined;
  const key = threadStorageKey(options.apiUrl);

  if (storage !== undefined) {
    for (const record of load(storage, key)) {
      memory.set(record.rootId, record);
    }
  }

  function save(): void {
    if (storage === undefined) {
      return;
    }
    try {
      storage.setItem(key, JSON.stringify([...memory.values()]));
    } catch {
      // Quota/denied — memory keeps working; persistence is best-effort.
    }
  }

  return {
    list(): ThreadRecord[] {
      return [...memory.values()].map(copy);
    },
    get(rootId: string): ThreadRecord | undefined {
      const record = memory.get(rootId);
      return record === undefined ? undefined : copy(record);
    },
    append(rootId: string, entry: ThreadEntry): void {
      const record = memory.get(rootId) ?? { rootId, entries: [] };
      record.entries = [...record.entries, { ...entry }];
      memory.set(rootId, record);
      save();
    },
  };
}

function copy(record: ThreadRecord): ThreadRecord {
  return {
    rootId: record.rootId,
    entries: record.entries.map((entry) => ({ ...entry })),
  };
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function load(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
): ThreadRecord[] {
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isThreadRecord);
  } catch {
    return [];
  }
}

function isThreadRecord(value: unknown): value is ThreadRecord {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.rootId === 'string' &&
    Array.isArray(record.entries) &&
    record.entries.every(
      (entry: unknown) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).feedbackId === 'string' &&
        typeof (entry as Record<string, unknown>).jobId === 'string' &&
        typeof (entry as Record<string, unknown>).readToken === 'string',
    )
  );
}

/** Tiny non-cryptographic hash for storage-key scoping (not security). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
