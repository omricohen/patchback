/**
 * @patchback/sdk — zero-dependency typed client for the Patchback API.
 *
 * - Injectable fetch (defaults to the global); works in browsers and
 *   Node 20+.
 * - No persistent storage: no localStorage. Read-token custody is the
 *   caller's concern (the widget's, in practice). When a `getToken` provider
 *   is configured, the client caches the current short-lived token in memory
 *   and refreshes it before expiry — it never persists it.
 * - The trust boundary lives server-side; this client cannot represent a
 *   `trustTier` in any request body.
 */
export {
  createPatchbackClient,
  type FetchLike,
  type PatchbackClient,
  type PatchbackClientOptions,
  type ReadAuth,
  type SubmitFeedbackInput,
  type TokenGrant,
  type TokenProvider,
} from './client.js';
export { PatchbackApiError } from './errors.js';
export { pollJobStatus, type PollJobStatusOptions } from './poll.js';
export type {
  FeedbackReply,
  FeedbackThreadResponse,
  JobStatusResponse,
  StartJobResponse,
  SubmitResponse,
} from './responses.js';
