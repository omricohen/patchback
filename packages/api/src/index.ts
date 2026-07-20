/**
 * @patchback/api — the orchestrator: Fastify routes, queue workers, and
 * server-side trust-tier enforcement.
 *
 * Local-first by default: the memory Store/TaskQueue drivers exported here
 * need zero services. The Postgres (drizzle) and Redis (bullmq) drivers live
 * behind subpath exports (`@patchback/api/drizzle`, `@patchback/api/bullmq`)
 * so importing this entry point never loads a database or queue client.
 */
export { buildServer } from './server.js';
export { createWorkers } from './workers/index.js';
export {
  ConfigError,
  resolvePipeline,
  validateConfig,
  type ApiConfig,
  type ApiKeyEntry,
} from './config.js';
export {
  resolveAuth,
  type AuthVia,
  type BrowserTokenVerifier,
  type RequestAuth,
} from './auth.js';
export {
  BROWSER_TOKEN_PREFIX,
  BROWSER_TOKEN_VERSION,
  DEFAULT_MAX_TOKEN_TTL_MS,
  DEFAULT_TOKEN_TTL_MS,
  mintBrowserToken,
  signBrowserToken,
  verifyBrowserToken,
  type BrowserTokenPayload,
  type BrowserTokenRejectReason,
  type MintableTier,
  type MintBrowserTokenInput,
  type VerifyBrowserTokenOptions,
  type VerifyBrowserTokenResult,
} from './browser-token.js';
export {
  API_ERROR_CODES,
  ApiError,
  StoreIntegrityError,
  type ApiErrorCode,
} from './errors.js';
export type { Store } from './store/store.js';
export { MemoryStore } from './store/memory.js';
export {
  maxAttemptsForTask,
  type Task,
  type TaskHandler,
  type TaskQueue,
} from './queue/queue.js';
export { MemoryQueue } from './queue/memory.js';
export {
  createDefaultPatchPipeline,
  patchBranchName,
  type DefaultPipelineOptions,
  type PatchPipeline,
  type PatchPipelineResult,
} from './pipeline.js';
export { verifyWebhookSignature } from './webhook-verify.js';
export {
  buildSignedIssueBody,
  canonicalJson,
  DEFAULT_MARKER_FRESHNESS_MS,
  hashFeedbackContent,
  ISSUE_MARKER_VERSION,
  signIssueMarker,
  verifyIssueMarker,
  type BuildSignedIssueInput,
  type IssueMarkerPayload,
  type MarkerRejectReason,
  type VerifyMarkerOptions,
  type VerifyMarkerResult,
} from './issue-marker.js';
export { generateId, generateReadToken, hashReadToken } from './ids.js';
export { constantTimeHexEqual, hmacHex } from './hmac.js';
export { minTrustTier, tierAtMost } from './trust.js';
export { runTriageTask } from './workers/triage-worker.js';
export { runPatchTask } from './workers/patch-worker.js';
export { DEFAULT_BRIEF_CONSTRAINTS } from './workers/patch-worker.js';
