import { GitHubApiError } from './errors.js';
import type {
  BranchRef,
  CommitFilesInput,
  CommitRef,
  CreateBranchInput,
  CreateIssueInput,
  FileChange,
  GitHubClient,
  IssueRef,
  OpenPullRequestInput,
  PullRequestRef,
  PullRequestStatus,
  RepoRef,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const DEFAULT_USER_AGENT = 'patchback';

export interface TokenClientOptions {
  /**
   * Fine-grained personal access token. Minimum scopes are documented in this
   * package's README (contents, issues, pull requests read/write; metadata
   * read).
   */
  token: string;
  owner: string;
  repo: string;
  /** Override for GitHub Enterprise; defaults to https://api.github.com. */
  baseUrl?: string;
  /** Injectable for tests; defaults to the global fetch (Node 20+). */
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
}

/** Create a {@link GitHubClient} backed by a fine-grained personal access token. */
export function createTokenClient(options: TokenClientOptions): GitHubClient {
  return new TokenGitHubClient(options);
}

/** Tree entry shape for POST /git/trees. `sha: null` deletes the path. */
interface TreeEntry {
  path: string;
  mode: '100644' | '100755';
  type: 'blob';
  content?: string;
  sha?: null;
}

class TokenGitHubClient implements GitHubClient {
  readonly repo: RepoRef;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userAgent: string;
  private defaultBranch: string | undefined;

  constructor(options: TokenClientOptions) {
    for (const field of ['token', 'owner', 'repo'] as const) {
      if (!options[field] || options[field].trim() === '') {
        throw new TypeError(`TokenClientOptions.${field} is required`);
      }
    }
    this.token = options.token;
    this.repo = { owner: options.owner, repo: options.repo };
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async createIssue(input: CreateIssueInput): Promise<IssueRef> {
    const issue = await this.request<{
      number: number;
      title: string;
      html_url: string;
    }>('POST', this.repoPath('/issues'), {
      title: input.title,
      body: input.body,
      labels: input.labels,
    });
    return { number: issue.number, title: issue.title, url: issue.html_url };
  }

  async createBranch(input: CreateBranchInput): Promise<BranchRef> {
    const from = input.from ?? (await this.getDefaultBranch());
    const baseSha = await this.getBranchHeadSha(from);
    const created = await this.request<{
      ref: string;
      object: { sha: string };
    }>('POST', this.repoPath('/git/refs'), {
      ref: `refs/heads/${input.branch}`,
      sha: baseSha,
    });
    return { branch: input.branch, ref: created.ref, sha: created.object.sha };
  }

  async commitFiles(input: CommitFilesInput): Promise<CommitRef> {
    if (input.files.length === 0) {
      throw new TypeError('commitFiles requires at least one file change');
    }

    // Git data API: read the branch head, build a tree on top of it, create a
    // commit, then fast-forward the branch ref (no force).
    const parentSha = await this.getBranchHeadSha(input.branch);
    const parent = await this.request<{ tree: { sha: string } }>(
      'GET',
      this.repoPath(`/git/commits/${parentSha}`),
    );
    const tree = await this.request<{ sha: string }>(
      'POST',
      this.repoPath('/git/trees'),
      {
        base_tree: parent.tree.sha,
        tree: input.files.map(toTreeEntry),
      },
    );
    const commit = await this.request<{
      sha: string;
      message: string;
      html_url: string;
    }>('POST', this.repoPath('/git/commits'), {
      message: input.message,
      tree: tree.sha,
      parents: [parentSha],
    });
    await this.request(
      'PATCH',
      this.repoPath(`/git/refs/heads/${input.branch}`),
      {
        sha: commit.sha,
      },
    );
    return { sha: commit.sha, message: commit.message, url: commit.html_url };
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef> {
    const base = input.base ?? (await this.getDefaultBranch());
    const pr = await this.request<{
      number: number;
      html_url: string;
      head: { ref: string; sha: string };
      base: { ref: string };
    }>('POST', this.repoPath('/pulls'), {
      title: input.title,
      head: input.head,
      base,
      body: input.body,
      draft: input.draft ?? false,
    });
    return {
      number: pr.number,
      url: pr.html_url,
      head: { branch: pr.head.ref, sha: pr.head.sha },
      base: pr.base.ref,
    };
  }

  async getPullRequestStatus(pullNumber: number): Promise<PullRequestStatus> {
    const pr = await this.request<{
      number: number;
      state: 'open' | 'closed';
      draft: boolean;
      merged: boolean;
      mergeable_state?: string;
      head: { sha: string };
      html_url: string;
    }>('GET', this.repoPath(`/pulls/${pullNumber}`));
    return {
      number: pr.number,
      state: pr.merged ? 'merged' : pr.state,
      draft: pr.draft,
      merged: pr.merged,
      mergeableState: pr.mergeable_state,
      headSha: pr.head.sha,
      url: pr.html_url,
    };
  }

  private repoPath(suffix: string): string {
    return `/repos/${this.repo.owner}/${this.repo.repo}${suffix}`;
  }

  private async getDefaultBranch(): Promise<string> {
    if (this.defaultBranch === undefined) {
      const repo = await this.request<{ default_branch: string }>(
        'GET',
        this.repoPath(''),
      );
      this.defaultBranch = repo.default_branch;
    }
    return this.defaultBranch;
  }

  private async getBranchHeadSha(branch: string): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      'GET',
      this.repoPath(`/git/ref/heads/${branch}`),
    );
    return ref.object.sha;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'x-github-api-version': API_VERSION,
      'user-agent': this.userAgent,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = undefined;
      }
      throw new GitHubApiError({
        status: response.status,
        method,
        path,
        message: extractErrorMessage(parsed) ?? response.statusText,
        responseBody: parsed,
      });
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

function toTreeEntry(file: FileChange): TreeEntry {
  if ('delete' in file) {
    return { path: file.path, mode: '100644', type: 'blob', sha: null };
  }
  return {
    path: file.path,
    mode: file.mode ?? '100644',
    type: 'blob',
    content: file.content,
  };
}

function extractErrorMessage(body: unknown): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof (body as { message: unknown }).message === 'string'
  ) {
    return (body as { message: string }).message;
  }
  return undefined;
}
