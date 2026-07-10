/**
 * Classify-down demotion ladder.
 *
 * Self-reported confidence is not calibrated probability. The threshold is a
 * policy knob validated end-to-end by the evals (which score post-demotion
 * results), not a statistical guarantee. There is deliberately NO promotion
 * mechanism and no "retry for a better label" — every uncertain path in this
 * package resolves DOWN.
 */
import type { ParsedTriage } from './schema.js';

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Deterministic clarifying question used when a demotion lands on
 * `needs_clarification` and the model supplied none.
 */
export const FALLBACK_CLARIFYING_QUESTION =
  'Could you describe exactly what you expected to see or happen, and where on the page?';

/**
 * Apply the one-step demotion ladder to the model's judgment:
 *
 * | model said            | confidence < threshold →                  |
 * |-----------------------|-------------------------------------------|
 * | patchable             | needs_clarification (+question fallback)  |
 * | needs_clarification   | needs_human (question dropped)            |
 * | needs_human           | needs_human (floor — never demoted)       |
 *
 * At-threshold results (`confidence === threshold`) are NOT demoted — the
 * comparison is strictly `<`. The returned `confidence` stays the model's
 * original number; the policy action is recorded in `reasoning` so the audit
 * trail shows both the model's judgment and what policy did with it.
 */
export function applyConfidenceThreshold(
  parsed: ParsedTriage,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): ParsedTriage {
  if (parsed.confidence >= threshold) {
    return parsed;
  }

  const note = (from: string): string =>
    ` [demoted from ${from}: confidence ${parsed.confidence} < ${threshold}]`;

  if (parsed.classification === 'patchable') {
    return {
      classification: 'needs_clarification',
      confidence: parsed.confidence,
      reasoning: parsed.reasoning + note('patchable'),
      clarifyingQuestion:
        parsed.clarifyingQuestion ?? FALLBACK_CLARIFYING_QUESTION,
    };
  }

  if (parsed.classification === 'needs_clarification') {
    return {
      classification: 'needs_human',
      confidence: parsed.confidence,
      reasoning: parsed.reasoning + note('needs_clarification'),
      // clarifyingQuestion deliberately dropped: the item now waits for a
      // human, not for the submitter.
    };
  }

  // needs_human is the floor.
  return parsed;
}
