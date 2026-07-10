/** Thrown when the GitHub REST API answers with a non-2xx status. */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  /** Parsed JSON error body from GitHub, when there was one. */
  readonly responseBody: unknown;

  constructor(options: {
    status: number;
    method: string;
    path: string;
    message: string;
    responseBody?: unknown;
  }) {
    super(
      `GitHub API ${options.method} ${options.path} failed with ${options.status}: ${options.message}`,
    );
    this.name = 'GitHubApiError';
    this.status = options.status;
    this.method = options.method;
    this.path = options.path;
    this.responseBody = options.responseBody;
  }
}
