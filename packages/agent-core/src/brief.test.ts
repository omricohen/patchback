import type { FeedbackItem, TriageResult } from '@patchback/types';
import { describe, expect, it } from 'vitest';

import {
  assertBriefSourceAllowed,
  BriefNotPatchableError,
  BriefSourceNotAllowedError,
  createBriefFromTriagedFeedback,
  type GuardedTaskBrief,
  type TaskBrief,
} from './brief.js';

describe('assertBriefSourceAllowed (trust boundary)', () => {
  it('allows owner feedback to become a brief', () => {
    expect(() => assertBriefSourceAllowed('owner')).not.toThrow();
  });

  it('allows insider feedback to become a brief', () => {
    expect(() => assertBriefSourceAllowed('insider')).not.toThrow();
  });

  it('rejects outsider feedback — outsider content is data, never instructions', () => {
    expect(() => assertBriefSourceAllowed('outsider')).toThrow(
      BriefSourceNotAllowedError,
    );
  });

  it('names the offending tier in the error', () => {
    try {
      assertBriefSourceAllowed('outsider');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BriefSourceNotAllowedError);
      expect((error as BriefSourceNotAllowedError).tier).toBe('outsider');
      expect((error as Error).message).toMatch(/data only/i);
    }
  });
});

const briefFields: Omit<TaskBrief, 'feedbackId'> = {
  title: 'Change button label "Save" to "Submit"',
  description: 'The primary button should read "Submit".',
  constraints: ['Only change the label text.'],
  fileHints: ['src/button.js'],
  acceptanceCriteria: ['The button label is "Submit".'],
};

function feedback(
  overrides: Partial<FeedbackItem> = {},
  triage?: Partial<TriageResult> | null,
): FeedbackItem {
  return {
    id: 'fb-42',
    message: 'The button says "Save" but should say "Submit".',
    trustTier: 'insider',
    ...(triage === null
      ? {}
      : {
          triage: {
            classification: 'patchable',
            confidence: 0.95,
            ...triage,
          },
        }),
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('createBriefFromTriagedFeedback (structural trust-boundary guard)', () => {
  it('produces a stamped brief for insider + patchable feedback', () => {
    const brief = createBriefFromTriagedFeedback(feedback(), briefFields);
    expect(brief.feedbackId).toBe('fb-42');
    expect(brief.sourceTier).toBe('insider');
    expect(brief.title).toBe(briefFields.title);
    expect(brief.constraints).toEqual(briefFields.constraints);
  });

  it('produces a stamped brief for owner + patchable feedback', () => {
    const brief = createBriefFromTriagedFeedback(
      feedback({ trustTier: 'owner' }),
      briefFields,
    );
    expect(brief.sourceTier).toBe('owner');
  });

  it('throws BriefSourceNotAllowedError for outsider feedback, even when classified patchable', () => {
    expect(() =>
      createBriefFromTriagedFeedback(
        feedback({ trustTier: 'outsider' }),
        briefFields,
      ),
    ).toThrow(BriefSourceNotAllowedError);
  });

  it('throws BriefNotPatchableError for untriaged feedback', () => {
    expect(() =>
      createBriefFromTriagedFeedback(feedback({}, null), briefFields),
    ).toThrow(BriefNotPatchableError);
  });

  it('throws BriefNotPatchableError for needs_clarification feedback', () => {
    try {
      createBriefFromTriagedFeedback(
        feedback({}, { classification: 'needs_clarification' }),
        briefFields,
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BriefNotPatchableError);
      expect((error as BriefNotPatchableError).classification).toBe(
        'needs_clarification',
      );
    }
  });

  it('throws BriefNotPatchableError for needs_human feedback', () => {
    expect(() =>
      createBriefFromTriagedFeedback(
        feedback({}, { classification: 'needs_human' }),
        briefFields,
      ),
    ).toThrow(BriefNotPatchableError);
  });

  it('checks the tier BEFORE the classification (trust boundary first)', () => {
    // Outsider + not-patchable must surface as the tier violation.
    expect(() =>
      createBriefFromTriagedFeedback(
        feedback({ trustTier: 'outsider' }, { classification: 'needs_human' }),
        briefFields,
      ),
    ).toThrow(BriefSourceNotAllowedError);
  });

  it('cannot be object-literal-constructed (brand is a unique symbol)', () => {
    // @ts-expect-error — GuardedTaskBrief is branded; literals lack the symbol.
    const forged: GuardedTaskBrief = {
      ...briefFields,
      feedbackId: 'fb-42',
      sourceTier: 'insider' as const,
    };
    // Runtime keeps the forged object plain; only the factory brands briefs.
    expect(forged.sourceTier).toBe('insider');
  });
});
