import { createHash } from 'node:crypto';

import { isTrustTier, type TrustTier } from '@patchback/types';

import { canonicalJson, constantTimeHexEqual, hmacHex } from './hmac.js';

export { canonicalJson } from './hmac.js';

/**
 * The signed marker that binds a patchback-created GitHub issue to the trust
 * decision the ingest made. It is the PRIMARY, load-bearing gate for Action
 * mode: the `patchback` label is only a coarse workflow trigger filter, never
 * authorization. Everything security-relevant lives inside the HMAC.
 *
 * Reuses the exact constant-time HMAC discipline of `webhook-verify.ts`
 * (createHmac('sha256', …) + hash-both-then-timingSafeEqual). Marker
 * verification is the whole boundary for Action mode, so the code stays next
 * to the other trust primitives in this package and is exhaustively tested.
 *
 * Wire form embedded at the end of the issue body:
 *
 *   <!-- patchback:v1
 *   payload=<base64url(canonical JSON)>
 *   sig=<hex hmac-sha256 over the canonical JSON>
 *   -->
 *
 * The signed payload binds: the exact feedback text (via `contentHash`), the
 * server-assigned trust `tier` (so it can never be forged or elevated), a
 * `feedbackId` nonce, the `repo` (so a marker cannot be replayed into another
 * repository), and an `issuedAt` freshness anchor.
 */

/** Current marker schema version. Bump only on a breaking payload change. */
export const ISSUE_MARKER_VERSION = 1;

/** Default freshness window: markers older than this are rejected (replay bound). */
export const DEFAULT_MARKER_FRESHNESS_MS = 24 * 60 * 60 * 1000; // 24h

export interface IssueMarkerPayload {
  /** Schema version. */
  v: number;
  /** Random id; doubles as the replay nonce and the deterministic branch key. */
  feedbackId: string;
  /** Server-assigned trust tier. Travels INSIDE the signature — never re-derived. */
  tier: TrustTier;
  /** ISO-8601 issue time; the freshness anchor. */
  issuedAt: string;
  /** `owner/name` this marker is bound to. */
  repo: string;
  /** SHA-256 (hex) of the canonical feedback text rendered in the issue body. */
  contentHash: string;
}

export type MarkerRejectReason =
  | 'absent'
  | 'malformed'
  | 'unsupported_version'
  | 'bad_signature'
  | 'content_mismatch'
  | 'repo_mismatch'
  | 'stale'
  | 'bad_tier';

export type VerifyMarkerResult =
  | {
      ok: true;
      payload: IssueMarkerPayload;
      /** The verified feedback text (the body section the contentHash covers). */
      feedbackText: string;
    }
  | { ok: false; reason: MarkerRejectReason };

export interface VerifyMarkerOptions {
  /** Clock injection for deterministic tests. */
  now?: () => Date;
  /** Freshness window in ms. Default {@link DEFAULT_MARKER_FRESHNESS_MS}. */
  freshnessWindowMs?: number;
}

const MARKER_OPEN = '<!-- patchback:v1';

// Anchored, whitespace-tolerant. base64url payload (no padding) + 64 hex sig.
const MARKER_RE =
  /<!--\s*patchback:v1\s*\n\s*payload=([A-Za-z0-9_-]+)\s*\n\s*sig=([0-9a-f]{64})\s*\n\s*-->/;

/** SHA-256 (hex) of the canonical feedback text (trimmed). */
export function hashFeedbackContent(feedbackText: string): string {
  return createHash('sha256')
    .update(normalizeFeedback(feedbackText))
    .digest('hex');
}

function normalizeFeedback(text: string): string {
  // Normalize line endings and trim surrounding whitespace so the hash the
  // ingest signs matches the section the Action re-extracts from the rendered
  // body (which the verifier trims identically).
  return text.replace(/\r\n/g, '\n').trim();
}

/** Sign a payload → the marker comment block (the trailing `\n` is caller's). */
export function signIssueMarker(
  payload: IssueMarkerPayload,
  secret: string,
): string {
  const canonical = canonicalJson(payload);
  const sig = hmacHex(secret, canonical);
  const encoded = Buffer.from(canonical, 'utf8').toString('base64url');
  return `${MARKER_OPEN}\npayload=${encoded}\nsig=${sig}\n-->`;
}

export interface BuildSignedIssueInput {
  feedbackText: string;
  tier: TrustTier;
  repo: string;
  feedbackId: string;
  issuedAt: string;
  secret: string;
}

