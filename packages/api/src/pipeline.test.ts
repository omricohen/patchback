import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  AgentAdapter,
  AgentContext,
  ExecutionResult,
  GuardedTaskBrief,
} from '@patchback/agent-core';
import { createBriefFromTriagedFeedback, runGit } from '@patchback/agent-core';
import type { FeedbackItem, Job } from '@patchback/types';

import { createFakeGitHubClient } from '../test/fakes.js';
import { createDefaultPatchPipeline, patchBranchName } from './pipeline.js';

let baseDir: string;
let sourceRepo: string;

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(os.tmpdir(), 'patchback-pipeline-'));
  sourceRepo = path.join(baseDir, 'source');
  await runGit(baseDir, ['init', '--quiet', '--initial-branch=main', 'source']);
  await writeFile(
    path.join(sourceRepo, 'greeting.txt'),
    'Hello wrold\n',
    'utf8',
  );
  await writeFile(path.join(sourceRepo, 'obsolete.txt'), 'delete me\n', 'utf8');
  await runGit(sourceRepo, ['add', '.']);
  await runGit(sourceRepo, [
    '-c',
    'user.email=test@test.invalid',
    '-c',
    'user.name=Test',
    'commit',
    '--quiet',
    '-m',
    'initial',
  ]);
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function makeBrief(): GuardedTaskBrief {
  const now = new Date().toISOString();
  const item: FeedbackItem = {
    id: 'fb-pipeline',
    message: 'Fix the typo in greeting.txt',
    trustTier: 'insider',
    triage: { classification: 'patchable', confidence: 0.95 },
    createdAt: now,
    updatedAt: now,
  };
  return createBriefFromTriagedFeedback(item, {
    title: 'Fix the typo in greeting.txt',
    description: 'greeting.txt says "wrold" instead of "world".',
    constraints: ['Keep the diff minimal.'],
    fileHints: [],
    acceptanceCriteria: ['greeting.txt says "world".'],
  });
}

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: `job-${Math.random().toString(36).slice(2, 10)}`,
    feedbackId: 'fb-pipeline',
    state: 'patch.running',
    history: [],
    issueNumber: 101,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAdapter(
  execute: (ctx: AgentContext) => Promise<ExecutionResult>,
): AgentAdapter & { lifecycle: string[] } {
  const lifecycle: string[] = [];
  return {
    name: 'fake-adapter',
    lifecycle,
    async prepare() {
      lifecycle.push('prepare');
    },
    async plan() {
      lifecycle.push('plan');
      return { steps: ['edit greeting.txt'] };
    },
    async execute(ctx) {
      lifecycle.push('execute');
      return execute(ctx);
    },
    async summarize() {
      lifecycle.push('summarize');
      return { title: 'Fix greeting typo', body: 'wrold → world' };
    },
  };
}

describe('createDefaultPatchPipeline', () => {
  it('clones, runs the adapter, commits the changed files, and opens a PR', async () => {
    const github = createFakeGitHubClient();
    const adapter = makeAdapter(async (ctx) => {
      await writeFile(
        path.join(ctx.workDir, 'greeting.txt'),
        'Hello world\n',
        'utf8',
      );
      await rm(path.join(ctx.workDir, 'obsolete.txt'));
      return {
        success: true,
        changedFiles: [
          { path: 'greeting.txt', additions: 1, deletions: 1, binary: false },
          { path: 'obsolete.txt', additions: 0, deletions: 1, binary: false },
        ],
        totalChangedLines: 3,
      };
    });
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      baseBranch: 'main',
      scratchBaseDir: path.join(baseDir, 'scratch-ok'),
    });
    const job = makeJob();
    const result = await pipeline.run(makeBrief(), job);

    expect(result).toEqual({
      ok: true,
      branch: patchBranchName(job.id),
      prNumber: 501,
      prUrl: 'https://github.com/acme/demo/pull/501',
    });
    expect(adapter.lifecycle).toEqual([
      'prepare',
      'plan',
      'execute',
      'summarize',
    ]);
    expect(github.branches).toEqual([
      { branch: patchBranchName(job.id), from: 'main' },
    ]);
    expect(github.commits).toHaveLength(1);
    expect(github.commits[0]?.files).toEqual([
      { path: 'greeting.txt', content: 'Hello world\n' },
      { path: 'obsolete.txt', delete: true },
    ]);
    expect(github.pullRequests[0]?.title).toBe('Fix greeting typo');
    expect(github.pullRequests[0]?.body).toContain('Closes #101');
    // Scratch dir is always cleaned up.
    expect(await readdir(path.join(baseDir, 'scratch-ok'))).toEqual([]);
  });

  it('a failed execution moves nothing to GitHub and reports the error', async () => {
    const github = createFakeGitHubClient();
    const adapter = makeAdapter(async () => ({
      success: false,
      changedFiles: [],
      totalChangedLines: 0,
      error: 'diff ceiling exceeded: triage likely misclassified this item',
    }));
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      scratchBaseDir: path.join(baseDir, 'scratch-fail'),
    });
    const result = await pipeline.run(makeBrief(), makeJob());
    expect(result).toEqual({
      ok: false,
      error: 'diff ceiling exceeded: triage likely misclassified this item',
    });
    expect(github.callLog).toEqual([]);
    expect(await readdir(path.join(baseDir, 'scratch-fail'))).toEqual([]);
  });

  it('rejects binary file changes in v0.1', async () => {
    const github = createFakeGitHubClient();
    const adapter = makeAdapter(async () => ({
      success: true,
      changedFiles: [
        { path: 'logo.png', additions: 0, deletions: 0, binary: true },
      ],
      totalChangedLines: 0,
    }));
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      scratchBaseDir: path.join(baseDir, 'scratch-binary'),
    });
    const result = await pipeline.run(makeBrief(), makeJob());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('binary');
    }
    expect(github.callLog).toEqual([]);
  });

  it('an empty change set fails instead of opening an empty PR', async () => {
    const github = createFakeGitHubClient();
    const adapter = makeAdapter(async () => ({
      success: true,
      changedFiles: [],
      totalChangedLines: 0,
    }));
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      scratchBaseDir: path.join(baseDir, 'scratch-empty'),
    });
    const result = await pipeline.run(makeBrief(), makeJob());
    expect(result).toEqual({ ok: false, error: 'agent changed no files' });
    expect(github.callLog).toEqual([]);
  });

  it('a throwing adapter is caught and reported, scratch dir still removed', async () => {
    const github = createFakeGitHubClient();
    const adapter = makeAdapter(async () => {
      throw new Error('agent binary not found');
    });
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      scratchBaseDir: path.join(baseDir, 'scratch-throw'),
    });
    const result = await pipeline.run(makeBrief(), makeJob());
    expect(result).toEqual({ ok: false, error: 'agent binary not found' });
    expect(await readdir(path.join(baseDir, 'scratch-throw'))).toEqual([]);
  });
});
