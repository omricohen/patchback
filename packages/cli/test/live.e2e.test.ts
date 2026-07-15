/**
 * LIVE full-PR round-trip through `patchback dev` — real GitHub token client,
 * real Anthropic triage, real Claude Code agent. Costs money and needs a
 * throwaway repo, so it is env-gated and skips cleanly unless ALL of:
 *
 *   GITHUB_TOKEN         fine-grained PAT for the scratch repo
 *   PATCHBACK_TEST_REPO  scratch repo as "owner/repo"
 *   ANTHROPIC_API_KEY    for triage + the agent (the `claude` CLI must also
 *                        be installed and on PATH)
 *
 * Run: GITHUB_TOKEN=... PATCHBACK_TEST_REPO=you/scratch ANTHROPIC_API_KEY=... \
 *        pnpm --filter patchback test
 *
 * Flow: the test first SEEDS the scratch repo with a doc that contains a
 * genuine defect (a "recieve" typo, pushed via the GitHub contents API), then
 * submits a natural defect REPORT in user voice — describing what is wrong,
 * not instructing file edits. Instruction-shaped feedback is exactly what the
 * triage classifier must classify DOWN, so it cannot be the fixture.
 *
 * The PR-diff assertion doubles as a live regression test for the
 * agent-spawn-isolation fix: the diff must touch ONLY the seeded file — in
 * particular no `.a5c/` or other dot-directory artifacts that global
 * hooks/plugins might write into the scratch clone.
 *
 * Everything the run creates (issue, branch, PR, seeded file) is
 * closed/deleted/removed in afterAll, best-effort.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryQueue } from '@patchback/api';
import { createPatchbackClient } from '@patchback/sdk';

import { runDev, type DevHandle } from '../src/dev.js';

const token = process.env.GITHUB_TOKEN;
const testRepo = process.env.PATCHBACK_TEST_REPO;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const hasCredentials = Boolean(token && testRepo && anthropicKey);

/** The seeded defect: a doc with an obvious spelling mistake. */
const FIXTURE_PATH = 'docs/getting-started.md';
const FIXTURE_CONTENT = [
  '# Getting started',
  '',
  'Sign up with your email address. You will recieve a confirmation',
  'email within a few minutes. Follow the link inside it to finish',
  'setting up your account.',
  '',
  'Once confirmed, you can log in and create your first project.',
  '',
].join('\n');

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
    const base = `/repos/${owner}/${repo}`;

    let handle: DevHandle | undefined;
    let issueNumber: number | undefined;
    let prNumber: number | undefined;
    let branchName: string | undefined;

    async function github(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; json: unknown }> {
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
      const text = await response.text();
      return {
        status: response.status,
        json: text === '' ? undefined : (JSON.parse(text) as unknown),
      };
    }

    /** Raw calls for cleanup only — warn instead of failing the teardown. */
    async function cleanupCall(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<void> {
      const { status, json } = await github(method, path, body);
      if (status >= 400 && status !== 404 && status !== 422) {
        console.warn(
          `cleanup: ${method} ${path} -> ${status} ${JSON.stringify(json)}`,
        );
      }
    }

    /** Sha of FIXTURE_PATH on the default branch, if it exists. */
    async function fixtureSha(): Promise<string | undefined> {
      const { status, json } = await github(
        'GET',
        `${base}/contents/${FIXTURE_PATH}`,
      );
      if (status !== 200) return undefined;
      return (json as { sha: string }).sha;
    }

    beforeAll(async () => {
      // Seed the defect the feedback will report. Overwrites a leftover from
      // a previous aborted run if one exists.
      const existing = await fixtureSha();
      const { status, json } = await github(
        'PUT',
        `${base}/contents/${FIXTURE_PATH}`,
        {
          message: 'test: seed live-fixture doc (contains a known typo)',
          content: Buffer.from(FIXTURE_CONTENT, 'utf8').toString('base64'),
          ...(existing !== undefined ? { sha: existing } : {}),
        },
      );
      if (status !== 200 && status !== 201) {
        throw new Error(
          `could not seed ${FIXTURE_PATH}: ${status} ${JSON.stringify(json)}`,
        );
      }
    }, 60_000);

    afterAll(async () => {
      await handle?.close();
      if (prNumber !== undefined) {
        await cleanupCall('PATCH', `${base}/pulls/${prNumber}`, {
          state: 'closed',
        });
      }
      if (branchName !== undefined) {
        await cleanupCall('DELETE', `${base}/git/refs/heads/${branchName}`);
      }
      if (issueNumber !== undefined) {
        await cleanupCall('PATCH', `${base}/issues/${issueNumber}`, {
          state: 'closed',
        });
      }
      // Restore the repo: remove the seeded doc from the default branch.
      const sha = await fixtureSha();
      if (sha !== undefined) {
        await cleanupCall('DELETE', `${base}/contents/${FIXTURE_PATH}`, {
          message: 'test: remove live-fixture doc',
          sha,
        });
      }
    }, 120_000);

    it(
      'defect report → triage patchable → agent → real PR touching only the seeded file',
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
        // A natural defect report (user voice), NOT an instruction to edit
        // files — the classifier correctly classifies instruction-shaped
        // messages down, so this is what real patchable feedback looks like.
        const submitted = await client.submitFeedback({
          message:
            'Spotted a spelling mistake in the getting started guide: the ' +
            `first paragraph of ${FIXTURE_PATH} says "You will recieve a ` +
            'confirmation email" — "recieve" should be "receive".',
        });
        await queue.onIdle(); // triage

        const triaged = await client.getJobStatus(submitted.jobId, {
          readToken: submitted.readToken,
        });
        expect(triaged.state).toBe('feedback.triaged'); // patchable, startable

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

        // The PR diff must touch ONLY the seeded file. This also live-pins
        // the spawn-isolation fix: no `.a5c/**` (or any other dot-directory
        // artifact from machine-global hooks/plugins) may appear in the PR.
        const { status, json } = await github(
          'GET',
          `${base}/pulls/${prNumber}/files?per_page=100`,
        );
        expect(status).toBe(200);
        const files = (json as Array<{ filename: string }>).map(
          (file) => file.filename,
        );
        expect(files).toEqual([FIXTURE_PATH]);
        for (const filename of files) {
          expect(filename).not.toMatch(/(^|\/)\.a5c\//);
          expect(filename.startsWith('.')).toBe(false);
        }

        // And the fix itself landed: the typo is gone on the PR branch.
        const patch = await github(
          'GET',
          `${base}/contents/${FIXTURE_PATH}?ref=${encodeURIComponent(
            branchName as string,
          )}`,
        );
        expect(patch.status).toBe(200);
        const fixed = Buffer.from(
          (patch.json as { content: string }).content,
          'base64',
        ).toString('utf8');
        expect(fixed).toContain('receive');
        expect(fixed).not.toContain('recieve');
      },
    );
  },
);
