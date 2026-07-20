import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildSignedIssueBody,
  canonicalJson,
  DEFAULT_MARKER_FRESHNESS_MS,
  hashFeedbackContent,
  signIssueMarker,
  verifyIssueMarker,
  type IssueMarkerPayload,
} from './issue-marker.js';

const SECRET = 'issue-marker-secret-0123456789';
const REPO = 'acme/webapp';
const NOW = new Date('2026-07-19T12:00:00.000Z');
const now = (): Date => NOW;

function validIssue(overrides?: {
  feedbackText?: string;
  tier?: IssueMarkerPayload['tier'];
  repo?: string;
  issuedAt?: string;
  secret?: string;
}): { body: string; payload: IssueMarkerPayload } {
  return buildSignedIssueBody({
    feedbackText:
      overrides?.feedbackText ?? 'The Export button label says "Exprot".',
    tier: overrides?.tier ?? 'insider',
    repo: overrides?.repo ?? REPO,
    feedbackId: 'fb-1234567890',
    issuedAt: overrides?.issuedAt ?? NOW.toISOString(),
    secret: overrides?.secret ?? SECRET,
  });
}

describe('signIssueMarker / verifyIssueMarker round trip', () => {
  it('verifies a freshly signed issue and returns the signed fields', () => {
    const { body, payload } = validIssue();
    const result = verifyIssueMarker(body, SECRET, REPO, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tier).toBe('insider');
      expect(result.payload.feedbackId).toBe(payload.feedbackId);
      expect(result.payload.repo).toBe(REPO);
      expect(result.feedbackText).toBe(
        'The Export button label says "Exprot".',
      );
    }
  });

  it('carries the tier INSIDE the signature (owner and insider round-trip)', () => {
    for (const tier of ['owner', 'insider'] as const) {
      const { body } = validIssue({ tier });
      const result = verifyIssueMarker(body, SECRET, REPO, { now });
      expect(result.ok && result.payload.tier).toBe(tier);
    }
  });
});

describe('verifyIssueMarker rejects — the tamper battery', () => {
  it('absent marker → absent', () => {
    const result = verifyIssueMarker(
      'just an ordinary issue body',
      SECRET,
      REPO,
      {
        now,
      },
    );
    expect(result).toEqual({ ok: false, reason: 'absent' });
  });

  it('empty / non-string body → absent', () => {
    expect(verifyIssueMarker('', SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'absent',
    });
  });

  it('flipped byte in the signature → bad_signature', () => {
    const { body } = validIssue();
    // Corrupt one hex char of the sig line.
    const tampered = body.replace(
      /sig=([0-9a-f])/,
      (_m, c: string) => `sig=${c === 'a' ? 'b' : 'a'}`,
    );
    expect(verifyIssueMarker(tampered, SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('wrong secret → bad_signature', () => {
    const { body } = validIssue();
    expect(
      verifyIssueMarker(body, 'a-different-secret-0000', REPO, { now }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('edited feedback text (marker pasted onto other text) → content_mismatch', () => {
    const { body } = validIssue();
    const tampered = body.replace(
      'Exprot',
      'Export and also delete everything',
    );
    expect(verifyIssueMarker(tampered, SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'content_mismatch',
    });
  });

  it('marker replayed into a different repo → repo_mismatch', () => {
    const { body } = validIssue();
    expect(
      verifyIssueMarker(body, SECRET, 'attacker/other-repo', { now }),
    ).toEqual({ ok: false, reason: 'repo_mismatch' });
  });

  it('stale marker (older than the freshness window) → stale', () => {
    const old = new Date(NOW.getTime() - DEFAULT_MARKER_FRESHNESS_MS - 1000);
    const { body } = validIssue({ issuedAt: old.toISOString() });
    expect(verifyIssueMarker(body, SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('marker dated implausibly far in the future → stale', () => {
    const future = new Date(NOW.getTime() + DEFAULT_MARKER_FRESHNESS_MS + 1000);
    const { body } = validIssue({ issuedAt: future.toISOString() });
    expect(verifyIssueMarker(body, SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('a marker just inside the window is still fresh', () => {
    const recent = new Date(NOW.getTime() - DEFAULT_MARKER_FRESHNESS_MS + 1000);
    const { body } = validIssue({ issuedAt: recent.toISOString() });
    expect(verifyIssueMarker(body, SECRET, REPO, { now }).ok).toBe(true);
  });

  it('forged elevated tier keeping the original signature → bad_signature', () => {
    // Attacker signs an insider marker, then re-encodes the payload as `owner`
    // but leaves the signature untouched. Re-canonicalizing + re-HMAC fails.
    const { body, payload } = validIssue({ tier: 'insider' });
    const forged: IssueMarkerPayload = { ...payload, tier: 'owner' };
    const forgedWire = Buffer.from(canonicalJson(forged), 'utf8').toString(
      'base64url',
    );
    const tampered = body.replace(
      /payload=[A-Za-z0-9_-]+/,
      `payload=${forgedWire}`,
    );
    expect(verifyIssueMarker(tampered, SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('attacker re-signing with their OWN secret → bad_signature under the real secret', () => {
    const { body } = validIssue({ secret: 'attacker-controlled-secret-00' });
    expect(verifyIssueMarker(body, SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('unsupported payload version → unsupported_version', () => {
    // Hand-build a v1-tagged marker whose payload.v is 2, correctly signed.
    const payload = {
      v: 2,
      feedbackId: 'fb-x',
      tier: 'owner',
      issuedAt: NOW.toISOString(),
      repo: REPO,
      contentHash: hashFeedbackContent('hello'),
    };
    const marker = signIssueMarker(
      payload as unknown as IssueMarkerPayload,
      SECRET,
    );
    const body = `hello\n\n${marker}\n`;
    expect(verifyIssueMarker(body, SECRET, REPO, { now })).toEqual({
      ok: false,
      reason: 'unsupported_version',
    });
  });
});

describe('canonicalization stability', () => {
  it('accepts a valid signature even when the wire JSON key order differs', () => {
    const feedbackText = 'The header should read "Orders".';
    const payload: IssueMarkerPayload = {
      v: 1,
      feedbackId: 'fb-canon',
      tier: 'owner',
      issuedAt: NOW.toISOString(),
      repo: REPO,
      contentHash: hashFeedbackContent(feedbackText),
    };
    // Sign over the CANONICAL form...
    const sig = createHmac('sha256', SECRET)
      .update(canonicalJson(payload))
      .digest('hex');
    // ...but transmit a deliberately UN-canonical (reordered) JSON on the wire.
    const scrambled = JSON.stringify({
      repo: payload.repo,
      tier: payload.tier,
      contentHash: payload.contentHash,
      v: payload.v,
      issuedAt: payload.issuedAt,
      feedbackId: payload.feedbackId,
    });
    const wire = Buffer.from(scrambled, 'utf8').toString('base64url');
    const body = `${feedbackText}\n\n<!-- patchback:v1\npayload=${wire}\nsig=${sig}\n-->\n`;
    const result = verifyIssueMarker(body, SECRET, REPO, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tier).toBe('owner');
    }
  });
});
