import { describe, expect, it } from 'vitest';
import { GitHubApiError } from './errors.js';
import { createTokenClient } from './token-client.js';

/** One recorded request made through the mock fetch. */
interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type RouteResponse = { status?: number; body: unknown };

/**
 * Minimal injectable fetch: routes keyed by `"METHOD /path"`, every request
 * recorded. Unrouted requests fail the test loudly.
 */
function mockFetch(routes: Record<string, RouteResponse>) {
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    requests.push({
      method,
      path: url.pathname,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const route = routes[key];
    if (!route) {
      throw new Error(`mockFetch: no route for "${key}"`);
    }
    return Promise.resolve(
      new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetch, requests };
}

const OWNER = 'acme';
const REPO = 'widgets';
const BASE = `/repos/${OWNER}/${REPO}`;

function client(routes: Record<string, RouteResponse>) {
  const { fetch, requests } = mockFetch(routes);
  return {
    client: createTokenClient({
      token: 'ghp_test',
      owner: OWNER,
      repo: REPO,
      fetch,
    }),
    requests,
  };
}

describe('createTokenClient options', () => {
  it.each(['token', 'owner', 'repo'] as const)(
    'rejects a missing %s',
    (field) => {
      const options = { token: 't', owner: 'o', repo: 'r', [field]: '' };
      expect(() => createTokenClient(options)).toThrow(
        new TypeError(`TokenClientOptions.${field} is required`),
      );
    },
  );

  it('exposes the repo it was constructed for', () => {
    const { client: gh } = client({});
    expect(gh.repo).toEqual({ owner: OWNER, repo: REPO });
  });
});

describe('request headers', () => {
  it('sends auth, accept, api-version, and user-agent headers', async () => {
    const { client: gh, requests } = client({
      [`POST ${BASE}/issues`]: {
        status: 201,
        body: { number: 1, title: 't', html_url: 'u' },
      },
    });
    await gh.createIssue({ title: 't' });
    const headers = requests[0]!.headers;
    expect(headers['authorization']).toBe('Bearer ghp_test');
    expect(headers['accept']).toBe('application/vnd.github+json');
    expect(headers['x-github-api-version']).toBe('2022-11-28');
    expect(headers['user-agent']).toBe('patchback');
    expect(headers['content-type']).toBe('application/json');
  });
});

describe('createIssue', () => {
  it('posts title, body, and labels and returns the issue ref', async () => {
    const { client: gh, requests } = client({
      [`POST ${BASE}/issues`]: {
        status: 201,
        body: {
          number: 42,
          title: 'Fix the label',
          html_url: 'https://github.com/acme/widgets/issues/42',
        },
      },
    });
    const issue = await gh.createIssue({
      title: 'Fix the label',
      body: 'Reported via widget',
      labels: ['patchback'],
    });
    expect(issue).toEqual({
      number: 42,
      title: 'Fix the label',
      url: 'https://github.com/acme/widgets/issues/42',
    });
    expect(requests[0]!.body).toEqual({
      title: 'Fix the label',
      body: 'Reported via widget',
      labels: ['patchback'],
    });
  });

  it('throws GitHubApiError with status and GitHub message on failure', async () => {
    const { client: gh } = client({
      [`POST ${BASE}/issues`]: {
        status: 404,
        body: { message: 'Not Found' },
      },
    });
    const error = await gh
      .createIssue({ title: 'x' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    const apiError = error as GitHubApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.method).toBe('POST');
    expect(apiError.path).toBe(`${BASE}/issues`);
    expect(apiError.message).toContain('Not Found');
    expect(apiError.responseBody).toEqual({ message: 'Not Found' });
  });
});

describe('createIssueComment', () => {
  it('posts the comment body to the issue and returns the comment ref', async () => {
    const { client: gh, requests } = client({
      [`POST ${BASE}/issues/42/comments`]: {
        status: 201,
        body: {
          id: 987,
          html_url:
            'https://github.com/acme/widgets/issues/42#issuecomment-987',
        },
      },
    });
    const comment = await gh.createIssueComment({
      issueNumber: 42,
      body: 'Patchback opened a PR.',
    });
    expect(comment).toEqual({
      id: 987,
      url: 'https://github.com/acme/widgets/issues/42#issuecomment-987',
    });
    expect(requests[0]!.body).toEqual({ body: 'Patchback opened a PR.' });
  });
});

describe('createBranch', () => {
  it('resolves the default branch when `from` is omitted', async () => {
    const { client: gh, requests } = client({
      [`GET ${BASE}`]: { body: { default_branch: 'main' } },
      [`GET ${BASE}/git/ref/heads/main`]: {
        body: { object: { sha: 'base-sha' } },
      },
      [`POST ${BASE}/git/refs`]: {
        status: 201,
        body: {
          ref: 'refs/heads/patchback/fix-1',
          object: { sha: 'base-sha' },
        },
      },
    });
    const branch = await gh.createBranch({ branch: 'patchback/fix-1' });
    expect(branch).toEqual({
      branch: 'patchback/fix-1',
      ref: 'refs/heads/patchback/fix-1',
      sha: 'base-sha',
    });
    const post = requests.find((r) => r.method === 'POST');
    expect(post!.body).toEqual({
      ref: 'refs/heads/patchback/fix-1',
      sha: 'base-sha',
    });
  });

  it('branches from an explicit `from` without looking up the repo', async () => {
    const { client: gh, requests } = client({
      [`GET ${BASE}/git/ref/heads/develop`]: {
        body: { object: { sha: 'dev-sha' } },
      },
      [`POST ${BASE}/git/refs`]: {
        status: 201,
        body: { ref: 'refs/heads/feature', object: { sha: 'dev-sha' } },
      },
    });
    await gh.createBranch({ branch: 'feature', from: 'develop' });
    expect(requests.some((r) => r.method === 'GET' && r.path === BASE)).toBe(
      false,
    );
  });

  it('caches the default branch across calls', async () => {
    const { client: gh, requests } = client({
      [`GET ${BASE}`]: { body: { default_branch: 'main' } },
      [`GET ${BASE}/git/ref/heads/main`]: {
        body: { object: { sha: 'sha' } },
      },
      [`POST ${BASE}/git/refs`]: {
        status: 201,
        body: { ref: 'refs/heads/a', object: { sha: 'sha' } },
      },
    });
    await gh.createBranch({ branch: 'a' });
    await gh.createBranch({ branch: 'a' });
    const repoLookups = requests.filter(
      (r) => r.method === 'GET' && r.path === BASE,
    );
    expect(repoLookups).toHaveLength(1);
  });
});

describe('commitFiles', () => {
  const routes = () => ({
    [`GET ${BASE}/git/ref/heads/work`]: {
      body: { object: { sha: 'parent-sha' } },
    },
    [`GET ${BASE}/git/commits/parent-sha`]: {
      body: { tree: { sha: 'base-tree-sha' } },
    },
    [`POST ${BASE}/git/trees`]: {
      status: 201,
      body: { sha: 'new-tree-sha' },
    },
    [`POST ${BASE}/git/commits`]: {
      status: 201,
      body: {
        sha: 'new-commit-sha',
        message: 'update copy',
        html_url: 'https://github.com/acme/widgets/commit/new-commit-sha',
      },
    },
    [`PATCH ${BASE}/git/refs/heads/work`]: {
      body: { ref: 'refs/heads/work', object: { sha: 'new-commit-sha' } },
    },
  });

  it('creates a tree on the parent commit, commits it, and fast-forwards the ref', async () => {
    const { client: gh, requests } = client(routes());
    const commit = await gh.commitFiles({
      branch: 'work',
      message: 'update copy',
      files: [
        { path: 'src/app.ts', content: 'export const label = "Save";\n' },
        { path: 'src/old.ts', delete: true },
        { path: 'bin/run.sh', content: '#!/bin/sh\n', mode: '100755' },
      ],
    });

    expect(commit).toEqual({
      sha: 'new-commit-sha',
      message: 'update copy',
      url: 'https://github.com/acme/widgets/commit/new-commit-sha',
    });

    const treePost = requests.find((r) => r.path === `${BASE}/git/trees`);
    expect(treePost!.body).toEqual({
      base_tree: 'base-tree-sha',
      tree: [
        {
          path: 'src/app.ts',
          mode: '100644',
          type: 'blob',
          content: 'export const label = "Save";\n',
        },
        { path: 'src/old.ts', mode: '100644', type: 'blob', sha: null },
        {
          path: 'bin/run.sh',
          mode: '100755',
          type: 'blob',
          content: '#!/bin/sh\n',
        },
      ],
    });

    const commitPost = requests.find(
      (r) => r.path === `${BASE}/git/commits` && r.method === 'POST',
    );
    expect(commitPost!.body).toEqual({
      message: 'update copy',
      tree: 'new-tree-sha',
      parents: ['parent-sha'],
    });

    const refPatch = requests.find((r) => r.method === 'PATCH');
    expect(refPatch!.path).toBe(`${BASE}/git/refs/heads/work`);
    expect(refPatch!.body).toEqual({ sha: 'new-commit-sha' });
  });

  it('rejects an empty file list before any request', async () => {
    const { client: gh, requests } = client({});
    await expect(
      gh.commitFiles({ branch: 'work', message: 'noop', files: [] }),
    ).rejects.toThrow('commitFiles requires at least one file change');
    expect(requests).toHaveLength(0);
  });
});

describe('openPullRequest', () => {
  it('defaults base to the repository default branch', async () => {
    const { client: gh, requests } = client({
      [`GET ${BASE}`]: { body: { default_branch: 'main' } },
      [`POST ${BASE}/pulls`]: {
        status: 201,
        body: {
          number: 7,
          html_url: 'https://github.com/acme/widgets/pull/7',
          head: { ref: 'patchback/fix-1', sha: 'head-sha' },
          base: { ref: 'main' },
        },
      },
    });
    const pr = await gh.openPullRequest({
      title: 'Fix the label',
      head: 'patchback/fix-1',
      body: 'Automated patch',
    });
    expect(pr).toEqual({
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
      head: { branch: 'patchback/fix-1', sha: 'head-sha' },
      base: 'main',
    });
    const post = requests.find((r) => r.method === 'POST');
    expect(post!.body).toEqual({
      title: 'Fix the label',
      head: 'patchback/fix-1',
      base: 'main',
      body: 'Automated patch',
      draft: false,
    });
  });

  it('honors an explicit base and draft flag', async () => {
    const { client: gh, requests } = client({
      [`POST ${BASE}/pulls`]: {
        status: 201,
        body: {
          number: 8,
          html_url: 'u',
          head: { ref: 'h', sha: 's' },
          base: { ref: 'release' },
        },
      },
    });
    await gh.openPullRequest({
      title: 't',
      head: 'h',
      base: 'release',
      draft: true,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toMatchObject({ base: 'release', draft: true });
  });
});

describe('getPullRequestStatus', () => {
  const prBody = (overrides: Record<string, unknown>) => ({
    number: 7,
    state: 'open',
    draft: false,
    merged: false,
    mergeable_state: 'clean',
    head: { sha: 'head-sha' },
    html_url: 'https://github.com/acme/widgets/pull/7',
    ...overrides,
  });

  it('reports an open PR', async () => {
    const { client: gh } = client({
      [`GET ${BASE}/pulls/7`]: { body: prBody({}) },
    });
    expect(await gh.getPullRequestStatus(7)).toEqual({
      number: 7,
      state: 'open',
      draft: false,
      merged: false,
      mergeableState: 'clean',
      headSha: 'head-sha',
      url: 'https://github.com/acme/widgets/pull/7',
    });
  });

  it('reports a merged PR as state "merged", not "closed"', async () => {
    const { client: gh } = client({
      [`GET ${BASE}/pulls/7`]: {
        body: prBody({ state: 'closed', merged: true }),
      },
    });
    const status = await gh.getPullRequestStatus(7);
    expect(status.state).toBe('merged');
    expect(status.merged).toBe(true);
  });

  it('reports a closed-unmerged PR as "closed"', async () => {
    const { client: gh } = client({
      [`GET ${BASE}/pulls/7`]: { body: prBody({ state: 'closed' }) },
    });
    expect((await gh.getPullRequestStatus(7)).state).toBe('closed');
  });
});
