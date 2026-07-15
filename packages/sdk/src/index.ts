/**
 * @patchback/sdk — zero-dependency typed client for the Patchback API.
 *
 * - Injectable fetch (defaults to the global); works in browsers and
 *   Node 20+.
 * - Stores nothing: no localStorage, no module state, no token cache.
 *   Read-token custody is the caller's concern (the widget's, in practice).
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
