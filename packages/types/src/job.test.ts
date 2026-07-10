import { describe, expect, it } from 'vitest';

import {
  INITIAL_JOB_STATE,
  InvalidJobTransitionError,
  JOB_STATES,
  JOB_STATE_TRANSITIONS,
  assertTransition,
  canTransition,
  isJobState,
  isTerminalJobState,
  nextJobStates,
  transitionJob,
  type Job,
  type JobState,
} from './index.js';

/**
 * The canonical transition list, declared here independently of the
 * implementation so the tests fail if the map in job.ts drifts:
 *
 * feedback.received → feedback.triaged → feedback.needs_clarification | issue.created
 * issue.created → patch.queued → patch.running → patch.failed | patch.generated
 * patch.generated → pr.opened → pr.reviewed → patch.shipped → feedback.closed
 */
const LEGAL_TRANSITIONS: ReadonlyArray<readonly [JobState, JobState]> = [
  ['feedback.received', 'feedback.triaged'],
  ['feedback.triaged', 'feedback.needs_clarification'],
  ['feedback.triaged', 'issue.created'],
  ['issue.created', 'patch.queued'],
  ['patch.queued', 'patch.running'],
  ['patch.running', 'patch.failed'],
  ['patch.running', 'patch.generated'],
  ['patch.generated', 'pr.opened'],
  ['pr.opened', 'pr.reviewed'],
  ['pr.reviewed', 'patch.shipped'],
  ['patch.shipped', 'feedback.closed'],
];

const isLegal = (from: JobState, to: JobState): boolean =>
  LEGAL_TRANSITIONS.some(([f, t]) => f === from && t === to);

const ILLEGAL_TRANSITIONS: ReadonlyArray<readonly [JobState, JobState]> =
  JOB_STATES.flatMap((from) =>
    JOB_STATES.filter((to) => !isLegal(from, to)).map(
      (to) => [from, to] as const,
    ),
  );

describe('JOB_STATES', () => {
  it('contains exactly the canonical states from CLAUDE.md, verbatim', () => {
    expect(JOB_STATES).toEqual([
      'feedback.received',
      'feedback.triaged',
      'feedback.needs_clarification',
      'issue.created',
      'patch.queued',
      'patch.running',
      'patch.failed',
      'patch.generated',
      'pr.opened',
      'pr.reviewed',
      'patch.shipped',
      'feedback.closed',
    ]);
  });

  it('starts every job at feedback.received', () => {
    expect(INITIAL_JOB_STATE).toBe('feedback.received');
  });

  it('exhaustive sweep sanity check: 12 states, 11 legal, 133 illegal pairs', () => {
    expect(JOB_STATES).toHaveLength(12);
    expect(LEGAL_TRANSITIONS).toHaveLength(11);
    expect(ILLEGAL_TRANSITIONS).toHaveLength(12 * 12 - 11);
  });
});

describe('isJobState', () => {
  it.each(JOB_STATES.map((s) => [s]))('accepts %s', (state) => {
    expect(isJobState(state)).toBe(true);
  });

  it.each([
    ['feedback.merged'],
    ['pr.merged'],
    ['patch.autoMerged'],
    ['FEEDBACK.RECEIVED'],
    ['feedback.received '],
    [''],
  ])('rejects unknown string %j', (value) => {
    expect(isJobState(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isJobState(undefined)).toBe(false);
    expect(isJobState(null)).toBe(false);
    expect(isJobState(42)).toBe(false);
    expect(isJobState({})).toBe(false);
  });
});

describe('every legal transition', () => {
  it.each(LEGAL_TRANSITIONS.map(([from, to]) => [from, to]))(
    'allows %s → %s',
    (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(assertTransition(from, to)).toBe(to);
      expect(nextJobStates(from)).toContain(to);
    },
  );
});

describe('every illegal transition', () => {
  it.each(ILLEGAL_TRANSITIONS.map(([from, to]) => [from, to]))(
    'forbids %s → %s',
    (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(
        InvalidJobTransitionError,
      );
      expect(nextJobStates(from)).not.toContain(to);
    },
  );

  it('includes self-transitions and skips (spot checks)', () => {
    // Self-loop
    expect(() => assertTransition('patch.running', 'patch.running')).toThrow(
      InvalidJobTransitionError,
    );
    // Skipping triage straight to code
    expect(() => assertTransition('feedback.received', 'patch.queued')).toThrow(
      InvalidJobTransitionError,
    );
    // Going backwards
    expect(() => assertTransition('pr.opened', 'patch.generated')).toThrow(
      InvalidJobTransitionError,
    );
    // Shipping without human review
    expect(() => assertTransition('pr.opened', 'patch.shipped')).toThrow(
      InvalidJobTransitionError,
    );
  });
});

describe('terminal states', () => {
  const terminal: JobState[] = [
    'feedback.needs_clarification',
    'patch.failed',
    'feedback.closed',
  ];
  const nonTerminal = JOB_STATES.filter((s) => !terminal.includes(s));

  it.each(terminal.map((s) => [s]))(
    '%s has no outgoing transitions',
    (state) => {
      expect(isTerminalJobState(state)).toBe(true);
      expect(nextJobStates(state)).toEqual([]);
    },
  );

  it.each(nonTerminal.map((s) => [s]))('%s is not terminal', (state) => {
    expect(isTerminalJobState(state)).toBe(false);
    expect(nextJobStates(state).length).toBeGreaterThan(0);
  });
});

describe('InvalidJobTransitionError', () => {
  it('carries from/to and a readable message', () => {
    try {
      assertTransition('feedback.closed', 'feedback.received');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidJobTransitionError);
      const e = error as InvalidJobTransitionError;
      expect(e.from).toBe('feedback.closed');
      expect(e.to).toBe('feedback.received');
      expect(e.name).toBe('InvalidJobTransitionError');
      expect(e.message).toContain('feedback.closed');
      expect(e.message).toContain('feedback.received');
    }
  });
});

