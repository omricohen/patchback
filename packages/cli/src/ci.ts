import { readFile } from 'node:fs/promises';

import type {
  ApiConfig,
  PatchPipeline,
  Store,
  TaskQueue,
  VerifyMarkerResult,
} from '@patchback/api';
import {
  generateReadToken,
  hashReadToken,
  MemoryQueue,
  MemoryStore,
  resolvePipeline,
  runPatchTask,
  runTriageTask,
  verifyIssueMarker,
} from '@patchback/api';
import type { AgentAdapter } from '@patchback/agent-core';
import { createClaudeCodeAdapter } from '@patchback/agent-claude-code';
import type { GitHubClient } from '@patchback/github';
import { createTokenClient } from '@patchback/github';
import type { ModelCaller } from '@patchback/triage';
import { createAnthropicModelCaller } from '@patchback/triage';
import type { FeedbackItem, Job } from '@patchback/types';
import {
  canInitiatePatchJob,
  INITIAL_JOB_STATE,
  transitionJob,
} from '@patchback/types';

import { parseRepoRef, type PatchbackConfig } from './config-file.js';
import { CliError } from './errors.js';

/**
 * `patchback ci` composition: the one-shot GitHub Action entry.
 *
 * A patchback-created issue triggered the workflow. This command VERIFIES the
 * HMAC marker embedded in the issue body (the primary, load-bearing gate — the
 * `patchback` label is only the workflow's trigger filter, never
 * authorization) and, ONLY on a valid marker, reconstructs a `FeedbackItem`
 * from the SIGNED fields and drives it through the EXACT same triage worker →
 * guarded brief factory → patch pipeline that `patchback dev` uses. Every
 * trust defense (outsider short-circuit, injection containment, tier gate,
 * agent isolation, diff ceiling, one-attempt repair, no-merge) is inherited
 * unchanged because the same workers and pipeline run.
 *
 * Invalid / absent / tampered / replayed-stale marker ⇒ NEUTRAL EXIT with ZERO
 * downstream calls (no triage model call, no agent run, no GitHub write). This
 * is the phase's headline security property and is spy-asserted in the tests.
 *
 * Every network seam is injectable so the acceptance suite runs the identical
 * composition over fakes — mirroring `dev.ts`.
 */
export interface CiSecrets {
  githubToken?: string;
  anthropicApiKey?: string;
  /** Shared HMAC key; must equal the ingest's `issueEmitter.signingSecret`. */
  signingSecret?: string;
}

export interface CiSeams {
  store?: Store;
  queue?: TaskQueue;
  callModel?: ModelCaller;
  githubClient?: GitHubClient;
  pipeline?: PatchPipeline;
  adapter?: AgentAdapter;
}

/** The slice of the GitHub `issues` event payload the Action needs. */
export interface CiIssueEvent {
  issue: { number: number; body: string };
}

export interface RunCiOptions {
  config: PatchbackConfig;
  /** `owner/name` — from `GITHUB_REPOSITORY`. */
  repo: string;
  event: CiIssueEvent;
  secrets?: CiSecrets;
  seams?: CiSeams;
  /** Line sink (never receives secrets). Default: no-op. */
  log?: (line: string) => void;
  /** Clock injection for deterministic freshness/triage in tests. */
  now?: () => Date;
  /** Marker freshness window override (ms). */
  freshnessWindowMs?: number;
}

export type CiOutcome =
  | 'neutral'
  | 'needs_human'
  | 'needs_clarification'
  | 'patched'
  | 'patch_failed';

export interface CiResult {
  outcome: CiOutcome;
  issueNumber: number;
  /** Present when a valid marker was verified. */
  feedbackId?: string;
  /** For `neutral`: why the marker was rejected (for operator logs, not shown to probers). */
  reason?: string;
  prNumber?: number;
  prUrl?: string;
  branch?: string;
  error?: string;
}

