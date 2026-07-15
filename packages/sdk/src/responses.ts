/**
 * Response DTO types, composed from `@patchback/types` primitives.
 *
 * These live in the SDK (the API package does not export DTO types); the
 * anti-drift mechanism is the contract test suite, which runs every method
 * against the real `buildServer` — if a route shape changes, the SDK goes
 * red.
 */
import type {
  CaptureContext,
  JobState,
  JobStateChange,
  Submitter,
  TriageResult,
  TrustTier,
} from '@patchback/types';

/** `201` body of POST /feedback and POST /feedback/:id/reply. */
export interface SubmitResponse {
  id: string;
  jobId: string;
  /**
   * Per-item read capability. Returned ONCE — the server stores only a hash.
   * The SDK never stores it; custody is the caller's concern.
   */
  readToken: string;
}

/** One reply entry in a feedback thread. */
export interface FeedbackReply {
  id: string;
  message: string;
  triage?: TriageResult;
  inReplyTo?: string;
  jobId?: string;
  state?: JobState;
  createdAt: string;
}

/** `200` body of GET /feedback/:id. */
export interface FeedbackThreadResponse {
  id: string;
  message: string;
  trustTier: TrustTier;
  submitter?: Submitter;
  capture?: CaptureContext;
  triage?: TriageResult;
  threadId?: string;
  inReplyTo?: string;
  job?: { id: string; state: JobState };
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt: string;
}

/** `200` body of GET /jobs/:id/status. `state` is the exact canonical JobState. */
export interface JobStatusResponse {
  id: string;
  feedbackId: string;
  state: JobState;
  history: JobStateChange[];
  issueNumber?: number;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
}

/** `202` body of POST /jobs/:id/start. */
export interface StartJobResponse {
  id: string;
  state: JobState;
  issueNumber: number;
  issueUrl: string;
}
