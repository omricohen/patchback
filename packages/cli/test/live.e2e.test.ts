/**
 * LIVE full-PR round-trip through `patchback dev` — real GitHub token client,
 * real Anthropic triage, real Claude Code agent. Costs money and needs a
 * throwaway repo, so it is env-gated and skips cleanly unless ALL of:
 *
 *   GITHUB_TOKEN         fine-grained PAT for the scratch repo
 *   PATCHBACK_TEST_REPO  scratch repo as "owner/repo" (a Node repo with a
 *                        README.md at the root works best)
 *   ANTHROPIC_API_KEY    for triage + the agent (the `claude` CLI must also
 *                        be installed and on PATH)
 *
 * Run: GITHUB_TOKEN=... PATCHBACK_TEST_REPO=you/scratch ANTHROPIC_API_KEY=... \
 *        pnpm --filter patchback test
 *
 * Everything the run creates (issue, branch, PR) is closed/deleted in
 * afterAll, best-effort.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { MemoryQueue } from '@patchback/api';
import { createPatchbackClient } from '@patchback/sdk';

import { runDev, type DevHandle } from '../src/dev.js';

const token = process.env.GITHUB_TOKEN;
const testRepo = process.env.PATCHBACK_TEST_REPO;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const hasCredentials = Boolean(token && testRepo && anthropicKey);

describe.skipIf(!hasCredentials)(
  'patchback dev live full-PR round-trip (env-gated)',
  () => {
    // NOTE: this factory also runs at collection time when the suite is
    // skipped, so nothing here may throw unless credentials are present.
    const [owner = '', repo = ''] = (testRepo ?? '').split('/');
    if (hasCredentials && (!owner || !repo)) {
      throw new Error(
        `PATCHBACK_TEST_REPO must be "owner/repo", got "${testRepo}"`,
      );
    }

    let handle: DevHandle | undefined;
    let issueNumber: number | undefined;
    let prNumber: number | undefined;
    let branchName: string | undefined;

    /** Raw calls for cleanup only. */
    async function rawGitHub(method: string, path: string, body?: unknown) {
      const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'patchback-cli-live-test',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!response.ok && response.status !== 404 && response.status !== 422) {
        console.warn(
          `cleanup: ${method} ${path} -> ${response.status} ${await response.text()}`,
        );
      }
    }

    afterAll(async () => {
      await handle?.close();
      const base = `/repos/${owner}/${repo}`;
      if (prNumber !== undefined) {
        await rawGitHub('PATCH', `${base}/pulls/${prNumber}`, {
          state: 'closed',
        });
      }
      if (branchName !== undefined) {
        await rawGitHub('DELETE', `${base}/git/refs/heads/${branchName}`);
      }
      if (issueNumber !== undefined) {
        await rawGitHub('PATCH', `${base}/issues/${issueNumber}`, {
          state: 'closed',
        });
      }
    }, 120_000);

    it(
      'feedback → triage → agent → real PR on the scratch repo',
      { timeout: 15 * 60 * 1000 },
      async () => {
        const queue = new MemoryQueue();
        handle = await runDev({
          config: { repo: `${owner}/${repo}` },
          port: 0,
          secrets: {
            githubToken: token as string,
            anthropicApiKey: anthropicKey as string,
          },
          seams: { queue, pollIntervalMs: 60_000 },
        });

        const client = createPatchbackClient({
          baseUrl: handle.address,
          apiKey: handle.keys.owner,
        });
        const submitted = await client.submitFeedback({
          message:
            'Fix this typo: add a line "Patchback live round-trip marker." ' +
            'to the end of README.md (create README.md if it does not exist).',
        });
        await queue.onIdle(); // triage

        const triaged = await client.getJobStatus(submitted.jobId, {
          readToken: submitted.readToken,
        });
        expect(['feedback.triaged', 'feedback.needs_clarification']).toContain(
          triaged.state,
        );
        expect(triaged.state).toBe('feedback.triaged'); // must be startable

        const started = await client.startJob(submitted.jobId);
        issueNumber = started.issueNumber;
        await queue.onIdle(); // agent + checks + PR

        const done = await client.getJobStatus(submitted.jobId, {
          readToken: submitted.readToken,
        });
        branchName = done.branchName;
        prNumber = done.prNumber;
        expect(done.error).toBeUndefined();
        expect(done.state).toBe('pr.opened');
        expect(done.prUrl).toContain(`/${repo}/pull/`);
      },
    );
  },
);