/** Parse the GitHub `issues` event JSON at `eventPath` down to what CI needs. */
export async function readIssueEvent(eventPath: string): Promise<CiIssueEvent> {
  let raw: string;
  try {
    raw = await readFile(eventPath, 'utf8');
  } catch {
    throw new CliError(
      `Could not read the GitHub event payload at GITHUB_EVENT_PATH (${eventPath}).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(
      `GITHUB_EVENT_PATH (${eventPath}) is not valid JSON — expected a GitHub issues event.`,
    );
  }
  const issue = (parsed as { issue?: { number?: unknown; body?: unknown } })
    .issue;
  if (issue === undefined || typeof issue.number !== 'number') {
    throw new CliError(
      'The event payload has no issue number — `patchback ci` runs on `issues` events only.',
    );
  }
  return {
    issue: {
      number: issue.number,
      body: typeof issue.body === 'string' ? issue.body : '',
    },
  };
}

export async function runCi(options: RunCiOptions): Promise<CiResult> {
  const { config, event } = options;
  const secrets = options.secrets ?? {};
  const seams = options.seams ?? {};
  const log = options.log ?? ((): void => {});
  const issueNumber = event.issue.number;

  const signingSecret = secrets.signingSecret;
  if (signingSecret === undefined || signingSecret === '') {
    throw new CliError(
      'PATCHBACK_SIGNING_SECRET is not set. It is a required repo secret for ' +
        'Action mode and must equal the signing secret configured in your ' +
        'ingest (see `patchback init --github-action`).',
    );
  }

  // === THE GATE ===========================================================
  // Verify BEFORE constructing any client or touching the store, so an
  // invalid/tampered/stale marker guarantees zero downstream calls.
  const verified: VerifyMarkerResult = verifyIssueMarker(
    event.issue.body,
    signingSecret,
    options.repo,
    {
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.freshnessWindowMs !== undefined
        ? { freshnessWindowMs: options.freshnessWindowMs }
        : {}),
    },
  );
  if (!verified.ok) {
    log(
      `patchback ci: no valid patchback marker on issue #${issueNumber} ` +
        `(${verified.reason}). Neutral exit — nothing to do. The label is ` +
        'only a trigger filter; authorization is the signed marker.',
    );
    return { outcome: 'neutral', issueNumber, reason: verified.reason };
  }
  const { payload, feedbackText } = verified;

  // === Composition (only after a valid marker) ============================
  const { owner, name } = parseRepoRef(options.repo);

  let githubClient = seams.githubClient;
  if (githubClient === undefined) {
    if (secrets.githubToken === undefined || secrets.githubToken === '') {
      throw new CliError(
        'GITHUB_TOKEN is not set. The Action must pass it as `github-token`.',
      );
    }
    githubClient = createTokenClient({
      token: secrets.githubToken,
      owner,
      repo: name,
    });
  }

  const needsAnthropic =
    seams.callModel === undefined ||
    (seams.pipeline === undefined && seams.adapter === undefined);
  if (
    needsAnthropic &&
    (secrets.anthropicApiKey === undefined || secrets.anthropicApiKey === '')
  ) {
    throw new CliError(
      'ANTHROPIC_API_KEY is not set. The Action must pass it as ' +
        '`anthropic-api-key` for triage and the agent.',
    );
  }

  const callModel: ModelCaller =
    seams.callModel ??
    createAnthropicModelCaller({
      apiKey: secrets.anthropicApiKey as string,
      ...(config.triageModel !== undefined
        ? { model: config.triageModel }
        : {}),
    });

  // The pipeline clones its OWN scratch dir — never $GITHUB_WORKSPACE — so the
  // dot-dir artifact sweep + scratch cleanup + agent isolation all apply. The
  // clone URL embeds the token for private repos and must never be logged (the
  // api log seam scrubs it as in dev).
  const repoSource =
    config.localRepoPath ??
    (secrets.githubToken !== undefined && secrets.githubToken !== ''
      ? `https://x-access-token:${secrets.githubToken}@github.com/${owner}/${name}.git`
      : `https://github.com/${owner}/${name}.git`);

  const pipelineOrAdapter: Pick<
    ApiConfig,
    'pipeline' | 'adapter' | 'repoSource' | 'baseBranch'
  > =
    seams.pipeline !== undefined
      ? { pipeline: seams.pipeline }
      : {
          adapter:
            seams.adapter ??
            createClaudeCodeAdapter({
              ...(config.maxChangedLines !== undefined
                ? { maxChangedLines: config.maxChangedLines }
                : {}),
              env: { ANTHROPIC_API_KEY: secrets.anthropicApiKey as string },
            }),
          repoSource,
          ...(config.baseBranch !== undefined
            ? { baseBranch: config.baseBranch }
            : {}),
        };

  const store = seams.store ?? new MemoryStore();
  const queue = seams.queue ?? new MemoryQueue();

  const apiConfig: ApiConfig = {
    store,
    queue,
    callModel,
    githubClient,
    log: (message) => log(message),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...pipelineOrAdapter,
  };

  // === Reconstruct the item from the SIGNED fields ========================
  // `trustTier` is the SIGNED tier — never re-derived from the GitHub actor.
  const at = (options.now?.() ?? new Date()).toISOString();
  const item: FeedbackItem = {
    id: payload.feedbackId,
    message: feedbackText,
    trustTier: payload.tier,
    createdAt: at,
    updatedAt: at,
  };
  const readToken = generateReadToken();
  await store.createFeedback(item, hashReadToken(readToken));
  // Job id === feedbackId ⇒ the patch branch (`patchback/job-<feedbackId>`) is
  // deterministic, so a replayed marker collides with the existing branch
  // (non-force createBranch) and can never produce a SECOND PR.
  const job: Job = {
    id: payload.feedbackId,
    feedbackId: item.id,
    state: INITIAL_JOB_STATE,
    history: [],
    createdAt: at,
    updatedAt: at,
  };
  await store.createJob(job);

  // === Triage (the exact worker) ==========================================
  await runTriageTask(apiConfig, {
    type: 'triage',
    feedbackId: item.id,
    jobId: job.id,
  });

  const triaged = await store.getFeedback(item.id);
  const classification = triaged?.triage?.classification;

  if (classification === 'needs_clarification') {
    const question = triaged?.triage?.clarifyingQuestion;
    await githubClient.createIssueComment({
      issueNumber,
      body: renderClarificationComment(question),
    });
    return {
      outcome: 'needs_clarification',
      issueNumber,
      feedbackId: item.id,
    };
  }

  // needs_human (incl. the outsider short-circuit) OR a non-patch-eligible
  // tier ⇒ comment and stop. Never touch the agent. The tier check is
  // defense-in-depth: outsider already short-circuits triage to needs_human,
  // and the guarded brief factory would throw for an outsider even here.
  if (classification !== 'patchable' || !canInitiatePatchJob(item.trustTier)) {
    await githubClient.createIssueComment({
      issueNumber,
      body: renderNeedsHumanComment(),
    });
    return { outcome: 'needs_human', issueNumber, feedbackId: item.id };
  }

  // === Patch (auto-proceed) ===============================================
  // CI auto-proceeds patchable → patch; the human gate is PR REVIEW, never
  // auto-merge. Seed the job's issueNumber from the triggering issue and SKIP
  // createIssue (the issue already exists), mirroring dev's post-triage path.
  const triagedJob = await store.getJob(job.id);
  if (triagedJob === undefined || triagedJob.state !== 'feedback.triaged') {
    // Triage did not advance the job (e.g. transport retry left it behind);
    // fail safe rather than force a state.
    await githubClient.createIssueComment({
      issueNumber,
      body: renderNeedsHumanComment(),
    });
    return { outcome: 'needs_human', issueNumber, feedbackId: item.id };
  }
  let advanced = transitionJob(triagedJob, 'issue.created', {
    note: `issue #${issueNumber}`,
  });
  advanced = { ...advanced, issueNumber };
  advanced = transitionJob(advanced, 'patch.queued');
  await store.updateJob(advanced, 'feedback.triaged');

  const pipeline = resolvePipeline(apiConfig);
  await runPatchTask(apiConfig, pipeline, { type: 'patch', jobId: job.id });

  const finalJob = await store.getJob(job.id);
  if (finalJob?.state === 'pr.opened' && finalJob.prUrl !== undefined) {
    await githubClient.createIssueComment({
      issueNumber,
      body: renderPatchedComment(finalJob.prNumber, finalJob.prUrl),
    });
    return {
      outcome: 'patched',
      issueNumber,
      feedbackId: item.id,
      ...(finalJob.prNumber !== undefined
        ? { prNumber: finalJob.prNumber }
        : {}),
      prUrl: finalJob.prUrl,
      ...(finalJob.branchName !== undefined
        ? { branch: finalJob.branchName }
        : {}),
    };
  }

  const error = finalJob?.error ?? 'the patch run did not open a PR';
  await githubClient.createIssueComment({
    issueNumber,
    body: renderFailureComment(error),
  });
  return { outcome: 'patch_failed', issueNumber, feedbackId: item.id, error };
}

const NEVER_MERGES =
  'Every Patchback PR needs a human review — Patchback never merges.';

function renderClarificationComment(question: string | undefined): string {
  return [
    '**Patchback — needs clarification**',
    '',
    'Triage could not confidently turn this into a patch. ' +
      (question !== undefined
        ? `A maintainer can help by answering: ${question}`
        : 'A maintainer should add detail, then re-file.'),
  ].join('\n');
}

function renderNeedsHumanComment(): string {
  return [
    '**Patchback — needs a human**',
    '',
    'Triage classified this as needing a person to handle it, so no patch job ' +
      'was started. (Outsider-tier feedback is data only and never reaches the agent.)',
  ].join('\n');
}

function renderPatchedComment(
  prNumber: number | undefined,
  prUrl: string,
): string {
  const ref = prNumber !== undefined ? `#${prNumber}` : 'a pull request';
  return [`**Patchback opened ${ref}**`, '', prUrl, '', NEVER_MERGES].join(
    '\n',
  );
}

function renderFailureComment(error: string): string {
  return [
    '**Patchback — patch not opened**',
    '',
    'The patch run did not produce a pull request:',
    '',
    '> ' + error.replace(/\n/g, '\n> '),
  ].join('\n');
}
