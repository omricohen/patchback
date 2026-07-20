/**
 * GitHub client contract for Patchback.
 *
 * The surface is exactly what the patch pipeline needs: create an issue for a
 * triaged feedback item, create a working branch, commit the agent's file
 * changes, open a PR, and read the PR's status back. There is deliberately no
 * merge method anywhere on this interface — merging is a human action in the
 * GitHub UI (see CLAUDE.md: no auto-merge, ever).
 */

/** A repository identified by owner login and repo name. */
export interface RepoRef {
  owner: string;
  repo: string;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
}

export interface IssueRef {
  number: number;
  title: string;
  /** Human-facing URL (html_url). */
  url: string;
}

export interface CreateIssueCommentInput {
  /** The issue (or PR) number to comment on. */
  issueNumber: number;
  body: string;
}

export interface IssueCommentRef {
  id: number;
  /** Human-facing URL (html_url). */
  url: string;
}

export interface CreateBranchInput {
  /** New branch name (without the `refs/heads/` prefix). */
  branch: string;
  /**
   * Branch to base the new branch on. Defaults to the repository's default
   * branch.
   */
  from?: string;
}

export interface BranchRef {
  /** Branch name (without the `refs/heads/` prefix). */
  branch: string;
  /** Fully qualified ref, e.g. `refs/heads/patchback/fix-123`. */
  ref: string;
  /** Commit SHA the branch points at. */
  sha: string;
}

/**
 * One file change in a commit. Content is UTF-8 text (the widget/agent
 * pipeline deals in source files). Deletions are explicit.
 */
export type FileChange =
  | {
      path: string;
      content: string;
      /** Git file mode; defaults to a regular file. */
      mode?: '100644' | '100755';
    }
  | {
      path: string;
      delete: true;
    };

export interface CommitFilesInput {
  /** Existing branch to commit onto (without the `refs/heads/` prefix). */
  branch: string;
  message: string;
  /** At least one change is required. */
  files: FileChange[];
}

export interface CommitRef {
  sha: string;
  message: string;
  /** Human-facing URL (html_url). */
  url: string;
}

export interface OpenPullRequestInput {
  title: string;
  /** Head branch name (without the `refs/heads/` prefix). */
  head: string;
  /** Base branch; defaults to the repository's default branch. */
  base?: string;
  body?: string;
  draft?: boolean;
}

export interface PullRequestRef {
  number: number;
  /** Human-facing URL (html_url). */
  url: string;
  head: { branch: string; sha: string };
  base: string;
}

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequestStatus {
  number: number;
  /** `merged` is reported as its own state, never as plain `closed`. */
  state: PullRequestState;
  draft: boolean;
  merged: boolean;
  /** GitHub's mergeable_state (e.g. `clean`, `dirty`, `blocked`), if known. */
  mergeableState?: string;
  headSha: string;
  /** Human-facing URL (html_url). */
  url: string;
}

/**
 * The adapter surface later phases build on. Token mode implements this
 * today; App mode (Phase 10 roadmap) will implement the same interface.
 */
export interface GitHubClient {
  readonly repo: RepoRef;
  createIssue(input: CreateIssueInput): Promise<IssueRef>;
  /**
   * Post a comment on an existing issue (or PR). Used by Action mode to write
   * the triage/patch outcome back to the triggering issue — the durable
   * thread in the stateless CI run. This is a status-back capability only;
   * it grants NO merge power (see the no-merge invariant test).
   */
  createIssueComment(input: CreateIssueCommentInput): Promise<IssueCommentRef>;
  createBranch(input: CreateBranchInput): Promise<BranchRef>;
  commitFiles(input: CommitFilesInput): Promise<CommitRef>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef>;
  getPullRequestStatus(pullNumber: number): Promise<PullRequestStatus>;
}
