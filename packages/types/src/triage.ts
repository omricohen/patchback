/**
 * Triage before code: every feedback item is classified before anything else
 * happens. Only `patchable` items may start a patch job. When uncertain,
 * classify DOWN (prefer `needs_clarification` over `patchable`).
 */
export const TRIAGE_CLASSIFICATIONS = [
  'patchable',
  'needs_clarification',
  'needs_human',
] as const;

export type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number];

export function isTriageClassification(
  value: unknown,
): value is TriageClassification {
  return (
    typeof value === 'string' &&
    (TRIAGE_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

export interface TriageResult {
  classification: TriageClassification;
  /** Classifier confidence in [0, 1]. Below-threshold results classify down. */
  confidence: number;
  /** Short model-produced rationale, for the audit trail. */
  reasoning?: string;
  /** Present when classification is `needs_clarification`. */
  clarifyingQuestion?: string;
  /** ISO 8601 timestamp of when triage ran. */
  triagedAt?: string;
}
