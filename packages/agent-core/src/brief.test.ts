import { describe, expect, it } from 'vitest';

import {
  assertBriefSourceAllowed,
  BriefSourceNotAllowedError,
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