/**
 * Build the full issue body AND the marker in one place, so the `contentHash`
 * is always computed over exactly the text that gets rendered — the hash
 * source and the rendered body can never desync.
 */
export function buildSignedIssueBody(input: BuildSignedIssueInput): {
  body: string;
  payload: IssueMarkerPayload;
} {
  const feedbackText = normalizeFeedback(input.feedbackText);
  const payload: IssueMarkerPayload = {
    v: ISSUE_MARKER_VERSION,
    feedbackId: input.feedbackId,
    tier: input.tier,
    issuedAt: input.issuedAt,
    repo: input.repo,
    contentHash: hashFeedbackContent(feedbackText),
  };
  const marker = signIssueMarker(payload, input.secret);
  const body = `${feedbackText}\n\n${marker}\n`;
  return { body, payload };
}

/**
 * Verify a marker embedded in an issue body. Returns the signed payload only
 * when EVERY check passes; any failure yields `{ ok:false, reason }` — the
 * caller (the Action) treats all failures identically as a neutral exit and
 * never reveals the reason to a prober. The `reason` exists for operator logs
 * and tests.
 *
 * Checks, in order (all fail-closed):
 *  1. marker present + well-formed
 *  2. supported version
 *  3. HMAC over the canonical payload matches (constant-time)
 *  4. `contentHash` matches the feedback text actually rendered in the body
 *  5. `repo` matches the expected repository
 *  6. `issuedAt` within the freshness window
 *  7. `tier` is a valid trust tier
 */
export function verifyIssueMarker(
  issueBody: string,
  secret: string,
  expectedRepo: string,
  options: VerifyMarkerOptions = {},
): VerifyMarkerResult {
  if (typeof issueBody !== 'string' || !issueBody.includes(MARKER_OPEN)) {
    return { ok: false, reason: 'absent' };
  }
  const match = MARKER_RE.exec(issueBody);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return { ok: false, reason: 'malformed' };
  }
  const [, encoded, givenSig] = match;

  let canonicalFromWire: string;
  let payload: IssueMarkerPayload;
  try {
    canonicalFromWire = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(canonicalFromWire) as unknown;
    if (!isMarkerPayloadShape(parsed)) {
      return { ok: false, reason: 'malformed' };
    }
    payload = parsed;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.v !== ISSUE_MARKER_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }

  // Re-canonicalize the PARSED payload (not the wire bytes) before signing, so
  // a wire encoding that merely reorders keys or adds whitespace cannot change
  // what is authenticated. The signature must cover the canonical form.
  const expectedSig = hmacHex(secret, canonicalJson(payload));
  if (!constantTimeHexEqual(expectedSig, givenSig)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Bind the hash to the ACTUAL rendered feedback section (everything before
  // the marker). Pasting the marker onto different text breaks this.
  const markerStart = issueBody.indexOf(MARKER_OPEN);
  const renderedFeedback = normalizeFeedback(issueBody.slice(0, markerStart));
  if (hashFeedbackContent(renderedFeedback) !== payload.contentHash) {
    return { ok: false, reason: 'content_mismatch' };
  }

  if (payload.repo !== expectedRepo) {
    return { ok: false, reason: 'repo_mismatch' };
  }

  if (!isFresh(payload.issuedAt, options)) {
    return { ok: false, reason: 'stale' };
  }

  if (!isTrustTier(payload.tier)) {
    return { ok: false, reason: 'bad_tier' };
  }

  return { ok: true, payload, feedbackText: renderedFeedback };
}

function isFresh(issuedAt: string, options: VerifyMarkerOptions): boolean {
  const issued = Date.parse(issuedAt);
  if (Number.isNaN(issued)) {
    return false;
  }
  const now = (options.now?.() ?? new Date()).getTime();
  const window = options.freshnessWindowMs ?? DEFAULT_MARKER_FRESHNESS_MS;
  const age = now - issued;
  // Reject markers older than the window (replay horizon) and markers dated
  // implausibly far in the future (clock games) — symmetric bound.
  return age <= window && age >= -window;
}

function isMarkerPayloadShape(value: unknown): value is IssueMarkerPayload {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.v === 'number' &&
    typeof v.feedbackId === 'string' &&
    typeof v.tier === 'string' &&
    typeof v.issuedAt === 'string' &&
    typeof v.repo === 'string' &&
    typeof v.contentHash === 'string'
  );
}
