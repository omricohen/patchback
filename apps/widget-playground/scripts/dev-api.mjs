/**
 * The playground's fake-pipeline API: REAL Phase-6 pieces (buildServer +
 * createWorkers + MemoryStore + MemoryQueue) composed with fakes for the
 * model, GitHub, and the patch pipeline — the full canonical state walk
 * happens locally with zero credentials and zero services.
 *
 * Deterministic model caller (keyword script, NOT a real model):
 *   - message contains "[clarify]" → needs_clarification (canned question)
 *   - message contains "[human]"   → needs_human
 *   - anything else                → patchable @ 0.95
 *
 * A `POST /_dev/merge/:pr` helper (registered by THIS harness, never by
 * buildServer) fires a SIGNED webhook at the real /webhooks/github endpoint
 * to demo pr.reviewed → patch.shipped → feedback.closed.
 */
import { createHmac } from 'node:crypto';

import {
  buildServer,
  createWorkers,
  MemoryQueue,
  MemoryStore,
} from '@patchback/api';
import { createFakeGitHubClient } from '@patchback/api/testing';

export const DEV_OWNER_KEY = 'pb_dev_owner_key_000000';
export const DEV_INSIDER_KEY = 'pb_dev_insider_key_000000';
export const DEV_WEBHOOK_SECRET = 'pb_dev_webhook_secret_000000';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ port?: number, triageDelayMs?: number, patchDelayMs?: number }} [options]
 */
export async function createDevApi(options = {}) {
  const triageDelayMs = options.triageDelayMs ?? 800;
  const patchDelayMs = options.patchDelayMs ?? 1200;

  const store = new MemoryStore();
  const queue = new MemoryQueue();
  const github = createFakeGitHubClient({ owner: 'acme', repo: 'demo' });

  /** Track created feedback ids so harness consumers (the browser
   * acceptance suite) can read stored items back without new API surface. */
  const createdFeedbackIds = [];
  const originalCreate = store.createFeedback.bind(store);
  store.createFeedback = async (item, hash) => {
    createdFeedbackIds.push(item.id);
    return originalCreate(item, hash);
  };

  const callModel = async (request) => {
    await sleep(triageDelayMs); // Make "Received" visible in the widget.
    // Keyword-match ONLY the current message's DATA block — thread context
    // quotes prior messages, which would otherwise re-trigger keywords on
    // every reply.
    const messageBlock =
      /<data-[0-9a-f]+ field="message">\n([\s\S]*?)\n<\/data-[0-9a-f]+>/.exec(
        `${request.user}`,
      );
    const text = messageBlock?.[1] ?? `${request.user}`;
    let result;
    if (text.includes('[human]')) {
      result = {
        classification: 'needs_human',
        confidence: 0.9,
        reasoning: 'dev harness: [human] keyword',
      };
    } else if (text.includes('[clarify]')) {
      // Keyword ONLY — a "message ends with ?" heuristic would re-trigger
      // on replies, whose prompts quote the previous clarifying question.
      result = {
        classification: 'needs_clarification',
        // Above the 0.7 demotion threshold — below it the ladder would
        // demote to needs_human.
        confidence: 0.8,
        reasoning: 'dev harness: question detected',
        clarifyingQuestion:
          'Which exact element do you mean, and what should it say instead?',
      };
    } else {
      result = {
        classification: 'patchable',
        confidence: 0.95,
        reasoning: 'dev harness: concrete change request',
      };
    }
    return { text: JSON.stringify(result) };
  };

  /** Fake pipeline with injected delays so the state walk visibly animates. */
  const pipeline = {
    async run(brief, job) {
      await sleep(patchDelayMs);
      const prNumber = 500 + createdFeedbackIds.length;
      return {
        ok: true,
        branch: `patchback/job-${job.id.slice(0, 8)}`,
        prNumber,
        prUrl: `https://github.com/acme/demo/pull/${prNumber}`,
      };
    },
  };

  const config = {
    store,
    queue,
    callModel,
    githubClient: github,
    pipeline,
    webhookSecret: DEV_WEBHOOK_SECRET,
    apiKeys: [
      { key: DEV_OWNER_KEY, tier: 'owner', label: 'dev-owner' },
      { key: DEV_INSIDER_KEY, tier: 'insider', label: 'dev-insider' },
    ],
  };

  const app = buildServer(config);
  createWorkers(config);

  // Harness-only helper: simulate a human merging the PR on GitHub. It goes
  // through the REAL signed-webhook path — no store shortcut.
  app.post('/_dev/merge/:pr', async (request, reply) => {
    const prNumber = Number(request.params.pr);
    const payload = JSON.stringify({
      action: 'closed',
      pull_request: { number: prNumber, merged: true },
      repository: { full_name: 'acme/demo' },
    });
    const signature = `sha256=${createHmac('sha256', DEV_WEBHOOK_SECRET).update(payload).digest('hex')}`;
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signature,
      },
      payload,
    });
    return reply
      .status(response.statusCode)
      .send({ forwarded: true, webhookStatus: response.statusCode });
  });

  const address = await app.listen({
    port: options.port ?? 8787,
    host: '127.0.0.1',
  });

  return {
    app,
    store,
    queue,
    github,
    address,
    createdFeedbackIds,
    keys: { owner: DEV_OWNER_KEY, insider: DEV_INSIDER_KEY },
    close: () => app.close(),
  };
}

const isMain = process.argv[1]
  ? new URL(`file://${process.argv[1]}`).pathname ===
    new URL(import.meta.url).pathname
  : false;

if (isMain) {
  const port = Number(process.env.PATCHBACK_DEV_API_PORT ?? 8787);
  const api = await createDevApi({ port });
  console.log(`[patchback dev-api] listening on ${api.address}`);
  console.log(`[patchback dev-api] owner key:   ${DEV_OWNER_KEY}`);
  console.log(`[patchback dev-api] insider key: ${DEV_INSIDER_KEY}`);
  console.log(
    '[patchback dev-api] merge helper: POST /_dev/merge/:pr (fires the signed webhook)',
  );
}
