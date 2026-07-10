/**
 * Env-gated integration test against a real scratch repository.
 *
 * Skipped (cleanly, as "skipped") unless BOTH env vars are set:
 *   GITHUB_TOKEN         fine-grained PAT with the scopes from this package's README
 *   PATCHBACK_TEST_REPO  scratch repo as "owner/repo" — use a throwaway repo,
 *                        the test creates and closes an issue, a branch, and a PR
 *
 * Run: GITHUB_TOKEN=... PATCHBACK_TEST_REPO=you/scratch pnpm --filter @patchback/github test
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createTokenClient } from './token-client.js';

const token = process.env.GITHUB_TOKEN;
const testRepo = process.env.PATCHBACK_TEST_REPO;
const hasCredentials = Boolean(token && testRepo);

describe.skipIf(!hasCredentials)(
  'GitHub integration round-trip (env-gated)',
  () => {
    // NOTE: this factory also runs at collection time when the suite is
    // skipped, so nothing here may throw unless credentials are present.
    const [owner = '', repo = ''] = (testRepo ?? '').split('/');
    if (hasCredentials && (!owner || !repo)) {
      throw new Error(
        `PATCHBACK_TEST_REPO must be "owner/repo", got "${testRepo}"`,
      );
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const branchName = `patchback-integration/${runId}`;

    // Cleanup targets collected as the test progresses.
    let issueNumber: number | undefined;
    let prNumber: number | undefined;
    let branchCreated = false;

    /** Raw call for cleanup only — keeps the client surface to the five methods. */
    async function rawGitHub(method: string, path: string, body?: unknown) {
      const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'patchback-integration-test',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!response.ok && response.status !== 404 && response.status !== 422) {
        // Cleanup is best-effort; only surface unexpected failures.
        console.warn(
          `cleanup: ${method} ${path} -> ${response.status} ${await response.text()}`,
        );
      }
    }

    afterAll(async () => {
      const base = `/repos/${owner}/${repo}`;
      if (prNumber !== undefined) {
        await rawGitHub('PATCH', `${base}/pulls/${prNumber}`, {
          state: 'closed',
        });
      }
      if (branchCreated) {
        await rawGitHub('DELETE', `${base}/git/refs/heads/${branchName}`);
      }
      if (issueNumber !== undefined) {
        await rawGitHub('PATCH', `${base}/issues/${issueNumber}`, {
          state: 'closed',
        });
      }
    }, 60_000);

    it(
      'does issue -> branch -> commit -> PR -> status against the scratch repo',
      { timeout: 120_000 },
      async () => {
        const client = createTokenClient({ token: token!, owner, repo });

        // Issue
        const issue = await client.createIssue({
          title: `[patchback integration] round-trip ${runId}`,
          body: 'Created by the @patchback/github integration test. Safe to delete.',
          labels: [],
        });
        issueNumber = issue.number;
        expect(issue.number).toBeGreaterThan(0);
        expect(issue.url).toContain(`/${repo}/issues/${issue.number}`);

        // Branch off the default branch
        const branch = await client.createBranch({ branch: branchName });
        branchCreated = true;
        expect(branch.ref).toBe(`refs/heads/${branchName}`);
        expect(branch.sha).toMatch(/^[0-9a-f]{40}$/);

        // Commit a file onto the branch
        const commit = await client.commitFiles({
          branch: branchName,
          message: `patchback integration test ${runId}`,
          files: [
            {
              path: `.patchback-integration/${runId}.md`,
              content: `# Patchback integration test\n\nRun: ${runId}\nIssue: #${issue.number}\n`,
            },
          ],
        });
        expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(commit.sha).not.toBe(branch.sha);

        // Open a PR
        const pr = await client.openPullRequest({
          title: `[patchback integration] round-trip ${runId}`,
          head: branchName,
          body: `Automated round-trip for #${issue.number}. Safe to close.`,
        });
        prNumber = pr.number;
        expect(pr.number).toBeGreaterThan(0);
        expect(pr.head).toEqual({ branch: branchName, sha: commit.sha });

        // Read the PR status back
        const status = await client.getPullRequestStatus(pr.number);
        expect(status.number).toBe(pr.number);
        expect(status.state).toBe('open');
        expect(status.merged).toBe(false);
        expect(status.headSha).toBe(commit.sha);
      },
    );
  },
);
