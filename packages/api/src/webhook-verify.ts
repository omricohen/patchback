import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * GitHub webhook HMAC verification (X-Hub-Signature-256), pure and
 * unit-testable. Computed over the RAW request bytes — the route registers
 * its own buffer content-type parser so nothing parses JSON before this
 * check passes.
 */
export function verifyWebhookSignature(
  secret: string,
  payload: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (signatureHeader === undefined) {
    return false;
  }
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  const given = match?.[1];
  if (given === undefined) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  // Hash both hex strings before comparing: constant-time regardless of
  // where they differ, no length games possible.
  return timingSafeEqual(
    createHash('sha256').update(expected.toLowerCase()).digest(),
    createHash('sha256').update(given.toLowerCase()).digest(),
  );
}
