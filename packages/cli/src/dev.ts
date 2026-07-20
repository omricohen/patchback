import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type {
  ApiConfig,
  PatchPipeline,
  Store,
  TaskQueue,
} from '@patchback/api';
import {
  buildServer,
  createWorkers,
  MemoryQueue,
  MemoryStore,
} from '@patchback/api';
import type { AgentAdapter } from '@patchback/agent-core';
import { createClaudeCodeAdapter } from '@patchback/agent-claude-code';
import type { GitHubClient } from '@patchback/github';
import { createTokenClient } from '@patchback/github';
import type { ModelCaller, RepoProbe } from '@patchback/triage';
import { createAnthropicModelCaller } from '@patchback/triage';
import type { FastifyInstance } from 'fastify';

import { parseRepoRef, type PatchbackConfig } from './config-file.js';
import { createLocalRepoProbe } from './repo-probe.js';
import { CliError } from './errors.js';
import { probeGitHubToken, probeRepoScripts } from './github-probe.js';
import {
  createDevLogger,
  instrumentStore,
  type DevLogger,
  type InstrumentedStore,
  type LogSink,
} from './logging.js';
import { startPrPoller, type PrPoller } from './pr-poller.js';
import { buildWidgetSnippet } from './snippet.js';

/**
 * `patchback dev` composition: the REAL api server + workers in one process,
 * memory store + memory queue (no Redis, no Postgres), the Claude Code
 * adapter, the Anthropic triage caller, and the GitHub token client — every
 * piece injectable so the e2e test runs the identical composition over
 * fakes.
 */
export interface DevSecrets {
  githubToken?: string;
  anthropicApiKey?: string;
}

export interface DevSeams {
  store?: Store;
  queue?: TaskQueue;
  callModel?: ModelCaller;
  githubClient?: GitHubClient;
  pipeline?: PatchPipeline;
  adapter?: AgentAdapter;
  fetchImpl?: typeof globalThis.fetch;
  /** Skip the startup GitHub probes (implied when githubClient is injected). */
  skipProbes?: boolean;
  pollIntervalMs?: number;
  /** Repo-aware triage probe override (tests inject a fake). */
  repoProbe?: RepoProbe;
}

export interface DevOptions {
  config: PatchbackConfig;
  secrets?: DevSecrets;
  /** Port override; 0 lets the OS pick (tests). */
  port?: number;
  sink?: LogSink;
  color?: boolean;
  seams?: DevSeams;
}

export interface DevHandle {
  address: string;
  app: FastifyInstance;
  store: InstrumentedStore;
  queue: TaskQueue;
  logger: DevLogger;
  keys: { owner: string; insider: string };
  snippet: string;
  poller: PrPoller;
  close(): Promise<void>;
}

function mintDevKey(label: string): string {
  return `pb-dev-${label}-${randomBytes(12).toString('hex')}`;
}

/** Locate the widget IIFE bundle shipped by @patchback/widget. */
export function resolveWidgetBundlePath(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@patchback/widget');
    const bundle = path.join(path.dirname(entry), 'patchback-widget.iife.js');
    return existsSync(bundle) ? bundle : undefined;
  } catch {
    return undefined;
  }
}

