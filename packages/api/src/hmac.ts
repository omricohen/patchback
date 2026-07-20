import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Shared signed-stateless HMAC primitives. The two in-tree consumers — the
 * Action issue marker (`issue-marker.ts`) and the per-user browser token
 * (`browser-token.ts`) — both sign a canonical JSON payload with HMAC-SHA256
 * and verify it with a constant-time comparison. Factoring the crypto here
 * keeps ONE audited implementation instead of two copies.
 */

/**
 * Deterministic JSON with lexicographically sorted keys, so the bytes the HMAC
 * covers are stable regardless of object construction order. Recurses
 * defensively even though payloads are flat objects of primitives.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** HMAC-SHA256 (hex) of a canonical string under a secret. */
export function hmacHex(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Constant-time hex comparison: hash both sides then `timingSafeEqual`, so the
 * comparison time is independent of where (or whether) the strings differ and
 * no length game is possible. Identical to the webhook verifier's approach.
 */
export function constantTimeHexEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a.toLowerCase()).digest(),
    createHash('sha256').update(b.toLowerCase()).digest(),
  );
}
