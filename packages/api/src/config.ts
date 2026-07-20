import type { AgentAdapter } from '@patchback/agent-core';
import type { GitHubClient } from '@patchback/github';
import type { ModelCaller, RepoProbe } from '@patchback/triage';
import {
  canInitiatePatchJob,
  isTrustTier,
  type TrustTier,
} from '@patchback/types';

import type { PatchPipeline } from './pipeline.js';
import { createDefaultPatchPipeline } from './pipeline.js';
import type { TaskQueue } from './queue/queue.js';
import type { Store } from './store/store.js';

/**
 * A configured API key. Tiers are assigned EXCLUSIVELY here, server-side:
 * the request body can never carry, influence, or elevate a tier.
 *
 * Note the type: `outsider` is not configurable for a key — no key IS
 * outsider. Anyone without a (valid) key submits as outsider automatically.
 */
export interface ApiKeyEntry {
  key: string;
  tier: Extract<TrustTier, 'owner' | 'insider'>;
  /** For audit logs. Never the key itself. */
  label?: string;
}

/**
 * Everything `buildServer` and `createWorkers` need. The api package never
 * reads `process.env` — env/config-file loading is the CLI's job (Phase 8).
 *
 * Injectable seams: store, queue, callModel, githubClient, and either a
 * pipeline or an adapter (+ repoSource) from which the default pipeline is
 * built. Dev/test use fakes; nothing here imports a vendor SDK.
 */
