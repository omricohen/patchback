import { isTrustTier, type TrustTier } from '@patchback/types';

import { canonicalJson, constantTimeHexEqual, hmacHex } from './hmac.js';

/**
 * Per-user browser token: a signed, stateless, tier-scoped, short-lived
 * credential the embedding app's BACKEND mints (by exchanging its server-held
 * API key at `POST /tokens/exchange`) and hands to a specific user's browser
 * in place of the raw key.
 *
 * It reuses the exact signed-stateless HMAC discipline of `issue-marker.ts`
 * (canonical JSON + HMAC-SHA256 + constant-time compare), so there is no new
 * store surface: it works identically under MemoryStore and Postgres, needs no
 * migration, and requires only a signing secret held in server memory.
 *
 * The tradeoff, stated honestly: a stateless token is NOT individually
 * revocable before its TTL. Mitigations — short default TTL, rotating the
 * signing secret (a bulk kill of all outstanding tokens), and removing the
 * parent key (stops new mints). See `docs/SPEC.md` #8 and OPEN_ISSUES.
 *
 * Wire form (the `Authorization: Bearer` value):
 *
 *   pbt_<base64url(canonical JSON payload)>.<hex hmac-sha256 over the canonical JSON>
 *
 * A leaked token grants ONLY its already-limited tier for a bounded window and
 * can never escalate: the tier travels INSIDE the signature (never re-derived),
 * and minting already ceiled it to the parent key's tier.
 */

/** Reserved, self-identifying prefix on the token value (routes it in `resolveAuth`). */
export const BROWSER_TOKEN_PREFIX = 'pbt_';

/** Current token schema version. Bump only on a breaking payload change. */
export const BROWSER_TOKEN_VERSION = 1;

/** Default token lifetime: 15 minutes. */
export const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Hard maximum token lifetime: 60 minutes. A requested TTL is clamped down to this. */
export const DEFAULT_MAX_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Symmetric clock-skew tolerance for a future-dated `iat` (mirrors the marker). */
const CLOCK_SKEW_MS = 5 * 1000;

/** Tiers a token may carry — `outsider` is unmintable (the keyless default anyway). */
export type MintableTier = Extract<TrustTier, 'owner' | 'insider'>;

export interface BrowserTokenPayload {
  /** Schema version. */
  v: number;
  /**
   * Server-assigned trust tier. Travels INSIDE the signature — never
   * re-derived. Ceiled to the parent key's tier at mint time.
   */
  tier: TrustTier;
  /** Opaque app user id. AUDIT ONLY — never influences an authz decision. */
  sub?: string;
  /** ISO-8601 issued-at. The freshness anchor. */
  iat: string;
  /** ISO-8601 expiry. Enforced on EVERY request in `resolveAuth`. */
  exp: string;
}

export type BrowserTokenRejectReason =
  | 'absent'
  | 'malformed'
  | 'unsupported_version'
  | 'bad_signature'
  | 'expired'
  | 'bad_tier';

export type VerifyBrowserTokenResult =
  | { ok: true; payload: BrowserTokenPayload }
  | { ok: false; reason: BrowserTokenRejectReason };

export interface VerifyBrowserTokenOptions {
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

/** Sign a payload → the `pbt_…` wire token. */
export function signBrowserToken(
  payload: BrowserTokenPayload,
  secret: string,
): string {
  const canonical = canonicalJson(payload);
  const sig = hmacHex(secret, canonical);
  const encoded = Buffer.from(canonical, 'utf8').toString('base64url');
  return `${BROWSER_TOKEN_PREFIX}${encoded}.${sig}`;
}

export interface MintBrowserTokenInput {
  /** The (already ceiled) tier this token carries. */
  tier: MintableTier;
  /** Effective lifetime in ms (already clamped by the caller). */
  ttlMs: number;
  /** Opaque app user id for audit only. */
  subject?: string;
  secret: string;
  now?: () => Date;
}

/** Mint a fresh token, computing `iat`/`exp` from `now` + `ttlMs`. */
export function mintBrowserToken(input: MintBrowserTokenInput): {
  token: string;
  expiresAt: string;
  payload: BrowserTokenPayload;
} {
  const nowMs = (input.now?.() ?? new Date()).getTime();
  const iat = new Date(nowMs).toISOString();
  const exp = new Date(nowMs + input.ttlMs).toISOString();
  const payload: BrowserTokenPayload = {
    v: BROWSER_TOKEN_VERSION,
    tier: input.tier,
    iat,
    exp,
    ...(input.subject !== undefined ? { sub: input.subject } : {}),
  };
  return {
    token: signBrowserToken(payload, input.secret),
    expiresAt: exp,
    payload,
  };
}

/**
 * Verify a `pbt_…` token. Returns the signed payload only when EVERY check
 * passes; any failure yields `{ ok:false, reason }`. The caller (`resolveAuth`)
 * treats every failure identically: the token FAILS CLOSED to the outsider
 * tier — exactly like an unknown bearer — never a hard 401.
 *
 * Checks, in order (all fail-closed):
 *  1. present + correct prefix + well-formed (`<base64url>.<64 hex>`)
 *  2. supported version
 *  3. HMAC over the RE-CANONICALIZED parsed payload matches (constant-time)
 *  4. `tier` is a valid, mintable (non-outsider) tier
 *  5. not expired, and `iat` not implausibly future-dated (symmetric skew)
 */
export function verifyBrowserToken(
  token: string | undefined,
  secret: string,
  options: VerifyBrowserTokenOptions = {},
): VerifyBrowserTokenResult {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'absent' };
  }
  if (!token.startsWith(BROWSER_TOKEN_PREFIX)) {
    return { ok: false, reason: 'malformed' };
  }
  const rest = token.slice(BROWSER_TOKEN_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) {
    return { ok: false, reason: 'malformed' };
  }
  const encoded = rest.slice(0, dot);
  const givenSig = rest.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[0-9a-f]{64}$/.test(givenSig)) {
    return { ok: false, reason: 'malformed' };
  }

  let payload: BrowserTokenPayload;
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!isBrowserTokenPayloadShape(parsed)) {
      return { ok: false, reason: 'malformed' };
    }
    payload = parsed;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.v !== BROWSER_TOKEN_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }

  // Re-canonicalize the PARSED payload (not the wire bytes) before signing, so
  // a wire encoding that merely reorders keys cannot change what is
  // authenticated.
  const expectedSig = hmacHex(secret, canonicalJson(payload));
  if (!constantTimeHexEqual(expectedSig, givenSig)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Even correctly signed, `outsider` (or any non-tier) is not a valid token
  // tier — mirrors `ApiKeyEntry`'s "outsider is unrepresentable".
  if (!isTrustTier(payload.tier) || payload.tier === 'outsider') {
    return { ok: false, reason: 'bad_tier' };
  }

  const exp = Date.parse(payload.exp);
  const iat = Date.parse(payload.iat);
  if (Number.isNaN(exp) || Number.isNaN(iat)) {
    return { ok: false, reason: 'malformed' };
  }
  const nowMs = (options.now?.() ?? new Date()).getTime();
  // Expired once now reaches exp; future-dated iat beyond the skew is a clock
  // game and is rejected (symmetric bound, like the marker's freshness check).
  if (nowMs >= exp || iat - nowMs > CLOCK_SKEW_MS) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload };
}

function isBrowserTokenPayloadShape(
  value: unknown,
): value is BrowserTokenPayload {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.v === 'number' &&
    typeof v.tier === 'string' &&
    typeof v.iat === 'string' &&
    typeof v.exp === 'string' &&
    (v.sub === undefined || typeof v.sub === 'string')
  );
}
