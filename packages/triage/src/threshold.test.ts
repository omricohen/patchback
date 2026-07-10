import { describe, expect, it } from 'vitest';

import type { ParsedTriage } from './schema.js';
import {
  applyConfidenceThreshold,
  DEFAULT_CONFIDENCE_THRESHOLD,
  FALLBACK_CLARIFYING_QUESTION,
} from './threshold.js';

function parsed(overrides: Partial<ParsedTriage>): ParsedTriage {
  return {
    classification: 'patchable',
    confidence: 0.9,
    reasoning: 'model reasoning',
    ...overrides,
  };
}

describe('applyConfidenceThreshold', () => {
  it('defaults to 0.7', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  it('leaves confident results untouched', () => {
    const input = parsed({ classification: 'patchable', confidence: 0.95 });
    expect(applyConfidenceThreshold(input)).toEqual(input);
  });

  it('demotes below-threshold patchable to needs_clarification with the fallback question', () => {
    const result = applyConfidenceThreshold(
      parsed({ classification: 'patchable', confidence: 0.69 }),
    );
    expect(result.classification).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe(FALLBACK_CLARIFYING_QUESTION);
    expect(result.confidence).toBe(0.69); // model's original number preserved
    expect(result.reasoning).toContain('[demoted from patchable');
  });

  it('preserves the model-provided clarifying question when demoting patchable', () => {
    const result = applyConfidenceThreshold(
      parsed({
        classification: 'patchable',
        confidence: 0.5,
        clarifyingQuestion: 'Which button do you mean?',
      }),
    );
    expect(result.classification).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe('Which button do you mean?');
  });

  it('demotes below-threshold needs_clarification to needs_human and drops the question', () => {
    const result = applyConfidenceThreshold(
      parsed({
        classification: 'needs_clarification',
        confidence: 0.4,
        clarifyingQuestion: 'What color?',
      }),
    );
    expect(result.classification).toBe('needs_human');
    expect(result.clarifyingQuestion).toBeUndefined();
    expect(result.reasoning).toContain('[demoted from needs_clarification');
  });

  it('never demotes needs_human (the floor), even at confidence 0.1', () => {
    const input = parsed({ classification: 'needs_human', confidence: 0.1 });
    const result = applyConfidenceThreshold(input);
    expect(result).toEqual(input);
  });

  it('does NOT demote at exactly the threshold (strict <)', () => {
    const input = parsed({ classification: 'patchable', confidence: 0.7 });
    expect(applyConfidenceThreshold(input).classification).toBe('patchable');
  });

  it('respects a custom threshold', () => {
    const input = parsed({ classification: 'patchable', confidence: 0.8 });
    expect(applyConfidenceThreshold(input, 0.9).classification).toBe(
      'needs_clarification',
    );
    expect(applyConfidenceThreshold(input, 0.5).classification).toBe(
      'patchable',
    );
  });

  it('demotes one rung only (patchable at low confidence does not skip to needs_human)', () => {
    const result = applyConfidenceThreshold(
      parsed({ classification: 'patchable', confidence: 0.05 }),
    );
    expect(result.classification).toBe('needs_clarification');
  });
});
