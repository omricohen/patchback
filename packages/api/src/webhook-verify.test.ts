import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyWebhookSignature } from './webhook-verify.js';

const SECRET = 'webhook-secret-0123456789';

function sign(payload: Buffer, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

describe('verifyWebhookSignature', () => {
  const payload = Buffer.from(JSON.stringify({ action: 'closed' }));

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(SECRET, payload, sign(payload))).toBe(true);
  });

  it('accepts uppercase hex digests', () => {
    const upper = sign(payload).replace(/^sha256=/, '');
    expect(
      verifyWebhookSignature(SECRET, payload, `sha256=${upper.toUpperCase()}`),
    ).toBe(true);
  });

  it('rejects a missing signature header', () => {
    expect(verifyWebhookSignature(SECRET, payload, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, payload, '')).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    expect(
      verifyWebhookSignature(
        SECRET,
        payload,
        sign(payload, 'other-secret-0123456789'),
      ),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from(JSON.stringify({ action: 'merged!' }));
    expect(verifyWebhookSignature(SECRET, tampered, sign(payload))).toBe(false);
  });

  it('rejects malformed and length-gamed headers', () => {
    const valid = sign(payload);
    expect(verifyWebhookSignature(SECRET, payload, valid.slice(7))).toBe(false); // no prefix
    expect(verifyWebhookSignature(SECRET, payload, `sha1=${'a'.repeat(40)}`)).toBe(false);
    expect(verifyWebhookSignature(SECRET, payload, 'sha256=')).toBe(false);
    expect(verifyWebhookSignature(SECRET, payload, 'sha256=zz')).toBe(false);
    expect(verifyWebhookSignature(SECRET, payload, `${valid}00`)).toBe(false); // too long
    expect(verifyWebhookSignature(SECRET, payload, valid.slice(0, -2))).toBe(false); // too short
    expect(verifyWebhookSignature(SECRET, payload, `sha256=${'g'.repeat(64)}`)).toBe(false); // non-hex
  });
});
