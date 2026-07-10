import { describe, expect, it } from 'vitest';
import * as github from './index.js';

describe('@patchback/github exports', () => {
  it('exposes token mode, the App stub, and the error types', () => {
    expect(typeof github.createTokenClient).toBe('function');
    expect(typeof github.createAppClient).toBe('function');
    expect(github.GitHubApiError.prototype).toBeInstanceOf(Error);
    expect(github.GitHubAppModeNotImplementedError.prototype).toBeInstanceOf(
      Error,
    );
  });

  it('exposes no merge capability on the client surface (no auto-merge, ever)', () => {
    const client = github.createTokenClient({
      token: 't',
      owner: 'o',
      repo: 'r',
    });
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    for (const name of surface) {
      expect(name.toLowerCase()).not.toContain('merge');
    }
  });
});
