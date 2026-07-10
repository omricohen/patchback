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
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { parseTriageResponse, TRIAGE_OUTPUT_SCHEMA } from './schema.js';
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
  /** Clock injection for deterministic `triagedAt` in tests. */
  now?: () => Date;
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

  const { text: user } = buildUserMessage(item);

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

  const parsed = parseTriageResponse(responseText);
  const gated = applyConfidenceThreshold(
    parsed,
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
