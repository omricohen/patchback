import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

/** New entity id. UUIDv4 — opaque, URL-safe, and collision-free. */
export function generateId(): string {
  return randomUUID();
}

/**
 * Per-item read token: 32 random bytes, base64url. Returned ONCE at creation;
 * only its hash is stored. Possession of the token is the read capability for
 * that item (ids alone are not — they end up in URLs and logs by design).
 */
export function generateReadToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a read token — the only form ever persisted. */
export function hashReadToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time string equality. Both sides are hashed first, so inputs of
 * different lengths are compared without leaking length information.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
