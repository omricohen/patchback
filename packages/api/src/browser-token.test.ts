import { describe, expect, it } from 'vitest';

import { canonicalJson, hmacHex } from './hmac.js';
import {
  BROWSER_TOKEN_PREFIX,
  DEFAULT_TOKEN_TTL_MS,
  mintBrowserToken,
  signBrowserToken,
  verifyBrowserToken,
  type BrowserTokenPayload,
} from './browser-token.js';

const SECRET = 'browser-token-secret-0123456789';
const NOW = new Date('2026-07-20T12:00:00.000Z');
const now = (): Date => NOW;

function mint(overrides?: {
  tier?: 'owner' | 'insider';
  ttlMs?: number;
  subject?: string;
  secret?: string;
}): string {
  return mintBrowserToken({
    tier: overrides?.tier ?? 'insider',
    ttlMs: overrides?.ttlMs ?? DEFAULT_TOKEN_TTL_MS,
    ...(overrides?.subject !== undefined ? { subject: overrides.subject } : {}),
    secret: overrides?.secret ?? SECRET,
    now,
  }).token;
}

describe('signBrowserToken / verifyBrowserToken round trip', () => {
  it('mints a token with the pbt_ prefix and verifies it', () => {
    const token = mint();
    expect(token.startsWith(BROWSER_TOKEN_PREFIX)).toBe(true);
    const result = verifyBrowserToken(token, SECRET, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tier).toBe('insider');
    }
  });

  it('carries the tier INSIDE the signature (owner and insider round-trip)', () => {
    for (const tier of ['owner', 'insider'] as const) {
      const result = verifyBrowserToken(mint({ tier }), SECRET, { now });
      expect(result.ok && result.payload.tier).toBe(tier);
    }
  });

  it('carries an audit-only subject when supplied', () => {
    const result = verifyBrowserToken(mint({ subject: 'app-user-42' }), SECRET, {
      now,
    });
    expect(result.ok && result.payload.sub).toBe('app-user-42');
  });

  it('sets exp = iat + ttl', () => {
    const { payload, expiresAt } = mintBrowserToken({
      tier: 'owner',
      ttlMs: DEFAULT_TOKEN_TTL_MS,
      secret: SECRET,
      now,
    });
    expect(Date.parse(payload.iat)).toBe(NOW.getTime());
    expect(Date.parse(expiresAt)).toBe(NOW.getTime() + DEFAULT_TOKEN_TTL_MS);
  });
});

