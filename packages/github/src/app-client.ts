/**
 * GitHub App mode — STUB ONLY.
 *
 * App mode is on the roadmap (BUILD_PLAN Phase 10) and is intentionally not
 * implemented in v0.1. The OSS local-first flow runs on a fine-grained
 * personal access token (see `createTokenClient`). This file only pins down
 * the configuration shape and the factory signature so later phases can
 * depend on the `GitHubClient` interface without caring which mode backs it.
 */
import type { GitHubClient } from './types.js';

export interface GitHubAppConfig {
  appId: string;
  /** PEM-encoded private key for the App. */
  privateKey: string;
  installationId: number;
  owner: string;
  repo: string;
  /** Override for GitHub Enterprise; defaults to https://api.github.com. */
  baseUrl?: string;
}

export class GitHubAppModeNotImplementedError extends Error {
  constructor() {
    super(
      'GitHub App mode is not implemented yet (roadmap: BUILD_PLAN Phase 10). ' +
        'Use token mode via createTokenClient() with a fine-grained personal access token.',
    );
    this.name = 'GitHubAppModeNotImplementedError';
  }
}

/**
 * Placeholder factory. Always throws {@link GitHubAppModeNotImplementedError}.
 * When App mode ships it will return a `GitHubClient` with the exact same
 * surface as token mode.
 */
export function createAppClient(config: GitHubAppConfig): GitHubClient {
  void config;
  throw new GitHubAppModeNotImplementedError();
}
