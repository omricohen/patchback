import type { FeedbackItem } from '@patchback/types';
import { describe, expect, it } from 'vitest';

import { triageFeedback, type TriageOptions } from './classifier.js';
import { TriageModelError, type ModelCaller, type ModelRequest } from './model.js';
import type { ProbeResult, RepoProbe } from './probe.js';
import { RETRIEVAL_SYSTEM_PROMPT } from './prompt.js';

function item(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'fb-1',
    message: `The header shows 'Ammount Due' — should read 'Amount Due'.`,
    trustTier: 'insider',
    capture: { element: { domPath: 'h2', text: 'Ammount Due' } },
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A ModelCaller that returns one JSON for the FIRST (SYSTEM_PROMPT) call and
 * another for the retrieval (RETRIEVAL_SYSTEM_PROMPT) call, recording each
 * request so tests can assert invocation counts.
 */
function scriptedCaller(
  stage1: unknown,
  stage2: unknown,
  opts: { failStage2?: boolean } = {},
): { callModel: ModelCaller; requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const callModel: ModelCaller = (request) => {
    requests.push(request);
    const isRetrieval = request.system === RETRIEVAL_SYSTEM_PROMPT;
    if (isRetrieval && opts.failStage2) {
      return Promise.reject(new TriageModelError('stage2 boom'));
    }
    const body = isRetrieval ? stage2 : stage1;
    return Promise.resolve({ text: JSON.stringify(body) });
  };
  return { callModel, requests };
}

/** A probe that records how many times it was invoked and returns a fixed result. */
function spyProbe(result: ProbeResult): { probe: RepoProbe; calls: number[] } {
  const calls: number[] = [];
  const probe: RepoProbe = {
    search: (queries) => {
      calls.push(queries.length);
      return Promise.resolve(result);
    },
  };
  return { probe, calls };
}

function unambiguous(path = 'src/Header.tsx'): ProbeResult {
  return {
    perQuery: [{ query: 'q', files: [{ path, count: 1 }] }],
    distinctFiles: [path],
    totalMatches: 1,
    truncated: false,
  };
}

const base = (extra: Partial<TriageOptions>): TriageOptions => ({
  callModel: extra.callModel!,
  ...extra,
});

describe('stage 2 — outsider never probes (trust boundary)', () => {
  it('runs zero probe invocations and zero model calls for an outsider', async () => {
    const { callModel, requests } = scriptedCaller(
      { classification: 'patchable', confidence: 0.9, reasoning: 'x' },
      { classification: 'patchable', confidence: 0.9, reasoning: 'x' },
    );
    const { probe, calls } = spyProbe(unambiguous());
    const result = await triageFeedback(
      item({ trustTier: 'outsider' }),
      base({ callModel, repoProbe: probe }),
    );
    expect(calls).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect(result.classification).toBe('needs_human');
  });
});

describe('stage 2 — band gating', () => {
  it('does NOT probe a confidently-patchable item above the band', async () => {
    const { callModel, requests } = scriptedCaller(
      { classification: 'patchable', confidence: 0.95, reasoning: 'clear typo' },
      { classification: 'needs_human', confidence: 0.9, reasoning: 'should not run' },
    );
    const { probe, calls } = spyProbe(unambiguous());
    const result = await triageFeedback(item(), base({ callModel, repoProbe: probe }));
    expect(calls).toHaveLength(0);
    expect(requests).toHaveLength(1); // only the first call
    expect(result.classification).toBe('patchable');
  });

  it('does NOT probe a confidently-needs_human item above the band', async () => {
    const { callModel, requests } = scriptedCaller(
      { classification: 'needs_human', confidence: 0.99, reasoning: 'feature request' },
      { classification: 'patchable', confidence: 0.9, reasoning: 'should not run' },
    );
    const { probe, calls } = spyProbe(unambiguous());
    const result = await triageFeedback(item(), base({ callModel, repoProbe: probe }));
    expect(calls).toHaveLength(0);
    expect(requests).toHaveLength(1);
    expect(result.classification).toBe('needs_human');
  });

  it('does NOT probe when no usable queries can be derived', async () => {
    const { callModel, requests } = scriptedCaller(
      { classification: 'needs_clarification', confidence: 0.8, reasoning: 'vague', clarifyingQuestion: 'which?' },
      { classification: 'patchable', confidence: 0.9, reasoning: 'nope' },
    );
    const { probe, calls } = spyProbe(unambiguous());
    // No quotes, no element ⇒ deriveProbeQueries returns [].
    const result = await triageFeedback(
      item({ message: 'something is off here', capture: undefined }),
      base({ callModel, repoProbe: probe }),
    );
    expect(calls).toHaveLength(0);
    expect(requests).toHaveLength(1);
    expect(result.classification).toBe('needs_clarification');
  });
});

describe('stage 2 — reconciliation through the full pipeline', () => {
  it('raises a borderline needs_clarification to patchable on an unambiguous match', async () => {
    const { callModel, requests } = scriptedCaller(
      { classification: 'needs_clarification', confidence: 0.6, reasoning: 'maybe a typo', clarifyingQuestion: 'which label?' },
      { classification: 'patchable', confidence: 0.9, reasoning: 'single-file string' },
    );
    const { probe, calls } = spyProbe(unambiguous());
    const result = await triageFeedback(item(), base({ callModel, repoProbe: probe }));
    expect(calls).toEqual([expect.any(Number)]); // probed once
    expect(requests).toHaveLength(2); // both model calls
    expect(result.classification).toBe('patchable');
  });

  it('raises a borderline needs_human at most to needs_clarification, NEVER patchable', async () => {
    const { callModel } = scriptedCaller(
      { classification: 'needs_human', confidence: 0.7, reasoning: 'unsure' },
      { classification: 'patchable', confidence: 0.99, reasoning: 'model tried to jump two rungs' },
    );
    const { probe } = spyProbe(unambiguous());
    const result = await triageFeedback(item(), base({ callModel, repoProbe: probe }));
    // Two-rung jump is clamped back to stage1 needs_human.
    expect(result.classification).toBe('needs_human');
  });

  it('raised patchable must still clear the 0.7 gate on stage2 confidence', async () => {
    const { callModel } = scriptedCaller(
      { classification: 'needs_clarification', confidence: 0.6, reasoning: 'maybe', clarifyingQuestion: 'q?' },
      { classification: 'patchable', confidence: 0.6, reasoning: 'raised label but low confidence' },
    );
    const { probe } = spyProbe(unambiguous());
    const result = await triageFeedback(item(), base({ callModel, repoProbe: probe }));
    // reconcile raises to patchable@0.6, then the demotion ladder sends it back.
    expect(result.classification).toBe('needs_clarification');
  });
});

describe('stage 2 — failure isolation', () => {
  it('falls back to stage1 when the SECOND model call fails', async () => {
    const { callModel } = scriptedCaller(
      { classification: 'needs_clarification', confidence: 0.8, reasoning: 'stage1 holds', clarifyingQuestion: 'q?' },
      { classification: 'patchable', confidence: 0.9, reasoning: 'never reached' },
      { failStage2: true },
    );
    const { probe } = spyProbe(unambiguous());
    const result = await triageFeedback(item(), base({ callModel, repoProbe: probe }));
    expect(result.classification).toBe('needs_clarification');
  });
});

describe('stage 2 — absent probe is byte-identical to the single-call path', () => {
  it('produces the same result with and without an (unused) probe wiring', async () => {
    const stage1 = { classification: 'patchable', confidence: 0.95, reasoning: 'clear' };
    const withoutProbe = scriptedCaller(stage1, stage1);
    const noProbe = await triageFeedback(
      item(),
      base({ callModel: withoutProbe.callModel, now: () => new Date('2026-07-10T12:00:00Z') }),
    );
    // Confident patchable never probes, so wiring a probe changes nothing.
    const withProbeCaller = scriptedCaller(stage1, stage1);
    const { probe } = spyProbe(unambiguous());
    const withProbe = await triageFeedback(
      item(),
      base({ callModel: withProbeCaller.callModel, repoProbe: probe, now: () => new Date('2026-07-10T12:00:00Z') }),
    );
    expect(withProbe).toEqual(noProbe);
  });
});
