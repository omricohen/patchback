/**
 * @patchback/triage — feedback triage classifier.
 *
 * Triage before code: every feedback item is classified `patchable` |
 * `needs_clarification` | `needs_human` before anything else happens. One
 * model call per item, classify DOWN when uncertain, and a hard outsider
 * short-circuit (outsider feedback never reaches the model).
 */
export {
  TriageModelError,
  type ModelCaller,
  type ModelRequest,
  type ModelResponse,
} from './model.js';
export {
  createAnthropicModelCaller,
  DEFAULT_TRIAGE_MODEL,
  type AnthropicModelCallerOptions,
} from './anthropic.js';
export { triageFeedback, type TriageOptions } from './classifier.js';
export {
  DEFAULT_CONFIDENCE_THRESHOLD,
  FALLBACK_CLARIFYING_QUESTION,
} from './threshold.js';
export { SYSTEM_PROMPT, type ThreadContext } from './prompt.js';
export { TRIAGE_OUTPUT_SCHEMA } from './schema.js';
export {
  type RepoProbe,
  type ProbeResult,
  type ProbeMatchFile,
} from './probe.js';
export {
  DEFAULT_RETRIEVAL_BAND,
  DEFAULT_MAX_UNAMBIGUOUS_MATCHES,
  MAX_QUERIES,
  isBorderline,
  deriveProbeQueries,
  reconcile,
  isUnambiguous,
  renderProbeEvidence,
  rung,
} from './retrieval.js';
export { RETRIEVAL_SYSTEM_PROMPT } from './prompt.js';
