import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  AgentAdapter,
  AgentContext,
  ExecutionResult,
  GuardedTaskBrief,
} from '@patchback/agent-core';
import {
  createBriefFromTriagedFeedback,
  diffNumstat,
  runGit,
  totalChangedLines,
} from '@patchback/agent-core';
import type { FeedbackItem, Job } from '@patchback/types';

import { createFakeGitHubClient } from './testing.js';
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

  it('never commits hook artifacts from new dot-dirs (real sweep in the adapter)', async () => {
    const github = createFakeGitHubClient();
    const warnings: string[] = [];
    // Adapter that behaves like the real one: something on the machine
    // (a global hook/plugin) writes state into the scratch clone alongside
    // the actual change, and the adapter reports the SWEPT diff.
    const adapter = makeAdapter(async (ctx) => {
      await mkdir(path.join(ctx.workDir, '.a5c', 'cache'), {
        recursive: true,
      });
      await writeFile(
        path.join(ctx.workDir, '.a5c', 'cache', 'foo.json'),
        '{"cwd":"/Users/example-user/private/project"}\n',
        'utf8',
      );
      await writeFile(
        path.join(ctx.workDir, 'greeting.txt'),
        'Hello world\n',
        'utf8',
      );
      const changedFiles = await diffNumstat(ctx.workDir, {
        warn: (message) => warnings.push(message),
      });
      return {
        success: true,
        changedFiles,
        totalChangedLines: totalChangedLines(changedFiles),
      };
    });
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      baseBranch: 'main',
      scratchBaseDir: path.join(baseDir, 'scratch-artifacts'),
      log: (message) => warnings.push(message),
    });
    const result = await pipeline.run(makeBrief(), makeJob());

    expect(result.ok).toBe(true);
    expect(github.commits).toHaveLength(1);
    expect(github.commits[0]?.files).toEqual([
      { path: 'greeting.txt', content: 'Hello world\n' },
    ]);
    expect(warnings.join('\n')).toContain('.a5c/');
  });

  it('filters dot-dir artifacts even when the adapter reports them (second layer)', async () => {
    const github = createFakeGitHubClient();
    const warnings: string[] = [];
    // Adapter that does NOT sweep — it hands the artifact path straight to
    // the pipeline. The commit path must still refuse it.
    const adapter = makeAdapter(async (ctx) => {
      await mkdir(path.join(ctx.workDir, '.a5c'), { recursive: true });
      await writeFile(
        path.join(ctx.workDir, '.a5c', 'state.json'),
        '{}\n',
        'utf8',
      );
      await writeFile(
        path.join(ctx.workDir, 'greeting.txt'),
        'Hello world\n',
        'utf8',
      );
      return {
        success: true,
        changedFiles: [
          { path: 'greeting.txt', additions: 1, deletions: 1, binary: false },
          {
            path: '.a5c/state.json',
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
        totalChangedLines: 3,
      };
    });
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      baseBranch: 'main',
      scratchBaseDir: path.join(baseDir, 'scratch-artifacts-2'),
      log: (message) => warnings.push(message),
    });
    const result = await pipeline.run(makeBrief(), makeJob());

    expect(result.ok).toBe(true);
    expect(github.commits[0]?.files).toEqual([
      { path: 'greeting.txt', content: 'Hello world\n' },
    ]);
    expect(warnings.join('\n')).toContain('.a5c/state.json');
  });

  it('an all-artifact change set fails instead of opening an empty PR', async () => {
    const github = createFakeGitHubClient();
    const adapter = makeAdapter(async (ctx) => {
      await mkdir(path.join(ctx.workDir, '.a5c'), { recursive: true });
      await writeFile(
        path.join(ctx.workDir, '.a5c', 'state.json'),
        '{}\n',
        'utf8',
      );
      return {
        success: true,
        changedFiles: [
          {
            path: '.a5c/state.json',
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
        totalChangedLines: 1,
      };
    });
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      scratchBaseDir: path.join(baseDir, 'scratch-artifacts-3'),
      log: () => {},
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