describe('transitionJob', () => {
  const baseJob: Job = {
    id: 'job_1',
    feedbackId: 'fb_1',
    state: INITIAL_JOB_STATE,
    history: [],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };

  it('moves the job along a legal transition and records history', () => {
    const at = '2026-07-10T00:01:00.000Z';
    const next = transitionJob(baseJob, 'feedback.triaged', {
      at,
      note: 'classified patchable',
    });
    expect(next.state).toBe('feedback.triaged');
    expect(next.updatedAt).toBe(at);
    expect(next.history).toEqual([
      {
        from: 'feedback.received',
        to: 'feedback.triaged',
        at,
        note: 'classified patchable',
      },
    ]);
  });

  it('does not mutate the input job', () => {
    const next = transitionJob(baseJob, 'feedback.triaged');
    expect(next).not.toBe(baseJob);
    expect(baseJob.state).toBe('feedback.received');
    expect(baseJob.history).toEqual([]);
  });

  it('throws InvalidJobTransitionError on an illegal move and leaves the job untouched', () => {
    expect(() => transitionJob(baseJob, 'pr.opened')).toThrow(
      InvalidJobTransitionError,
    );
    expect(baseJob.state).toBe('feedback.received');
    expect(baseJob.history).toEqual([]);
  });

  it('defaults `at` to now (ISO 8601)', () => {
    const before = Date.now();
    const next = transitionJob(baseJob, 'feedback.triaged');
    const after = Date.now();
    const stamped = Date.parse(next.updatedAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
    expect(next.history[0]?.at).toBe(next.updatedAt);
  });

  it('walks the full happy path from received to closed', () => {
    const path: JobState[] = [
      'feedback.triaged',
      'issue.created',
      'patch.queued',
      'patch.running',
      'patch.generated',
      'pr.opened',
      'pr.reviewed',
      'patch.shipped',
      'feedback.closed',
    ];
    let job = baseJob;
    for (const state of path) {
      job = transitionJob(job, state);
    }
    expect(job.state).toBe('feedback.closed');
    expect(isTerminalJobState(job.state)).toBe(true);
    expect(job.history.map((h) => h.to)).toEqual(path);
  });

  it('walks the failure path and stops at patch.failed', () => {
    let job = baseJob;
    for (const state of [
      'feedback.triaged',
      'issue.created',
      'patch.queued',
      'patch.running',
      'patch.failed',
    ] as const) {
      job = transitionJob(job, state);
    }
    expect(job.state).toBe('patch.failed');
    expect(isTerminalJobState(job.state)).toBe(true);
    for (const to of JOB_STATES) {
      expect(() => transitionJob(job, to)).toThrow(InvalidJobTransitionError);
    }
  });
});

describe('JOB_STATE_TRANSITIONS map', () => {
  it('has an entry for every state and only canonical targets', () => {
    for (const state of JOB_STATES) {
      const targets = JOB_STATE_TRANSITIONS[state];
      expect(Array.isArray(targets)).toBe(true);
      for (const target of targets) {
        expect(JOB_STATES).toContain(target);
        expect(isLegal(state, target)).toBe(true);
      }
    }
  });

  it('contains every legal transition (no missing edges)', () => {
    for (const [from, to] of LEGAL_TRANSITIONS) {
      expect(JOB_STATE_TRANSITIONS[from]).toContain(to);
    }
  });
});
