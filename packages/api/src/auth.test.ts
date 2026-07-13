import { describe, expect, it } from 'vitest';

import { resolveAuth } from './auth.js';
import {
  ConfigError,
  validateConfig,
  type ApiConfig,
  type ApiKeyEntry,
} from './config.js';
import { MemoryQueue } from './queue/memory.js';
import { MemoryStore } from './store/memory.js';

const KEYS: ApiKeyEntry[] = [
  { key: 'owner-key-0123456789abcdef', tier: 'owner', label: 'omri' },
  { key: 'insider-key-0123456789abcdef', tier: 'insider' },
];

describe('resolveAuth', () => {
  it('resolves a configured key to its tier and label', () => {
    const auth = resolveAuth('Bearer owner-key-0123456789abcdef', KEYS);
    expect(auth).toEqual({ tier: 'owner', keyLabel: 'omri' });
    expect(resolveAuth('Bearer insider-key-0123456789abcdef', KEYS).tier).toBe(
      'insider',
    );
  });

  it('no header resolves to outsider with no read token', () => {
    expect(resolveAuth(undefined, KEYS)).toEqual({ tier: 'outsider' });
  });

  it('unknown bearer token resolves to outsider, kept as candidate read token', () => {
    const auth = resolveAuth('Bearer some-read-token', KEYS);
    expect(auth.tier).toBe('outsider');
    expect(auth.bearerToken).toBe('some-read-token');
    expect(auth.keyLabel).toBeUndefined();
  });

  it('malformed authorization headers resolve to outsider', () => {
    expect(resolveAuth('Basic dXNlcjpwYXNz', KEYS).tier).toBe('outsider');
    expect(resolveAuth('Bearer', KEYS).tier).toBe('outsider');
    expect(resolveAuth('Bearer ', KEYS).tier).toBe('outsider');
    expect(resolveAuth('', KEYS).tier).toBe('outsider');
  });

  it('a key that is a prefix or extension of a real key does not match', () => {
    expect(resolveAuth('Bearer owner-key-0123456789abcde', KEYS).tier).toBe(
      'outsider',
    );
    expect(resolveAuth('Bearer owner-key-0123456789abcdefX', KEYS).tier).toBe(
      'outsider',
    );
  });

  it('the api key itself never leaks into the resolved auth', () => {
    const auth = resolveAuth('Bearer owner-key-0123456789abcdef', KEYS);
    expect(JSON.stringify(auth)).not.toContain('owner-key');
  });
});

function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    store: new MemoryStore(),
    queue: new MemoryQueue(),
    callModel: async () => ({ text: '{}' }),
    githubClient: {
      repo: { owner: 'acme', repo: 'demo' },
      createIssue: async () => ({ number: 1, title: '', url: '' }),
      createBranch: async () => ({ branch: '', ref: '', sha: '' }),
      commitFiles: async () => ({ sha: '', message: '', url: '' }),
      openPullRequest: async () => ({
        number: 1,
        url: '',
        head: { branch: '', sha: '' },
        base: 'main',
      }),
      getPullRequestStatus: async () => ({
        number: 1,
        state: 'open' as const,
        draft: false,
        merged: false,
        headSha: '',
        url: '',
      }),
    },
    pipeline: { run: async () => ({ ok: false, error: 'unused' }) },
    ...overrides,
  };
}

describe('validateConfig', () => {
  it('accepts a minimal valid config', () => {
    expect(() => validateConfig(baseConfig())).not.toThrow();
    expect(() => validateConfig(baseConfig({ apiKeys: KEYS }))).not.toThrow();
  });

  it('rejects an outsider-tier key: no key IS outsider', () => {
    expect(() =>
      validateConfig(
        baseConfig({
          apiKeys: [{ key: 'x'.repeat(24), tier: 'outsider' as never }],
        }),
      ),
    ).toThrow(ConfigError);
  });

  it('rejects unknown tier strings at load time (fail closed)', () => {
    expect(() =>
      validateConfig(
        baseConfig({
          apiKeys: [{ key: 'x'.repeat(24), tier: 'superadmin' as never }],
        }),
      ),
    ).toThrow(/tier must be "owner" or "insider"/);
  });

  it('rejects short keys, duplicate keys, and short webhook secrets', () => {
    expect(() =>
      validateConfig(
        baseConfig({ apiKeys: [{ key: 'short', tier: 'owner' }] }),
      ),
    ).toThrow(/at least 16 characters/);
    expect(() =>
      validateConfig(
        baseConfig({
          apiKeys: [
            { key: 'x'.repeat(24), tier: 'owner' },
            { key: 'x'.repeat(24), tier: 'insider' },
          ],
        }),
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      validateConfig(baseConfig({ webhookSecret: 'short' })),
    ).toThrow(/webhookSecret/);
  });

  it('rejects a config with neither pipeline nor adapter+repoSource', () => {
    const config = baseConfig();
    delete (config as { pipeline?: unknown }).pipeline;
    expect(() => validateConfig(config)).toThrow(
      /either `pipeline` or both `adapter` and `repoSource`/,
    );
  });

  it('rejects an out-of-range confidence threshold', () => {
    expect(() =>
      validateConfig(baseConfig({ confidenceThreshold: 1.5 })),
    ).toThrow(/confidenceThreshold/);
    expect(() =>
      validateConfig(baseConfig({ confidenceThreshold: Number.NaN })),
    ).toThrow(/confidenceThreshold/);
  });
});
