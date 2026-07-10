import { describe, expect, it } from 'vitest';

import { parseTriageResponse, TRIAGE_OUTPUT_SCHEMA } from './schema.js';

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe('TRIAGE_OUTPUT_SCHEMA', () => {
  it('requires classification, confidence, and reasoning and forbids extras', () => {
    expect(TRIAGE_OUTPUT_SCHEMA.required).toEqual([
      'classification',
      'confidence',
      'reasoning',
    ]);
    expect(TRIAGE_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('parseTriageResponse', () => {
  it('parses a valid response for each classification', () => {
    for (const classification of [
      'patchable',
      'needs_clarification',
      'needs_human',
    ]) {
      const parsed = parseTriageResponse(
        json({ classification, confidence: 0.9, reasoning: 'clear case' }),
      );
      expect(parsed.classification).toBe(classification);
      expect(parsed.confidence).toBe(0.9);
      expect(parsed.reasoning).toBe('clear case');
    }
  });

  it('keeps a non-empty clarifying question', () => {
    const parsed = parseTriageResponse(
      json({
        classification: 'needs_clarification',
        confidence: 0.8,
        reasoning: 'vague',
        clarifyingQuestion: 'What did you expect to see?',
      }),
    );
    expect(parsed.clarifyingQuestion).toBe('What did you expect to see?');
  });

  it('drops an empty/whitespace clarifying question', () => {
    const parsed = parseTriageResponse(
      json({
        classification: 'needs_clarification',
        confidence: 0.8,
        reasoning: 'vague',
        clarifyingQuestion: '   ',
      }),
    );
    expect(parsed.clarifyingQuestion).toBeUndefined();
  });

  it('failsafes to needs_human/0 on non-JSON garbage', () => {
    const parsed = parseTriageResponse('definitely not json {');
    expect(parsed.classification).toBe('needs_human');
    expect(parsed.confidence).toBe(0);
    expect(parsed.reasoning).toMatch(/classifier fault/i);
  });

  it('failsafes on non-object payloads (arrays, strings, null)', () => {
    for (const payload of ['[]', '"patchable"', 'null', '42']) {
      const parsed = parseTriageResponse(payload);
      expect(parsed.classification).toBe('needs_human');
      expect(parsed.confidence).toBe(0);
    }
  });

  it('failsafes on an unknown classification enum — never toward patchable', () => {
    const parsed = parseTriageResponse(
      json({ classification: 'auto_merge', confidence: 1, reasoning: 'x' }),
    );
    expect(parsed.classification).toBe('needs_human');
    expect(parsed.confidence).toBe(0);
  });

  it('failsafes on a missing classification', () => {
    const parsed = parseTriageResponse(
      json({ confidence: 0.9, reasoning: 'x' }),
    );
    expect(parsed.classification).toBe('needs_human');
  });

  it('treats missing confidence as 0', () => {
    const parsed = parseTriageResponse(
      json({ classification: 'patchable', reasoning: 'x' }),
    );
    expect(parsed.confidence).toBe(0);
  });

  it('treats non-finite confidence as 0', () => {
    const parsed = parseTriageResponse(
      '{"classification":"patchable","confidence":null,"reasoning":"x"}',
    );
    expect(parsed.confidence).toBe(0);
  });

  it('clamps confidence into [0, 1]', () => {
    expect(
      parseTriageResponse(
        json({ classification: 'patchable', confidence: -1, reasoning: 'x' }),
      ).confidence,
    ).toBe(0);
    expect(
      parseTriageResponse(
        json({ classification: 'patchable', confidence: 3, reasoning: 'x' }),
      ).confidence,
    ).toBe(1);
  });

  it('substitutes a note when reasoning is missing or empty', () => {
    const parsed = parseTriageResponse(
      json({ classification: 'patchable', confidence: 0.9, reasoning: '' }),
    );
    expect(parsed.reasoning.length).toBeGreaterThan(0);
  });

  it('ignores extra keys instead of failing', () => {
    const parsed = parseTriageResponse(
      json({
        classification: 'patchable',
        confidence: 0.9,
        reasoning: 'x',
        surprise: 'ignored',
      }),
    );
    expect(parsed.classification).toBe('patchable');
  });
});
