import type { AgentAdapter } from '@patchback/agent-core';
import type { GitHubClient } from '@patchback/github';
import type { ModelCaller } from '@patchback/triage';
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
   * GitHub webhook HMAC secret. The /webhooks/github route is registered
   * ONLY when this is set — there is no "verification disabled" mode.
   */
  webhookSecret?: string;
  /** Triage demotion gate, default 0.7 (see @patchback/triage). */
  confidenceThreshold?: number;
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
  if (
    config.confidenceThreshold !== undefined &&
    !(config.confidenceThreshold >= 0 && config.confidenceThreshold <= 1)
  ) {
    throw new ConfigError('confidenceThreshold must be within [0, 1]');
  }
  if (config.pipeline === undefined) {
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
  });
}