export interface ApiConfig {
  store: Store;
  queue: TaskQueue;
  /** The triage model seam — `createAnthropicModelCaller()` in real use. */
  callModel: ModelCaller;
  /** Used by routes for issue creation. NEVER handed to the webhook handler. */
  githubClient: GitHubClient;
  /** API-key → tier map. Empty/absent means every caller is an outsider. */
  apiKeys?: readonly ApiKeyEntry[];
  /**
   * Patch pipeline override (tests inject a fake). When absent, `adapter` and
   * `repoSource` are required and the default pipeline is built from them.
   */
  pipeline?: PatchPipeline;
  /** Agent adapter for the default pipeline (e.g. Claude Code, injected by the CLI). */
  adapter?: AgentAdapter;
  /** Local path or URL `git clone` accepts — the target repo. */
  repoSource?: string;
  /** Base branch PRs target. Defaults to the repo's default branch. */
  baseBranch?: string;
  /**
   * Bounded self-repair after failing checks, for the default pipeline. ON by
   * default (one attempt); set `{ enabled: false }` to fail immediately on the
   * first check failure. The one-attempt cap is fixed in v0.2 and not
   * configurable upward. Ignored when `pipeline` is supplied directly.
   */
  repair?: { enabled?: boolean };
  /**
   * GitHub webhook HMAC secret. The /webhooks/github route is registered
   * ONLY when this is set — there is no "verification disabled" mode.
   */
  webhookSecret?: string;
  /**
   * Cross-origin embedding. OFF by default — the API sends no CORS headers
   * unless the operator lists the exact origins their app is served from
   * (e.g. `http://localhost:3000` for `patchback dev`). A `*` entry is
   * rejected at startup: this API authenticates with bearer tokens, and a
   * wildcard would hand every website a same-credentials surface.
   */
  cors?: { allowedOrigins: readonly string[] };
  /**
   * Operational log line sink (state-transition anomalies worth a human's
   * eyes, e.g. a lost success-path CAS). Defaults to silent — the CLI wires
   * this to its terminal stream. Never receives secrets or request bodies.
   */
  log?: (message: string) => void;
  /** Triage demotion gate, default 0.7 (see @patchback/triage). */
  confidenceThreshold?: number;
  /**
   * Issue-emitting ingest mode for GitHub Action deployments. DEFAULT-OFF:
   * when this field is ABSENT, `POST /feedback` behaves exactly as today
   * (create item + job, enqueue triage) — byte-identical. When SET, the
   * feedback route becomes a thin, stateless, agent-free INGEST: it assigns
   * the tier server-side (unchanged `resolveAuth`), signs an HMAC issue
   * marker binding content+tier+nonce+repo, and opens a labeled GitHub issue
   * for a GitHub Action to pick up. It enqueues no triage and runs no
   * pipeline. Outsider feedback is accepted but NOT emitted as an issue
   * (Action mode has no store to cluster it in) — outsider content never
   * enters the repo. See `packages/api/src/issue-marker.ts`.
   */
  issueEmitter?: {
    /** Symmetric HMAC key shared with the Action's `verifyIssueMarker`. */
    signingSecret: string;
    /** Label applied to the emitted issue (the workflow's trigger filter). Default `patchback`. */
    label?: string;
    /** Freshness window stamped conceptually; the verifier owns the actual check. */
    freshnessWindowMs?: number;
  };
  /**
   * OPTIONAL repo-aware triage stage 2. When set, borderline stage-1 results
   * are re-classified against a deterministic fixed-string probe of a repo
   * working copy (paths + counts only). Only wired where a real on-disk
   * checkout exists at triage time — the CLI's `LocalRepoProbe` over
   * `localRepoPath`. The hosted API worker has no working copy at triage time
   * (the clone happens later, per-patchable-item), so it NEVER sets this and
   * stage 2 is fail-safe dead code there. See @patchback/triage `RepoProbe`.
   */
  repoProbe?: RepoProbe;
  /** Constraints stamped into every task brief. */
  briefConstraints?: readonly string[];
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validate a config at startup — fail closed, loudly, before serving a single
 * request. Config text is outside-the-compiler input: every tier value is
 * re-checked with `isTrustTier` + `canInitiatePatchJob` at runtime.
 */
export function validateConfig(config: ApiConfig): void {
  for (const [index, entry] of (config.apiKeys ?? []).entries()) {
    const label = entry.label ?? `#${index}`;
    if (typeof entry.key !== 'string' || entry.key.length < 16) {
      throw new ConfigError(
        `apiKeys[${label}]: key must be a string of at least 16 characters`,
      );
    }
    if (!isTrustTier(entry.tier) || !canInitiatePatchJob(entry.tier)) {
      throw new ConfigError(
        `apiKeys[${label}]: tier must be "owner" or "insider" — got ` +
          `${JSON.stringify(entry.tier)}. There is no such thing as an ` +
          '"outsider" key: keyless callers are outsiders automatically.',
      );
    }
  }
  const keys = (config.apiKeys ?? []).map((entry) => entry.key);
  if (new Set(keys).size !== keys.length) {
    throw new ConfigError('apiKeys: duplicate key values are not allowed');
  }
  if (config.webhookSecret !== undefined && config.webhookSecret.length < 16) {
    throw new ConfigError(
      'webhookSecret must be at least 16 characters when set',
    );
  }
  if (config.cors !== undefined) {
    if (config.cors.allowedOrigins.length === 0) {
      throw new ConfigError(
        'cors.allowedOrigins must list at least one origin when cors is ' +
          'configured — omit `cors` entirely to disable cross-origin access',
      );
    }
    for (const origin of config.cors.allowedOrigins) {
      if (origin === '*' || origin.includes('*')) {
        throw new ConfigError(
          'cors.allowedOrigins must list exact origins — a wildcard is not ' +
            'allowed on an API that authenticates with bearer tokens',
        );
      }
      if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
        throw new ConfigError(
          `cors.allowedOrigins: ${JSON.stringify(origin)} is not an origin — ` +
            'expected scheme://host[:port] with no path, e.g. "http://localhost:3000"',
        );
      }
    }
  }
  if (
    config.confidenceThreshold !== undefined &&
    !(config.confidenceThreshold >= 0 && config.confidenceThreshold <= 1)
  ) {
    throw new ConfigError('confidenceThreshold must be within [0, 1]');
  }
  if (config.issueEmitter !== undefined) {
    if (
      typeof config.issueEmitter.signingSecret !== 'string' ||
      config.issueEmitter.signingSecret.length < 16
    ) {
      throw new ConfigError(
        'issueEmitter.signingSecret must be a string of at least 16 characters',
      );
    }
  }
  // The issue-emitting ingest runs no pipeline (it emits an issue for a
  // GitHub Action to process), so it does not require a pipeline/adapter.
  if (config.issueEmitter === undefined && config.pipeline === undefined) {
    if (config.adapter === undefined || config.repoSource === undefined) {
      throw new ConfigError(
        'either `pipeline` or both `adapter` and `repoSource` must be configured',
      );
    }
  }
}

/** The pipeline to run patch jobs with — explicit override or default wiring. */
export function resolvePipeline(config: ApiConfig): PatchPipeline {
  if (config.pipeline !== undefined) {
    return config.pipeline;
  }
  if (config.adapter === undefined || config.repoSource === undefined) {
    throw new ConfigError(
      'either `pipeline` or both `adapter` and `repoSource` must be configured',
    );
  }
  return createDefaultPatchPipeline({
    adapter: config.adapter,
    githubClient: config.githubClient,
    repoSource: config.repoSource,
    ...(config.baseBranch !== undefined
      ? { baseBranch: config.baseBranch }
      : {}),
    ...(config.log !== undefined ? { log: config.log } : {}),
    ...(config.repair !== undefined ? { repair: config.repair } : {}),
  });
}
