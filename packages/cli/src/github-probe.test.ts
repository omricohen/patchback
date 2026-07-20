import { describe, expect, it } from 'vitest';

import { probeGitHubToken, probeRepoScripts } from './github-probe.js';

const TOKEN = 'github_pat_test_00000000000000000000';

function fakeFetch(
  handler: (url: string) => { status: number; body?: unknown } | 'network',
): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const result = handler(url);
    if (result === 'network') {
      throw new TypeError('fetch failed');
    }
    return new Response(
      result.body !== undefined ? JSON.stringify(result.body) : null,
      { status: result.status },
    );
  }) as typeof globalThis.fetch;
}

const options = (fetchImpl: typeof globalThis.fetch) => ({
  token: TOKEN,
  owner: 'acme',
  repo: 'webapp',
  fetchImpl,
});

describe('probeGitHubToken — readable bad-token failures', () => {
  it('explains a 401 (invalid/expired token) actionably', async () => {
    const probe = await probeGitHubToken(
      options(fakeFetch(() => ({ status: 401 }))),
    );
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.offline).toBe(false);
      expect(probe.message).toContain('401');
      expect(probe.message).toContain('fine-grained');
      expect(probe.message).toContain('Contents (read and write)');
      expect(probe.message).not.toContain(TOKEN);
    }
  });

  it('explains a 404 (repo not visible to the token)', async () => {
    const probe = await probeGitHubToken(
      options(fakeFetch(() => ({ status: 404 }))),
    );
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.message).toContain('acme/webapp');
      expect(probe.message).toContain('repository selection');
    }
  });

  it('explains missing write permission (read-only scopes)', async () => {
    const probe = await probeGitHubToken(
      options(
        fakeFetch(() => ({
          status: 200,
          body: { permissions: { pull: true, push: false }, has_issues: true },
        })),
      ),
    );
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.message).toContain('cannot write');
      expect(probe.message).toContain('Contents (read AND write)');
    }
  });

  it('warns when issues are disabled but passes the probe', async () => {
    const probe = await probeGitHubToken(
      options(
        fakeFetch(() => ({
          status: 200,
          body: { permissions: { push: true }, has_issues: false },
        })),
      ),
    );
    expect(probe.ok).toBe(true);
    if (probe.ok) {
      expect(probe.warnings.join('\n')).toContain('Issues are disabled');
    }
  });

  it('reports offline as offline (warn-and-continue), not as a bad token', async () => {
    const probe = await probeGitHubToken(options(fakeFetch(() => 'network')));
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.offline).toBe(true);
      expect(probe.message).toContain('offline');
    }
  });

  it('passes a healthy repo with no warnings', async () => {
    const probe = await probeGitHubToken(
      options(
        fakeFetch(() => ({
          status: 200,
          body: { permissions: { push: true, pull: true }, has_issues: true },
        })),
      ),
    );
    expect(probe).toEqual({ ok: true, warnings: [] });
  });

  it('warns (non-fatally) when Deployments read is missing, but still passes', async () => {
    const probe = await probeGitHubToken(
      options(
        fakeFetch((url) =>
          url.includes('/deployments')
            ? { status: 403 }
            : {
                status: 200,
                body: {
                  permissions: { push: true, pull: true },
                  has_issues: true,
                },
              },
        ),
      ),
    );
    expect(probe.ok).toBe(true);
    if (probe.ok) {
      expect(probe.warnings.join('\n')).toContain('Deployments (read)');
      expect(probe.warnings.join('\n')).toContain('preview links');
    }
  });
});

describe('probeRepoScripts — "no test script" is a clear message', () => {
  const packageJson = (scripts: Record<string, string>) => ({
    status: 200,
    body: {
      content: Buffer.from(JSON.stringify({ scripts }), 'utf8').toString(
        'base64',
      ),
    },
  });

  it('flags a repo with no test script', async () => {
    const probe = await probeRepoScripts(
      options(fakeFetch(() => packageJson({ build: 'tsc' }))),
    );
    expect(probe.warnings.join('\n')).toContain('no test script');
    expect(probe.warnings.join('\n')).toContain('will not be verified');
  });

  it('flags the npm scaffold placeholder as no test script', async () => {
    const probe = await probeRepoScripts(
      options(
        fakeFetch(() =>
          packageJson({
            test: 'echo "Error: no test specified" && exit 1',
          }),
        ),
      ),
    );
    expect(probe.warnings.join('\n')).toContain('no test script');
  });

  it('flags a repo without package.json (no check gate at all)', async () => {
    const probe = await probeRepoScripts(
      options(fakeFetch(() => ({ status: 404 }))),
    );
    expect(probe.warnings.join('\n')).toContain('no package.json');
    expect(probe.warnings.join('\n')).toContain('NOT be gated');
  });

  it('stays quiet when a real test script exists', async () => {
    const probe = await probeRepoScripts(
      options(
        fakeFetch(() => packageJson({ test: 'vitest run', lint: 'eslint .' })),
      ),
    );
    expect(probe.warnings).toEqual([]);
    expect(probe.scripts).toContain('test');
  });
});
