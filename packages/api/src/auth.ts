import type { TrustTier } from '@patchback/types';

import { BROWSER_TOKEN_PREFIX } from './browser-token.js';
import type { VerifyBrowserTokenResult } from './browser-token.js';
import type { ApiKeyEntry } from './config.js';
import { timingSafeStringEqual } from './ids.js';

/**
 * Server-side tier resolution. THE trust boundary for intake:
 *
 * - A bearer token matching a configured API key resolves to that key's tier
 *   (`owner` | `insider`). Checked FIRST, always.
 * - A valid `pbt_` browser token (only when a verifier is configured) resolves
 *   to the tier minted INTO the token — never above what was minted, and
 *   minting already ceiled it to the parent key's tier.
 * - No header, malformed header, unknown token, OR an expired/invalid browser
 *   token → `outsider`. Fail closed, not 401: anonymous submission is a
 *   feature — a stale token just lands in the data-only tier, exactly like no
 *   credential.
 * - Comparison is constant-time; keys never appear in logs or error bodies.
 */

/** How the caller authenticated — the `no-chaining` discriminator, among other uses. */
export type AuthVia =
  'api-key' | 'browser-token' | 'read-token-candidate' | 'none';

export interface RequestAuth {
  tier: TrustTier;
  /** How the credential resolved. `api-key` is required to mint browser tokens. */
  via: AuthVia;
  /** Label of the matched key, for audit logs. Never the key itself. */
  keyLabel?: string;
  /** Opaque subject from a browser token — AUDIT ONLY, never an authz input. */
  subject?: string;
  /**
   * The bearer token when it did NOT match an API key or a browser token — the
   * candidate per-item read token for read/reply routes. Undefined when the
   * caller authenticated with an API key / browser token or sent nothing.
   */
  bearerToken?: string;
}

/** A bound verifier for `pbt_` tokens (secret + clock already closed over). */
export type BrowserTokenVerifier = (token: string) => VerifyBrowserTokenResult;

export function resolveAuth(
  authorizationHeader: string | undefined,
  apiKeys: readonly ApiKeyEntry[],
  tokenVerifier?: BrowserTokenVerifier,
): RequestAuth {
  const token = parseBearer(authorizationHeader);
  if (token === undefined) {
    return { tier: 'outsider', via: 'none' };
  }
  // Compare against every configured key (no early exit on match) so timing
  // does not reveal which — if any — key prefix-matched. API keys win FIRST,
  // so the direct-key path is byte-identical to the pre-token behavior.
  let matched: ApiKeyEntry | undefined;
  for (const entry of apiKeys) {
    if (timingSafeStringEqual(entry.key, token)) {
      matched = entry;
    }
  }
  if (matched !== undefined) {
    return {
      tier: matched.tier,
      via: 'api-key',
      ...(matched.label !== undefined ? { keyLabel: matched.label } : {}),
    };
  }
  // Only if no key matched, a verifier is configured, AND the value carries the
  // reserved prefix: verify it. Any failure falls through to outsider below —
  // "rejected" means fail-closed demotion, not a hard error.
  if (tokenVerifier !== undefined && token.startsWith(BROWSER_TOKEN_PREFIX)) {
    const result = tokenVerifier(token);
    if (result.ok) {
      return {
        tier: result.payload.tier,
        via: 'browser-token',
        ...(result.payload.sub !== undefined
          ? { subject: result.payload.sub }
          : {}),
      };
    }
  }
  return { tier: 'outsider', via: 'read-token-candidate', bearerToken: token };
}

function parseBearer(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token !== undefined && token.length > 0 ? token : undefined;
}
