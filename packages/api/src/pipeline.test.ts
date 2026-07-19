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
  readRepoConventions,
  runGit,
  totalChangedLines,
  type AgentPlan,
  type RepairContext,
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
      repairAttempts: 0,
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
      repairAttempts: 0,
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
    expect(result).toEqual({
      ok: false,
      error: 'agent changed no files',
      repairAttempts: 0,
    });
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
    expect(result).toEqual({
      ok: false,
      error: 'agent changed no files',
      repairAttempts: 0,
    });
    expect(github.callLog).toEqual([]);
  });

  it('a successful run reports repairAttempts: 0 when checks pass first try', async () => {
    const github = createFakeGitHubClient();
    const adapter = makeAdapter(async (ctx) => {
      await writeFile(
        path.join(ctx.workDir, 'greeting.txt'),
        'Hello world\n',
        'utf8',
      );
      return {
        success: true,
        changedFiles: [
          { path: 'greeting.txt', additions: 1, deletions: 1, binary: false },
        ],
        totalChangedLines: 2,
      };
    });
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: sourceRepo,
      baseBranch: 'main',
      scratchBaseDir: path.join(baseDir, 'scratch-norepair'),
    });
    const result = await pipeline.run(makeBrief(), makeJob());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repairAttempts).toBe(0);
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
    expect(result).toEqual({
      ok: false,
      error: 'agent binary not found',
      repairAttempts: 0,
    });
    expect(await readdir(path.join(baseDir, 'scratch-throw'))).toEqual([]);
  });
});

/**
 * The repair loop, driven through the real check-runner: a repo whose `test`
 * script requires the word "world" in greeting.txt. A stateful adapter breaks
 * it on the first execute, then (only when handed a repair context) fixes it.
 */
describe('createDefaultPatchPipeline — bounded repair', () => {
  let checkRepo: string;

  beforeAll(async () => {
    checkRepo = path.join(baseDir, 'check-source');
    await mkdir(path.join(checkRepo, 'scripts'), { recursive: true });
    await writeFile(
      path.join(checkRepo, 'package.json'),
      JSON.stringify(
        {
          name: 'check-fixture',
          version: '1.0.0',
          private: true,
          scripts: { test: 'node scripts/check.mjs' },
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      path.join(checkRepo, 'package-lock.json'),
      JSON.stringify({ name: 'check-fixture', lockfileVersion: 3 }) + '\n',
    );
    await writeFile(
      path.join(checkRepo, 'scripts', 'check.mjs'),
      [
        "import { readFileSync } from 'node:fs';",
        "if (!readFileSync('greeting.txt', 'utf8').includes('world')) {",
        "  console.error('greeting.txt is missing the word world');",
        '  process.exit(1);',
        '}',
        '',
      ].join('\n'),
    );
    // Base greeting has the typo; the agent's job is to fix it.
    await writeFile(path.join(checkRepo, 'greeting.txt'), 'Hello wrold\n');
    await runGit(checkRepo, ['init', '--quiet', '--initial-branch=main']);
    await runGit(checkRepo, ['config', 'user.email', 't@t.invalid']);
    await runGit(checkRepo, ['config', 'user.name', 'T']);
    await runGit(checkRepo, ['add', '.']);
    await runGit(checkRepo, ['commit', '--quiet', '-m', 'init']);
  });

  /**
   * Adapter that reads real conventions in prepare (so the check-runner runs),
   * writes a still-broken greeting on the first execute, and only writes the
   * correct greeting when it is handed a repair context. Records the repair
   * context seen on each call.
   */
  function repairAdapter(): {
    adapter: ReturnType<typeof makeAdapter>;
    repairSeen: (RepairContext | undefined)[];
  } {
    const repairSeen: (RepairContext | undefined)[] = [];
    const base = makeAdapter(async (ctx) => {
      repairSeen.push(ctx.repair);
      const target = path.join(ctx.workDir, 'greeting.txt');
      await writeFile(
        target,
        ctx.repair === undefined ? 'Hello wrld\n' : 'Hello world\n',
      );
      const changed = await diffNumstat(ctx.workDir);
      return {
        success: true,
        changedFiles: changed,
        totalChangedLines: totalChangedLines(changed),
      };
    });
    base.prepare = async (ctx): Promise<void> => {
      ctx.conventions = await readRepoConventions(ctx.workDir);
    };
    base.plan = async (): Promise<AgentPlan> => ({ steps: ['fix typo'] });
    return { adapter: base, repairSeen };
  }

  it('(a) fail-then-fix: one repair makes checks pass → PR opens', async () => {
    const github = createFakeGitHubClient();
    const { adapter, repairSeen } = repairAdapter();
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: checkRepo,
      baseBranch: 'main',
      scratchBaseDir: path.join(baseDir, 'scratch-repair-fix'),
    });
    const result = await pipeline.run(makeBrief(), makeJob());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repairAttempts).toBe(1);
      expect(result.prNumber).toBe(501);
    }
    // Two executes: the first with no repair ctx, the second WITH it.
    expect(repairSeen).toHaveLength(2);
    expect(repairSeen[0]).toBeUndefined();
    expect(repairSeen[1]?.attempt).toBe(1);
    expect(repairSeen[1]?.failingChecks[0]?.name).toBe('test');
    expect(github.commits[0]?.files).toEqual([
      { path: 'greeting.txt', content: 'Hello world\n' },
    ]);
  });

  it('(d) repair disabled: first check failure fails immediately, one execute', async () => {
    const github = createFakeGitHubClient();
    const { adapter, repairSeen } = repairAdapter();
    const pipeline = createDefaultPatchPipeline({
      adapter,
      githubClient: github,
      repoSource: checkRepo,
      baseBranch: 'main',
      scratchBaseDir: path.join(baseDir, 'scratch-repair-off'),
      repair: { enabled: false },
    });
    const result = await pipeline.run(makeBrief(), makeJob());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.repairAttempts).toBe(0);
      expect(result.error).toContain('target repo checks failed');
    }
    expect(repairSeen).toEqual([undefined]); // exactly one execute, no repair
    expect(github.callLog).toEqual([]); // nothing reached GitHub
  });
});
