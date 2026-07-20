import { describe, expect, it } from 'vitest';

import { resolveAuth, type BrowserTokenVerifier } from './auth.js';
import {
  mintBrowserToken,
  verifyBrowserToken,
} from './browser-token.js';
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
    expect(auth).toEqual({ tier: 'owner', via: 'api-key', keyLabel: 'omri' });
    expect(resolveAuth('Bearer insider-key-0123456789abcdef', KEYS).tier).toBe(
      'insider',
    );
  });

  it('no header resolves to outsider with no read token', () => {
    expect(resolveAuth(undefined, KEYS)).toEqual({
      tier: 'outsider',
      via: 'none',
    });
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

describe('resolveAuth — browser token branch', () => {
  const SECRET = 'browser-token-secret-0123456789';
  const NOW = new Date('2026-07-20T12:00:00.000Z');
  const verifier: BrowserTokenVerifier = (token) =>
    verifyBrowserToken(token, SECRET, { now: () => NOW });

  function token(tier: 'owner' | 'insider', subject?: string): string {
    return mintBrowserToken({
      tier,
      ttlMs: 15 * 60 * 1000,
      secret: SECRET,
      now: () => NOW,
      ...(subject !== undefined ? { subject } : {}),
    }).token;
  }

  it('resolves a valid token to the minted tier, via browser-token', () => {
    const auth = resolveAuth(`Bearer ${token('insider')}`, KEYS, verifier);
    expect(auth.tier).toBe('insider');
    expect(auth.via).toBe('browser-token');
    expect(auth.bearerToken).toBeUndefined();
  });

  it('surfaces the subject for audit only', () => {
    const auth = resolveAuth(
      `Bearer ${token('owner', 'app-user-9')}`,
      KEYS,
      verifier,
    );
    expect(auth.subject).toBe('app-user-9');
  });

  it('an EXPIRED token fails closed to outsider (not a hard error)', () => {
    const expiredVerifier: BrowserTokenVerifier = (t) =>
      verifyBrowserToken(t, SECRET, {
        now: () => new Date(NOW.getTime() + 60 * 60 * 1000),
      });
    const auth = resolveAuth(`Bearer ${token('owner')}`, KEYS, expiredVerifier);
    expect(auth.tier).toBe('outsider');
    // A pbt_ value that failed verification is not treated as a read-token
    // candidate — it fell through, so it lands as one exactly like any unknown.
    expect(auth.via).toBe('read-token-candidate');
  });

  it('a tampered token fails closed to outsider', () => {
    const good = token('owner');
    const tampered = good.replace(/([0-9a-f])$/, (_m, c: string) =>
      c === 'a' ? 'b' : 'a',
    );
    expect(resolveAuth(`Bearer ${tampered}`, KEYS, verifier).tier).toBe(
      'outsider',
    );
  });

  it('an API key still wins over the token branch (keys checked first)', () => {
    const auth = resolveAuth('Bearer owner-key-0123456789abcdef', KEYS, verifier);
    expect(auth).toEqual({ tier: 'owner', via: 'api-key', keyLabel: 'omri' });
  });

  it('a pbt_ value with NO verifier configured lands as a read-token candidate', () => {
    const auth = resolveAuth(`Bearer ${token('owner')}`, KEYS);
    expect(auth.tier).toBe('outsider');
    expect(auth.via).toBe('read-token-candidate');
    expect(auth.bearerToken?.startsWith('pbt_')).toBe(true);
  });

  it('absent-config byte-identical: third arg absent vs undefined match exactly', () => {
    const pbt = token('insider');
    const matrix = [
      undefined,
      'Bearer owner-key-0123456789abcdef',
      'Bearer some-unknown-token',
      `Bearer ${pbt}`,
      'Basic xyz',
    ];
    for (const header of matrix) {
      expect(resolveAuth(header, KEYS)).toEqual(
        resolveAuth(header, KEYS, undefined),
      );
    }
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
      createIssueComment: async () => ({ id: 1, url: '' }),
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
    pipeline: {
      run: async () => ({ ok: false, error: 'unused', repairAttempts: 0 }),
    },
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

  describe('tokenExchange', () => {
    it('accepts an absent, empty, or fully-specified block', () => {
      expect(() => validateConfig(baseConfig())).not.toThrow();
      expect(() =>
        validateConfig(baseConfig({ tokenExchange: {} })),
      ).not.toThrow();
      expect(() =>
        validateConfig(
          baseConfig({
            tokenExchange: {
              signingSecret: 's'.repeat(24),
              defaultTtlMs: 60_000,
              maxTtlMs: 120_000,
            },
          }),
        ),
      ).not.toThrow();
    });

    it('rejects a short explicit signingSecret', () => {
      expect(() =>
        validateConfig(baseConfig({ tokenExchange: { signingSecret: 'short' } })),
      ).toThrow(/signingSecret/);
    });

    it('rejects defaultTtlMs > maxTtlMs', () => {
      expect(() =>
        validateConfig(
          baseConfig({
            tokenExchange: { defaultTtlMs: 120_000, maxTtlMs: 60_000 },
          }),
        ),
      ).toThrow(/defaultTtlMs must be <=/);
    });

    it('rejects an API key that collides with the reserved pbt_ prefix', () => {
      expect(() =>
        validateConfig(
          baseConfig({
            apiKeys: [{ key: `pbt_${'x'.repeat(20)}`, tier: 'owner' }],
            tokenExchange: { signingSecret: 's'.repeat(24) },
          }),
        ),
      ).toThrow(/reserved/);
    });

    it('does NOT reject a pbt_ key when tokenExchange is absent (byte-identical)', () => {
      expect(() =>
        validateConfig(
          baseConfig({
            apiKeys: [{ key: `pbt_${'x'.repeat(20)}`, tier: 'owner' }],
          }),
        ),
      ).not.toThrow();
    });
  });
});
