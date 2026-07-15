import { describe, expect, it } from 'vitest';

import type { FeedbackItem, Job } from '@patchback/types';
import { INITIAL_JOB_STATE, transitionJob } from '@patchback/types';

import {
  createFakeGitHubClient,
  createFakePipeline,
  createScriptedModelCaller,
} from '../testing.js';
import type { ApiConfig } from '../config.js';
import { generateId, generateReadToken, hashReadToken } from '../ids.js';
import type { PatchPipeline } from '../pipeline.js';
import { MemoryQueue } from '../queue/memory.js';
import { MemoryStore } from '../store/memory.js';
import { runPatchTask } from './patch-worker.js';

async function seedQueuedJob(
  store: MemoryStore,
): Promise<{ item: FeedbackItem; job: Job }> {
  const at = new Date().toISOString();
  const item: FeedbackItem = {
    id: generateId(),
    message: 'The button says "Sumbit" instead of "Submit".',
    trustTier: 'owner',
    triage: {
      classification: 'patchable',
      confidence: 0.95,
      reasoning: 'test seed',
      triagedAt: at,
    },
    createdAt: at,
    updatedAt: at,
  };
  await store.createFeedback(item, hashReadToken(generateReadToken()));
  let job: Job = {
    id: generateId(),
    feedbackId: item.id,
    state: INITIAL_JOB_STATE,
    history: [],
    createdAt: at,
    updatedAt: at,
  };
  await store.createJob(job);
  job = transitionJob(job, 'feedback.triaged');
  job = transitionJob(job, 'issue.created');
  job = transitionJob(job, 'patch.queued');
  await store.updateJob(job, INITIAL_JOB_STATE);
  return { item, job };
}

function makeConfig(
  store: MemoryStore,
  overrides: Partial<ApiConfig>,
): ApiConfig {
  const { callModel } = createScriptedModelCaller([
    { classification: 'patchable' },
  ]);
  return {
    store,
    queue: new MemoryQueue(),
    callModel,
    githubClient: createFakeGitHubClient(),
    pipeline: createFakePipeline(),
    ...overrides,
  };
}

describe('patch-worker success-path CAS', () => {
  it('records PR metadata when the job stays at patch.running', async () => {
    const store = new MemoryStore();
    const { job } = await seedQueuedJob(store);
    const logged: string[] = [];
    const config = makeConfig(store, { log: (line) => logged.push(line) });
    await runPatchTask(config, createFakePipeline(), {
      type: 'patch',
      jobId: job.id,
    });
    const after = await store.getJob(job.id);
    expect(after?.state).toBe('pr.opened');
    expect(after?.prNumber).toBe(501);
    expect(logged).toHaveLength(0);
  });

  it('logs loudly when the success CAS is lost instead of dropping PR metadata silently', async () => {
    const store = new MemoryStore();
    const { job } = await seedQueuedJob(store);
    const logged: string[] = [];
    const config = makeConfig(store, { log: (line) => logged.push(line) });

    // A pipeline that yanks the job out of patch.running mid-run, so the
    // worker's success-path CAS must lose.
    const sabotage: PatchPipeline = {
      async run(_brief, running) {
        const failed = transitionJob(running, 'patch.failed', {
          note: 'concurrent out-of-band failure',
        });
        expect(await store.updateJob(failed, 'patch.running')).toBe(true);
        return {
          ok: true,
          branch: `patchback/job-${running.id}`,
          prNumber: 777,
          prUrl: 'https://github.com/acme/demo/pull/777',
        };
      },
    };

    await runPatchTask(config, sabotage, { type: 'patch', jobId: job.id });

    const after = await store.getJob(job.id);
    expect(after?.state).toBe('patch.failed');
    expect(after?.prNumber).toBeUndefined();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(job.id);
    expect(logged[0]).toContain('PR #777');
    expect(logged[0]).toContain('CAS');
  });
});
