import { describe, expect, it } from 'vitest';

import { DEFAULT_TRIAGE_MODEL, toTriageModelError } from './anthropic.js';
import { TriageModelError } from './model.js';

describe('DEFAULT_TRIAGE_MODEL', () => {
  it('pins the default model id', () => {
    expect(DEFAULT_TRIAGE_MODEL).toBe('claude-opus-4-8');
  });
});

describe('toTriageModelError', () => {
  it('passes through an existing TriageModelError unchanged', () => {
    const original = new TriageModelError('already mapped');
    expect(toTriageModelError(original)).toBe(original);
  });

  it('maps status-bearing API errors with the HTTP status in the message', () => {
    const apiError = Object.assign(new Error('Overloaded'), { status: 529 });
    const mapped = toTriageModelError(apiError);
    expect(mapped).toBeInstanceOf(TriageModelError);
    expect(mapped.message).toContain('HTTP 529');
    expect(mapped.message).toContain('Overloaded');
    expect(mapped.cause).toBe(apiError);
  });

  it('maps plain connection errors without a status', () => {
    const connectionError = new Error('Connection error.');
    const mapped = toTriageModelError(connectionError);
    expect(mapped).toBeInstanceOf(TriageModelError);
    expect(mapped.message).not.toContain('HTTP');
    expect(mapped.cause).toBe(connectionError);
  });

  it('maps non-Error throwables', () => {
    const mapped = toTriageModelError('string failure');
    expect(mapped).toBeInstanceOf(TriageModelError);
    expect(mapped.message).toContain('string failure');
  });
});
