import { describe, expect, it } from 'vitest';

import { MemoryStore } from '@patchback/api';
import type { Job } from '@patchback/types';
import { INITIAL_JOB_STATE, transitionJob } from '@patchback/types';

import { createDevLogger, instrumentStore } from './logging.js';

const SECRET = 'github_pat_super_secret_value_123456';

describe('createDevLogger', () => {
  it('scrubs secrets from every line', () => {
    const lines: string[] = [];
    const logger = createDevLogger({
      sink: (line) => lines.push(line),
      secrets: [SECRET, undefined],
    });
    logger.error(
      `git clone https://x-access-token:${SECRET}@github.com/a/b failed`,
    );
    expect(lines.join('\n')).not.toContain(SECRET);
    expect(lines.join('\n')).toContain('[redacted]');
  });

  it('never treats short strings as scrubbable secrets', () => {
    const logger = createDevLogger({ sink: () => {}, secrets: ['a'] });
    expect(logger.scrub('a normal sentence')).toBe('a normal sentence');
  });
});

describe('instrumentStore', () => {
  it('streams state transitions and scrubs secrets out of persisted errors', async () => {
    const lines: string[] = [];
    const logger = createDevLogger({
      sink: (line) => lines.push(line),
      secrets: [SECRET],
    });
    const store = instrumentStore(new MemoryStore(), logger);

    const at = new Date().toISOString();
    let job: Job = {
      id: 'job-log-test-1',
      feedbackId: 'fb-log-test-1',
      state: INITIAL_JOB_STATE,
      history: [],
      createdAt: at,
      updatedAt: at,
    };
    await store.createJob(job);
    job = transitionJob(job, 'feedback.triaged', { note: 'triage: patchable' });
    await store.updateJob(job, INITIAL_JOB_STATE);
    for (const state of [
      'issue.created',
      'patch.queued',
      'patch.running',
    ] as const) {
      const previous = job.state;
      job = transitionJob(job, state);
      await store.updateJob(job, previous);
    }
    const failed: Job = {
      ...transitionJob(job, 'patch.failed', {
        note: `clone with ${SECRET} failed`,
      }),
      error: `git clone --quiet https://x-access-token:${SECRET}@github.com/a/b.git failed`,
    };
    await store.updateJob(failed, 'patch.running');

    // Transitions streamed, each exactly once.
    const text = lines.join('\n');
    for (const state of [
      'feedback.triaged',
      'issue.created',
      'patch.queued',
      'patch.running',
      'patch.failed',
    ]) {
      expect(text).toContain(`[${state}]`);
      expect(text.split(`[${state}]`)).toHaveLength(2);
    }

    // The secret is gone from the terminal AND from storage.
    expect(text).not.toContain(SECRET);
    const stored = await store.getJob(job.id);
    expect(stored?.error).toContain('[redacted]');
    expect(stored?.error).not.toContain(SECRET);
    expect(
      stored?.history.some((change) => change.note?.includes(SECRET)),
    ).toBe(false);

    // patch.failed is explained readably.
    expect(text).toContain('Could not clone the target repository');
  });

  it('logs feedback intake and triage verdicts', async () => {
    const lines: string[] = [];
    const store = instrumentStore(
      new MemoryStore(),
      createDevLogger({ sink: (line) => lines.push(line) }),
    );
    const at = new Date().toISOString();
    await store.createFeedback(
      {
        id: 'fb-intake-1',
        message: 'The export button is mislabeled.',
        trustTier: 'insider',
        createdAt: at,
        updatedAt: at,
      },
      'hash',
    );
    await store.setTriage('fb-intake-1', {
      classification: 'needs_clarification',
      confidence: 0.8,
      reasoning: 'ambiguous',
      clarifyingQuestion: 'Which button?',
      triagedAt: at,
    });
    const text = lines.join('\n');
    expect(text).toContain('tier: insider');
    expect(text).toContain('needs_clarification');
    expect(text).toContain('Which button?');
  });
});
