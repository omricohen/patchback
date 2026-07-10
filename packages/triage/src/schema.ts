/**
 * Output schema for the classification call + response validation.
 *
 * Never trust even structured output: every field is re-validated in code,
 * and ANY validation failure resolves to the failsafe — `needs_human` with
 * confidence 0. A classifier fault must never drift toward `patchable`.
 */
import { isTriageClassification } from '@patchback/types';
import type { TriageClassification } from '@patchback/types';

/**
 * JSON schema for the model's structured output. Numeric min/max constraints
 * are unsupported in structured outputs, so confidence is clamped client-side
 * (see {@link parseTriageResponse}).
 */
export const TRIAGE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    classification: {
      type: 'string',
      enum: ['patchable', 'needs_clarification', 'needs_human'],
    },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
    clarifyingQuestion: { type: 'string' },
  },
  required: ['classification', 'confidence', 'reasoning'],
  additionalProperties: false,
};

/** The model's validated (or failsafe) judgment, before threshold demotion. */
export interface ParsedTriage {
  classification: TriageClassification;
  /** Clamped to [0, 1]; non-finite or missing → 0. */
  confidence: number;
  reasoning: string;
  clarifyingQuestion?: string;
}

/** Failsafe result used when the model's output cannot be trusted. */
export function failsafeParse(fault: string): ParsedTriage {
  return {
    classification: 'needs_human',
    confidence: 0,
    reasoning: `Classifier fault (${fault}); failing safe to needs_human.`,
  };
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Parse and validate the raw model output. Returns the failsafe (`needs_human`,
 * confidence 0) on unparseable JSON, a non-object payload, an unknown
 * classification enum, or any other shape fault. Never throws.
 */
export function parseTriageResponse(text: string): ParsedTriage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return failsafeParse('unparseable model output');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return failsafeParse('model output is not an object');
  }

  const record = raw as Record<string, unknown>;
  if (!isTriageClassification(record.classification)) {
    return failsafeParse('unknown classification value');
  }

  const parsed: ParsedTriage = {
    classification: record.classification,
    confidence: clampConfidence(record.confidence),
    reasoning:
      typeof record.reasoning === 'string' && record.reasoning.length > 0
        ? record.reasoning
        : 'No reasoning provided by classifier.',
  };

  if (
    typeof record.clarifyingQuestion === 'string' &&
    record.clarifyingQuestion.trim().length > 0
  ) {
    parsed.clarifyingQuestion = record.clarifyingQuestion;
  }

  return parsed;
}
