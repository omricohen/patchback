import type { TrustTier } from '@patchback/types';

import type { ApiKeyEntry } from './config.js';
import { timingSafeStringEqual } from './ids.js';

/**
 * Server-side tier resolution. THE trust boundary for intake:
 *
 * - A bearer token matching a configured API key resolves to that key's tier
 *   (`owner` | `insider`).
 * - No header, malformed header, or unknown token → `outsider`. Fail closed,
 *   not 401: anonymous submission is a feature — it just lands in the
 *   data-only tier.
 * - Comparison is constant-time; keys never appear in logs or error bodies.
 */
export interface RequestAuth {
  tier: TrustTier;
  /** Label of the matched key, for audit logs. Never the key itself. */
  keyLabel?: string;
  /**
   * The bearer token when it did NOT match an API key — the candidate
   * per-item read token for read/reply routes. Undefined when the caller
   * authenticated with an API key or sent nothing.
   */
  bearerToken?: string;
}

export function resolveAuth(
  authorizationHeader: string | undefined,
  apiKeys: readonly ApiKeyEntry[],
): RequestAuth {
  const token = parseBearer(authorizationHeader);
  if (token === undefined) {
    return { tier: 'outsider' };
  }
  // Compare against every configured key (no early exit on match) so timing
  // does not reveal which — if any — key prefix-matched.
  let matched: ApiKeyEntry | undefined;
  for (const entry of apiKeys) {
    if (timingSafeStringEqual(entry.key, token)) {
      matched = entry;
    }
  }
  if (matched !== undefined) {
    return {
      tier: matched.tier,
      ...(matched.label !== undefined ? { keyLabel: matched.label } : {}),
    };
  }
  return { tier: 'outsider', bearerToken: token };
}

function parseBearer(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token !== undefined && token.length > 0 ? token : undefined;
}
