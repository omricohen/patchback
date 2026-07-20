import { describe, expect, it } from 'vitest';

import { MemoryStore } from '@patchback/api';
import { createFakeGitHubClient } from '@patchback/api/testing';
import type { Job } from '@patchback/types';
import { INITIAL_JOB_STATE, transitionJob } from '@patchback/types';

import { createDevLogger } from './logging.js';
import { startPrPoller } from './pr-poller.js';

async function seedPrOpenedJob(store: MemoryStore): Promise<Job> {
  const at = new Date().toISOString();
  let job: Job = {
    id: 'job-poller-1',
    feedbackId: 'fb-poller-1',
    state: INITIAL_JOB_STATE,
    history: [],
    createdAt: at,
    updatedAt: at,
  };
  await store.createJob(job);
  for (const state of [
    'feedback.triaged',
    'issue.created',
    'patch.queued',
    'patch.running',
    'patch.generated',
    'pr.opened',
  ] as const) {
    job = transitionJob(job, state);
  }
  job = {
    ...job,
    prNumber: 501,
    prUrl: 'https://github.com/acme/demo/pull/501',
  };
  await store.updateJob(job, INITIAL_JOB_STATE);
  return job;
}

describe('PR status poller (dev-mode webhook substitute)', () => {
  it('walks a merged PR to feedback.closed through the canonical tail', async () => {
    const store = new MemoryStore();
    const job = await seedPrOpenedJob(store);
    const github = createFakeGitHubClient();
    github.getPullRequestStatus = async (pullNumber) => ({
      number: pullNumber,
      state: 'merged',
      draft: false,
      merged: true,
      headSha: 'c'.repeat(40),
      url: `https://github.com/acme/demo/pull/${pullNumber}`,
    });
    const lines: string[] = [];
    const poller = startPrPoller({
      store,
      githubClient: github,
      jobIds: () => [job.id],
      logger: createDevLogger({ sink: (line) => lines.push(line) }),
      intervalMs: 60_000,
    });
    await poller.tick();
    poller.stop();

    const after = await store.getJob(job.id);
    expect(after?.state).toBe('feedback.closed');
    const states = after?.history.map((change) => change.to) ?? [];
    expect(states).toContain('pr.reviewed');
    expect(states).toContain('patch.shipped');
  });

  it('leaves an open PR alone', async () => {
    const store = new MemoryStore();
    const job = await seedPrOpenedJob(store);
    const poller = startPrPoller({
      store,
      githubClient: createFakeGitHubClient(), // scripted: always open
      jobIds: () => [job.id],
      logger: createDevLogger({ sink: () => {} }),
      intervalMs: 60_000,
    });
    await poller.tick();
    poller.stop();
    expect((await store.getJob(job.id))?.state).toBe('pr.opened');
  });

  it('reports closed-without-merge once, without touching state', async () => {
    const store = new MemoryStore();
    const job = await seedPrOpenedJob(store);
    const github = createFakeGitHubClient();
    github.getPullRequestStatus = async (pullNumber) => ({
      number: pullNumber,
      state: 'closed',
      draft: false,
      merged: false,
      headSha: 'c'.repeat(40),
      url: `https://github.com/acme/demo/pull/${pullNumber}`,
    });
    const lines: string[] = [];
    const poller = startPrPoller({
      store,
      githubClient: github,
      jobIds: () => [job.id],
      logger: createDevLogger({ sink: (line) => lines.push(line) }),
      intervalMs: 60_000,
    });
    await poller.tick();
    await poller.tick();
    poller.stop();

    expect((await store.getJob(job.id))?.state).toBe('pr.opened');
    const closedWarnings = lines.filter((line) =>
      line.includes('closed WITHOUT merging'),
    );
    expect(closedWarnings).toHaveLength(1);
  });

  it('survives GitHub API errors and keeps polling', async () => {
    const store = new MemoryStore();
    const job = await seedPrOpenedJob(store);
    const github = createFakeGitHubClient();
    github.getPullRequestStatus = async () => {
      throw new Error('rate limited');
    };
    const lines: string[] = [];
    const poller = startPrPoller({
      store,
      githubClient: github,
      jobIds: () => [job.id],
      logger: createDevLogger({ sink: (line) => lines.push(line) }),
      intervalMs: 60_000,
    });
    await poller.tick();
    poller.stop();
    expect((await store.getJob(job.id))?.state).toBe('pr.opened');
    expect(lines.join('\n')).toContain('poll failed');
  });

  it('surfaces a preview URL onto an open PR job, once and idempotently', async () => {
    const store = new MemoryStore();
    const job = await seedPrOpenedJob(store);
    const github = createFakeGitHubClient();
    let previewCalls = 0;
    github.getPreviewDeploymentUrl = async () => {
      previewCalls += 1;
      return 'https://preview.example.com/pr/1';
    };
    const poller = startPrPoller({
      store,
      githubClient: github,
      jobIds: () => [job.id],
      logger: createDevLogger({ sink: () => {} }),
      intervalMs: 60_000,
    });
    await poller.tick();
    expect((await store.getJob(job.id))?.previewUrl).toBe(
      'https://preview.example.com/pr/1',
    );
    // Second tick must NOT re-query deployments (previewUrl already set).
    await poller.tick();
    poller.stop();
    expect(previewCalls).toBe(1);
    // Still open — surfacing a preview never advances state.
    expect((await store.getJob(job.id))?.state).toBe('pr.opened');
  });

  it('drops a non-http(s) preview URL and keeps polling', async () => {
    const store = new MemoryStore();
    const job = await seedPrOpenedJob(store);
    const github = createFakeGitHubClient();
    github.getPreviewDeploymentUrl = async () => 'javascript:alert(1)';
    const poller = startPrPoller({
      store,
      githubClient: github,
      jobIds: () => [job.id],
      logger: createDevLogger({ sink: () => {} }),
      intervalMs: 60_000,
    });
    await poller.tick();
    poller.stop();
    expect((await store.getJob(job.id))?.previewUrl).toBeUndefined();
  });

  it('isolates preview-poll errors from the merge tail', async () => {
    const store = new MemoryStore();
    const job = await seedPrOpenedJob(store);
    const github = createFakeGitHubClient();
    github.getPreviewDeploymentUrl = async () => {
      throw new Error('deployments rate limited');
    };
    github.getPullRequestStatus = async (pullNumber) => ({
      number: pullNumber,
      state: 'merged',
      draft: false,
      merged: true,
      headSha: 'c'.repeat(40),
      url: `https://github.com/acme/demo/pull/${pullNumber}`,
    });
    const lines: string[] = [];
    const poller = startPrPoller({
      store,
      githubClient: github,
      jobIds: () => [job.id],
      logger: createDevLogger({ sink: (line) => lines.push(line) }),
      intervalMs: 60_000,
    });
    await poller.tick();
    poller.stop();
    // The merge tail still completes despite the preview error.
    expect((await store.getJob(job.id))?.state).toBe('feedback.closed');
    expect(lines.join('\n')).toContain('Preview deployment poll failed');
  });
});
