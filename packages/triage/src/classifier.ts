/**
 * The triage classifier: one model call, classify-down policy, hard outsider
 * short-circuit.
 *
 * `triageFeedback` is a pure classification function — it starts no jobs and
 * constructs no briefs. Only the orchestrator may act on `patchable`, and only
 * through `createBriefFromTriagedFeedback` in @patchback/agent-core, which
 * re-checks tier + classification.
 */
import type { FeedbackItem, TriageResult } from '@patchback/types';

import { TriageModelError, type ModelCaller } from './model.js';
import type { RepoProbe } from './probe.js';
import {
  buildRetrievalUserMessage,
  buildUserMessage,
  RETRIEVAL_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  type ThreadContext,
} from './prompt.js';
import {
  deriveProbeQueries,
  DEFAULT_MAX_UNAMBIGUOUS_MATCHES,
  DEFAULT_RETRIEVAL_BAND,
  isBorderline,
  reconcile,
} from './retrieval.js';
import {
  parseTriageResponse,
  TRIAGE_OUTPUT_SCHEMA,
  type ParsedTriage,
} from './schema.js';
import {
  applyConfidenceThreshold,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from './threshold.js';

/** Room for adaptive thinking plus the small JSON object. */
const MAX_TOKENS = 4096;

export interface TriageOptions {
  /**
   * The model-call seam — required, so this core never reads env vars or
   * constructs vendor clients. The call site that owns config (CLI/API in
   * later phases) supplies `createAnthropicModelCaller()` or a substitute.
   */
  callModel: ModelCaller;
  /** Demotion gate, default 0.7. Applied per rung — see threshold.ts. */
  confidenceThreshold?: number;
  /**
   * Clarification-thread context when the item is a reply. All of it is
   * untrusted submitter-derived content and is DATA-block-wrapped in the
   * prompt — see {@link ThreadContext}.
   */
  thread?: ThreadContext;
  /** Clock injection for deterministic `triagedAt` in tests. */
  now?: () => Date;
  /**
   * OPTIONAL retrieval probe over a repo working copy. When present AND the
   * stage-1 result is borderline, a deterministic fixed-string probe runs
   * between two model calls and its paths+counts feed a second, reconciled
   * classification (see {@link reconcile}). Absent ⇒ stage 2 never runs and the
   * result is byte-identical to the single-call path. The probe is only wired
   * where a real on-disk working copy exists (CLI `localRepoPath`, evals);
   * the hosted API never sets it, so stage 2 is fail-safe dead code there.
   */
  repoProbe?: RepoProbe;
  /**
   * Half-width of the confidence band (around the threshold) within which
   * `patchable`/`needs_human` items become probe-eligible. Default
   * {@link DEFAULT_RETRIEVAL_BAND} (0.15). `needs_clarification` is always
   * eligible regardless of this band.
   */
  retrievalBand?: number;
  /**
   * Max total matches (in the single matched file) for probe evidence to count
   * as "unambiguous" and permit a one-rung up-move. Default
   * {@link DEFAULT_MAX_UNAMBIGUOUS_MATCHES} (5).
   */
  maxUnambiguousMatches?: number;
}

/**
 * Classify one feedback item.
 *
 * Trust boundary — outsider short-circuit: `outsider` feedback is data only.
 * It is NEVER sent to the model (its content must not even transit the triage
 * prompt toward a patch decision, and each hostile submission would otherwise
 * cost a model call). The result is a deterministic `needs_human`. This is
 * defense-in-depth, not a replacement for server-side tier enforcement.
 *
 * Transport errors from the model caller are thrown as {@link TriageModelError}
 * (the caller owns retry policy); they never resolve to a classification.
 * Malformed model OUTPUT, by contrast, resolves to the failsafe
 * `needs_human` / confidence 0 — never toward `patchable`.
 */
export async function triageFeedback(
  item: FeedbackItem,
  options: TriageOptions,
): Promise<TriageResult> {
  const now = options.now ?? (() => new Date());
  const triagedAt = (): string => now().toISOString();

  if (item.trustTier === 'outsider') {
    return {
      classification: 'needs_human',
      confidence: 1,
      reasoning:
        'outsider tier: data only — never triaged toward a patch job (no model call made)',
      triagedAt: triagedAt(),
    };
  }

  const { text: user } = buildUserMessage(item, options.thread);

  let responseText: string;
  try {
    const response = await options.callModel({
      system: SYSTEM_PROMPT,
      user,
      outputSchema: TRIAGE_OUTPUT_SCHEMA,
      maxTokens: MAX_TOKENS,
    });
    responseText = response.text;
  } catch (error) {
    if (error instanceof TriageModelError) {
      throw error;
    }
    throw new TriageModelError(
      `model call failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const stage1 = parseTriageResponse(responseText);
  const reconciled = await runRetrievalStage(item, options, stage1);
  const gated = applyConfidenceThreshold(
    reconciled,
    options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
  );

  return {
    classification: gated.classification,
    confidence: gated.confidence,
    reasoning: gated.reasoning,
    ...(gated.clarifyingQuestion
      ? { clarifyingQuestion: gated.clarifyingQuestion }
      : {}),
    triagedAt: triagedAt(),
  };
}

/**
 * The OPTIONAL retrieval second stage. Runs ONLY when a `repoProbe` is injected
 * and the stage-1 result is borderline. Returns the reconciled `ParsedTriage`
 * (before the final demotion ladder, which the caller still applies).
 *
 * Fail-safe by construction: absent probe, non-borderline result, or no usable
 * queries ⇒ stage1 returned unchanged. A failure of the probe OR of the SECOND
 * model call is swallowed and resolves to stage1 — retrieval is an enhancement
 * and must never introduce a new failure mode or discard the first-pass
 * verdict. (The FIRST call's transport failure still throws, upstream.)
 */
async function runRetrievalStage(
  item: FeedbackItem,
  options: TriageOptions,
  stage1: ParsedTriage,
): Promise<ParsedTriage> {
  const probe = options.repoProbe;
  if (probe === undefined) {
    return stage1;
  }
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const band = options.retrievalBand ?? DEFAULT_RETRIEVAL_BAND;
  if (!isBorderline(stage1, threshold, band)) {
    return stage1;
  }
  const queries = deriveProbeQueries(item.message, item.capture?.element);
  if (queries.length === 0) {
    return stage1;
  }

  try {
    const probeResult = await probe.search(queries);
    const { text: user } = buildRetrievalUserMessage(
      item,
      options.thread,
      probeResult,
      stage1,
    );
    const response = await options.callModel({
      system: RETRIEVAL_SYSTEM_PROMPT,
      user,
      outputSchema: TRIAGE_OUTPUT_SCHEMA,
      maxTokens: MAX_TOKENS,
    });
    const stage2 = parseTriageResponse(response.text);
    return reconcile(stage1, stage2, probeResult, {
      maxUnambiguousMatches:
        options.maxUnambiguousMatches ?? DEFAULT_MAX_UNAMBIGUOUS_MATCHES,
    });
  } catch {
    // Probe fault or second-call transport failure: retrieval is optional, so
    // fall back to the already-safe first-pass verdict rather than fail.
    return stage1;
  }
}
