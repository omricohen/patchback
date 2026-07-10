/**
 * @patchback/github — GitHub integration for the patch pipeline.
 *
 * Token mode (fine-grained PAT) is the supported mode: issues, branches,
 * commits, pull requests, PR status. App mode is a stub interface only
 * (roadmap, BUILD_PLAN Phase 10). No merge capability exists on purpose.
 */
export * from './types.js';
export * from './errors.js';
export { createTokenClient, type TokenClientOptions } from './token-client.js';
export {
  createAppClient,
  GitHubAppModeNotImplementedError,
  type GitHubAppConfig,
} from './app-client.js';
