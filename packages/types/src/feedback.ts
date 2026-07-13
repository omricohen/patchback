import type { CaptureContext } from './capture.js';
import type { TriageResult } from './triage.js';
import type { TrustTier } from './trust.js';

/** Who submitted the feedback. All fields optional — capture is opt-in. */
export interface Submitter {
  /** Stable identifier supplied by the embedding app, if any. */
  id?: string;
  name?: string;
  email?: string;
}

/**
 * A single piece of user feedback, from submission through triage.
 *
 * The trust tier travels with the item and is authoritative: `outsider`
 * items are data only and must never reach an agent as instructions.
 */
export interface FeedbackItem {
  id: string;
  /** The user's message, verbatim (post-masking). */
  message: string;
  trustTier: TrustTier;
  submitter?: Submitter;
  /** Widget-captured context. Absent when capture is disabled. */
  capture?: CaptureContext;
  /** Set once triage has run. */
  triage?: TriageResult;
  /**
   * Clarification threading (see the reply model in the API): a reply is a
   * NEW item linked to its thread — the canonical job state machine is never
   * resurrected. `threadId` is the ROOT item's id, set on every member of the
   * thread except the root itself. Root items have neither field.
   */
  threadId?: string;
  /** The id of the item this one replies to (immediate parent). */
  inReplyTo?: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}