export async function runDev(options: DevOptions): Promise<DevHandle> {
  const { config } = options;
  const secrets = options.secrets ?? {};
  const seams = options.seams ?? {};
  const repo = parseRepoRef(config.repo);
  const sink = options.sink ?? ((line: string): void => console.log(line));

  const logger = createDevLogger({
    sink,
    secrets: [secrets.githubToken, secrets.anthropicApiKey],
    color: options.color ?? false,
  });

  // --- GitHub client (+ readable-failure probes) ---------------------------
  let githubClient = seams.githubClient;
  if (githubClient === undefined) {
    if (secrets.githubToken === undefined || secrets.githubToken === '') {
      throw new CliError(
        'GITHUB_TOKEN is not set. Put it in .env (see `patchback init`) or ' +
          'export it in your shell. Patchback needs a fine-grained token to ' +
          'file issues, push branches, and open PRs.',
      );
    }
    if (seams.skipProbes !== true) {
      const probe = await probeGitHubToken({
        token: secrets.githubToken,
        owner: repo.owner,
        repo: repo.name,
        ...(seams.fetchImpl !== undefined
          ? { fetchImpl: seams.fetchImpl }
          : {}),
      });
      if (!probe.ok) {
        if (probe.offline) {
          logger.warn(probe.message);
        } else {
          throw new CliError(probe.message);
        }
      } else {
        for (const warning of probe.warnings) {
          logger.warn(warning);
        }
        const scriptsProbe = await probeRepoScripts({
          token: secrets.githubToken,
          owner: repo.owner,
          repo: repo.name,
          ...(seams.fetchImpl !== undefined
            ? { fetchImpl: seams.fetchImpl }
            : {}),
        });
        for (const warning of scriptsProbe.warnings) {
          logger.warn(warning);
        }
      }
    }
    githubClient = createTokenClient({
      token: secrets.githubToken,
      owner: repo.owner,
      repo: repo.name,
    });
  }

  // --- Agent + triage seams ------------------------------------------------
  const needsAnthropic =
    seams.callModel === undefined ||
    (seams.pipeline === undefined && seams.adapter === undefined);
  if (
    needsAnthropic &&
    (secrets.anthropicApiKey === undefined || secrets.anthropicApiKey === '')
  ) {
    throw new CliError(
      'ANTHROPIC_API_KEY is not set. Put it in .env (see `patchback init`) ' +
        'or export it in your shell. Patchback needs it for triage and for ' +
        'the Claude Code agent.',
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

  // The clone URL embeds the token for private repos. It must NEVER be
  // printed: the logger and the instrumented store scrub the token from
  // every log line, job error, and history note as defense in depth.
  const repoSource =
    config.localRepoPath ??
    (secrets.githubToken !== undefined && secrets.githubToken !== ''
      ? `https://x-access-token:${secrets.githubToken}@github.com/${repo.owner}/${repo.name}.git`
      : `https://github.com/${repo.owner}/${repo.name}.git`);

  // Repo-aware triage stage 2 is enabled iff a real on-disk working copy
  // exists at triage time — i.e. `localRepoPath` is a real directory. A GitHub
  // URL is a clone SOURCE, not a working copy, so it wires no probe (stage 2
  // stays off, behaviour byte-identical to today). Presence of the probe IS the
  // switch — there is no separate "enable retrieval" flag.
  let repoProbe: RepoProbe | undefined = seams.repoProbe;
  let repoProbeActive = repoProbe !== undefined;
  if (repoProbe === undefined && config.localRepoPath !== undefined) {
    try {
      if (statSync(config.localRepoPath).isDirectory()) {
        repoProbe = createLocalRepoProbe(config.localRepoPath);
        repoProbeActive = true;
      }
    } catch {
      // Not a real directory — leave stage 2 off (fail-safe).
    }
  }

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

  // --- Store, queue, keys, server ------------------------------------------
  const store = instrumentStore(seams.store ?? new MemoryStore(), logger);
  const queue = seams.queue ?? new MemoryQueue();
  const keys = { owner: mintDevKey('owner'), insider: mintDevKey('insider') };

  const apiConfig: ApiConfig = {
    store,
    queue,
    callModel,
    githubClient,
    apiKeys: [
      { key: keys.owner, tier: 'owner', label: 'dev-owner' },
      { key: keys.insider, tier: 'insider', label: 'dev-insider' },
    ],
    ...(config.appOrigins !== undefined && config.appOrigins.length > 0
      ? { cors: { allowedOrigins: config.appOrigins } }
      : {}),
    ...(repoProbe !== undefined ? { repoProbe } : {}),
    log: (message) => logger.warn(message),
    ...pipelineOrAdapter,
  };

  if (repoProbeActive) {
    // One line so the operator knows a borderline item may trigger a second
    // (retrieval) triage model call. Never prints file contents or matches.
    logger.warn(
      'repo-aware triage: on — borderline items probe the local working copy ' +
        '(paths + counts only; see the working-copy-skew note in OPEN_ISSUES)',
    );
  }

  const app = buildServer(apiConfig);

  const bundlePath = resolveWidgetBundlePath();
  app.get('/widget.js', async (_request, reply) => {
    if (bundlePath === undefined) {
      return reply
        .status(404)
        .type('text/plain; charset=utf-8')
        .send(
          'The widget bundle is not built. In the patchback repo run `pnpm build`.',
        );
    }
    const source = await readFile(bundlePath, 'utf8');
    return reply
      .header('cache-control', 'no-store')
      .type('text/javascript; charset=utf-8')
      .send(source);
  });

  // Registered before listen; the snippet text needs the bound address, so
  // the route reads it through this box.
  let snippet = '';
  app.get('/snippet', async (_request, reply) => {
    return reply.type('text/plain; charset=utf-8').send(`${snippet}\n`);
  });

  createWorkers(apiConfig);

  const port = options.port ?? config.port ?? 8787;
  const address = await app.listen({ port, host: '127.0.0.1' });
  snippet = buildWidgetSnippet({ apiUrl: address, apiKey: keys.insider });

  const poller = startPrPoller({
    store,
    githubClient,
    jobIds: () => store.jobIds,
    logger,
    ...(seams.pollIntervalMs !== undefined
      ? { intervalMs: seams.pollIntervalMs }
      : {}),
  });

  let closed = false;
  return {
    address,
    app,
    store,
    queue,
    logger,
    keys,
    snippet,
    poller,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      poller.stop();
      await app.close();
      await queue.close();
    },
  };
}

/** The startup banner — everything a first-time user needs, zero secrets. */
export function renderDevBanner(handle: DevHandle, repo: string): string {
  const divider = '─'.repeat(64);
  return [
    '',
    divider,
    `  Patchback dev is running → ${handle.address}`,
    `  Target repo: ${repo} (in-memory mode; no Redis, no Postgres)`,
    '',
    '  Paste this into your app (dev pages only):',
    '',
    ...handle.snippet.split('\n').map((line) => `    ${line}`),
    '',
    `  Snippet endpoint:  ${handle.address}/snippet`,
    `  Widget bundle:     ${handle.address}/widget.js`,
    `  Dev API keys (this run only) — owner: ${handle.keys.owner}`,
    `                                 insider: ${handle.keys.insider}`,
    '',
    '  Every PR needs a human review — Patchback never merges.',
    '  Press Ctrl+C to stop.',
    divider,
    '',
  ].join('\n');
}
