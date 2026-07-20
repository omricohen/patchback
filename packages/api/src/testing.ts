import type {
  BranchRef,
  CommitFilesInput,
  CommitRef,
  CreateBranchInput,
  CreateIssueCommentInput,
  CreateIssueInput,
  GitHubClient,
  IssueCommentRef,
  IssueRef,
  OpenPullRequestInput,
  PullRequestRef,
  PullRequestStatus,
  RepoRef,
} from '@patchback/github';
import type { GuardedTaskBrief } from '@patchback/agent-core';
import type { ModelCaller, ModelRequest } from '@patchback/triage';
import type { Job, TriageClassification } from '@patchback/types';

import type { PatchPipeline, PatchPipelineResult } from './pipeline.js';

/**
 * Scripted fakes for tests and local dev harnesses. No vi.mock, no network —
 * plain objects that record calls and return scripted values, matching the
 * repo's injectable-seam convention.
 *
 * Shipped as the `@patchback/api/testing` subpath so the SDK contract tests,
 * the widget playground, and the browser acceptance suite reuse ONE set of
 * fakes instead of copy-pasting them. Dev/test-only usage; it carries no
 * extra runtime dependencies.
 */

export interface ScriptedTriage {
  classification: TriageClassification;
  confidence?: number;
  reasoning?: string;
  clarifyingQuestion?: string;
}

/**
 * A ModelCaller returning scripted triage responses in order (last one
 * repeats). Records every request so tests can assert call counts — the
 * outsider short-circuit proof is `calls.length === 0`.
 */
export function createScriptedModelCaller(script: ScriptedTriage[]): {
  callModel: ModelCaller;
  calls: ModelRequest[];
} {
  const calls: ModelRequest[] = [];
  const callModel: ModelCaller = async (request) => {
    calls.push(request);
    const index = Math.min(calls.length - 1, script.length - 1);
    const scripted = script[index];
    if (scripted === undefined) {
      throw new Error('scripted model caller invoked with an empty script');
    }
    return {
      text: JSON.stringify({
        classification: scripted.classification,
        confidence: scripted.confidence ?? 0.95,
        reasoning: scripted.reasoning ?? 'scripted',
        ...(scripted.clarifyingQuestion !== undefined
          ? { clarifyingQuestion: scripted.clarifyingQuestion }
          : {}),
      }),
    };
  };
  return { callModel, calls };
}

export interface FakeGitHubClient extends GitHubClient {
  issues: CreateIssueInput[];
  branches: CreateBranchInput[];
  commits: CommitFilesInput[];
  pullRequests: OpenPullRequestInput[];
  comments: CreateIssueCommentInput[];
  /** Every method invocation in order, for the webhook zero-calls spy. */
  callLog: string[];
}

export function createFakeGitHubClient(
  repo: RepoRef = { owner: 'acme', repo: 'demo' },
): FakeGitHubClient {
  const issues: CreateIssueInput[] = [];
  const branches: CreateBranchInput[] = [];
  const commits: CommitFilesInput[] = [];
  const pullRequests: OpenPullRequestInput[] = [];
  const comments: CreateIssueCommentInput[] = [];
  const callLog: string[] = [];
  return {
    repo,
    issues,
    branches,
    commits,
    pullRequests,
    comments,
    callLog,
    async createIssue(input: CreateIssueInput): Promise<IssueRef> {
      callLog.push('createIssue');
      issues.push(input);
      const number = 100 + issues.length;
      return {
        number,
        title: input.title,
        url: `https://github.com/${repo.owner}/${repo.repo}/issues/${number}`,
      };
    },
    async createIssueComment(
      input: CreateIssueCommentInput,
    ): Promise<IssueCommentRef> {
      callLog.push('createIssueComment');
      comments.push(input);
      const id = 900 + comments.length;
      return {
        id,
        url: `https://github.com/${repo.owner}/${repo.repo}/issues/${input.issueNumber}#issuecomment-${id}`,
      };
    },
    async createBranch(input: CreateBranchInput): Promise<BranchRef> {
      callLog.push('createBranch');
      branches.push(input);
      return {
        branch: input.branch,
        ref: `refs/heads/${input.branch}`,
        sha: 'a'.repeat(40),
      };
    },
    async commitFiles(input: CommitFilesInput): Promise<CommitRef> {
      callLog.push('commitFiles');
      commits.push(input);
      return {
        sha: 'b'.repeat(40),
        message: input.message,
        url: `https://github.com/${repo.owner}/${repo.repo}/commit/${'b'.repeat(40)}`,
      };
    },
    async openPullRequest(
      input: OpenPullRequestInput,
    ): Promise<PullRequestRef> {
      callLog.push('openPullRequest');
      pullRequests.push(input);
      const number = 500 + pullRequests.length;
      return {
        number,
        url: `https://github.com/${repo.owner}/${repo.repo}/pull/${number}`,
        head: { branch: input.head, sha: 'c'.repeat(40) },
        base: input.base ?? 'main',
      };
    },
    async getPullRequestStatus(pullNumber: number): Promise<PullRequestStatus> {
      callLog.push('getPullRequestStatus');
      return {
        number: pullNumber,
        state: 'open',
        draft: false,
        merged: false,
        headSha: 'c'.repeat(40),
        url: `https://github.com/${repo.owner}/${repo.repo}/pull/${pullNumber}`,
      };
    },
    async getPreviewDeploymentUrl(): Promise<string | undefined> {
      callLog.push('getPreviewDeploymentUrl');
      // No preview by default; tests override this method to script a URL.
      return undefined;
    },
  };
}

export interface FakePipeline extends PatchPipeline {
  runs: Array<{ brief: GuardedTaskBrief; job: Job }>;
}

/** A pipeline returning a scripted result and recording every invocation. */
export function createFakePipeline(result?: PatchPipelineResult): FakePipeline {
  const runs: Array<{ brief: GuardedTaskBrief; job: Job }> = [];
  return {
    runs,
    async run(brief: GuardedTaskBrief, job: Job): Promise<PatchPipelineResult> {
      runs.push({ brief, job });
      return (
        result ?? {
          ok: true,
          branch: `patchback/job-${job.id}`,
          prNumber: 501,
          prUrl: 'https://github.com/acme/demo/pull/501',
          repairAttempts: 0,
        }
      );
    },
  };
}

/** A valid API key of the minimum allowed length, unique per label. */
export function testKey(label: string): string {
  return `test-key-${label}`.padEnd(24, 'x');
}