describe('verifyBrowserToken rejects — the tamper battery', () => {
  it('undefined / empty → absent', () => {
    expect(verifyBrowserToken(undefined, SECRET, { now })).toEqual({
      ok: false,
      reason: 'absent',
    });
    expect(verifyBrowserToken('', SECRET, { now })).toEqual({
      ok: false,
      reason: 'absent',
    });
  });

  it('wrong prefix → malformed', () => {
    const token = mint().slice(BROWSER_TOKEN_PREFIX.length); // strip pbt_
    expect(verifyBrowserToken(token, SECRET, { now })).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyBrowserToken('xxx_garbage.deadbeef', SECRET, { now })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('truncated / garbage body → malformed', () => {
    expect(verifyBrowserToken(`${BROWSER_TOKEN_PREFIX}nodot`, SECRET, { now })).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(
      verifyBrowserToken(`${BROWSER_TOKEN_PREFIX}!!!.${'a'.repeat(64)}`, SECRET, {
        now,
      }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('flipped byte in the signature → bad_signature', () => {
    const token = mint();
    const tampered = token.replace(/([0-9a-f])$/, (_m, c: string) =>
      c === 'a' ? 'b' : 'a',
    );
    expect(verifyBrowserToken(tampered, SECRET, { now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('wrong secret → bad_signature', () => {
    expect(
      verifyBrowserToken(mint(), 'a-different-secret-0000', { now }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('attacker re-signing with their OWN secret → bad_signature under the real secret', () => {
    const forged = mint({ secret: 'attacker-controlled-secret-00' });
    expect(verifyBrowserToken(forged, SECRET, { now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('tier bumped inside the payload keeping the original signature → bad_signature', () => {
    // Sign an insider token, then re-encode the payload as owner but leave the
    // signature untouched. Re-canonicalizing + re-HMAC fails.
    const { token, payload } = mintBrowserToken({
      tier: 'insider',
      ttlMs: DEFAULT_TOKEN_TTL_MS,
      secret: SECRET,
      now,
    });
    const sig = token.slice(token.indexOf('.') + 1);
    const forged: BrowserTokenPayload = { ...payload, tier: 'owner' };
    const wire = Buffer.from(canonicalJson(forged), 'utf8').toString('base64url');
    const tampered = `${BROWSER_TOKEN_PREFIX}${wire}.${sig}`;
    expect(verifyBrowserToken(tampered, SECRET, { now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('unsupported payload version → unsupported_version', () => {
    const payload = {
      v: 2,
      tier: 'owner',
      iat: NOW.toISOString(),
      exp: new Date(NOW.getTime() + DEFAULT_TOKEN_TTL_MS).toISOString(),
    };
    const token = signBrowserToken(
      payload as unknown as BrowserTokenPayload,
      SECRET,
    );
    expect(verifyBrowserToken(token, SECRET, { now })).toEqual({
      ok: false,
      reason: 'unsupported_version',
    });
  });

  it('a correctly-signed outsider tier → bad_tier (outsider is unmintable)', () => {
    const payload = {
      v: 1,
      tier: 'outsider',
      iat: NOW.toISOString(),
      exp: new Date(NOW.getTime() + DEFAULT_TOKEN_TTL_MS).toISOString(),
    };
    const token = signBrowserToken(
      payload as unknown as BrowserTokenPayload,
      SECRET,
    );
    expect(verifyBrowserToken(token, SECRET, { now })).toEqual({
      ok: false,
      reason: 'bad_tier',
    });
  });
});

describe('expiry boundary (injected clock)', () => {
  it('valid at exp - ε, expired at exp + ε', () => {
    const token = mint({ ttlMs: DEFAULT_TOKEN_TTL_MS });
    const exp = NOW.getTime() + DEFAULT_TOKEN_TTL_MS;

    const justValid = (): Date => new Date(exp - 1);
    expect(verifyBrowserToken(token, SECRET, { now: justValid }).ok).toBe(true);

    const justExpired = (): Date => new Date(exp + 1);
    expect(verifyBrowserToken(token, SECRET, { now: justExpired })).toEqual({
      ok: false,
      reason: 'expired',
    });

    // Exactly at exp is expired (valid strictly before exp).
    const atExp = (): Date => new Date(exp);
    expect(verifyBrowserToken(token, SECRET, { now: atExp }).ok).toBe(false);
  });

  it('a token dated implausibly far in the future → expired', () => {
    const future = (): Date => new Date(NOW.getTime() - 60 * 1000); // now is 60s BEFORE iat
    const token = mint();
    expect(verifyBrowserToken(token, SECRET, { now: future })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('tolerates small clock skew on iat', () => {
    const token = mint();
    // now is 2s before iat — within the 5s skew tolerance.
    const slightlyBefore = (): Date => new Date(NOW.getTime() - 2 * 1000);
    expect(verifyBrowserToken(token, SECRET, { now: slightlyBefore }).ok).toBe(
      true,
    );
  });
});

describe('canonicalization stability', () => {
  it('accepts a valid signature even when the wire JSON key order differs', () => {
    const payload: BrowserTokenPayload = {
      v: 1,
      tier: 'owner',
      iat: NOW.toISOString(),
      exp: new Date(NOW.getTime() + DEFAULT_TOKEN_TTL_MS).toISOString(),
    };
    const sig = hmacHex(SECRET, canonicalJson(payload));
    const scrambled = JSON.stringify({
      exp: payload.exp,
      tier: payload.tier,
      v: payload.v,
      iat: payload.iat,
    });
    const wire = Buffer.from(scrambled, 'utf8').toString('base64url');
    const token = `${BROWSER_TOKEN_PREFIX}${wire}.${sig}`;
    const result = verifyBrowserToken(token, SECRET, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tier).toBe('owner');
    }
  });
});
