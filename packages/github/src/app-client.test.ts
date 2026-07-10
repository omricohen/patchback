import { describe, expect, it } from 'vitest';
import {
  createAppClient,
  GitHubAppModeNotImplementedError,
} from './app-client.js';

describe('GitHub App mode (roadmap stub)', () => {
  it('createAppClient always throws GitHubAppModeNotImplementedError', () => {
    expect(() =>
      createAppClient({
        appId: '12345',
        privateKey:
          '-----BEGIN RSA PRIVATE KEY-----\nplaceholder\n-----END RSA PRIVATE KEY-----',
        installationId: 678,
        owner: 'acme',
        repo: 'widgets',
      }),
    ).toThrow(GitHubAppModeNotImplementedError);
  });

  it('points the caller at token mode', () => {
    const error = new GitHubAppModeNotImplementedError();
    expect(error.name).toBe('GitHubAppModeNotImplementedError');
    expect(error.message).toContain('createTokenClient');
    expect(error.message).toContain('Phase 10');
  });
});
