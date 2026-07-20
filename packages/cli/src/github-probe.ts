/**
 * Startup probes against the GitHub API — turn "bad token scopes" into an
 * actionable sentence BEFORE the first patch job fails obscurely. Injectable
 * fetch (repo convention); no octokit.
 *
 * Fine-grained tokens do not expose scopes for introspection, so the probe
 * reads what it can observe: can the token see the repo at all (metadata
 * read), does it report push permission (contents write), are issues enabled.
 */

const DEFAULT_BASE_URL = 'https://api.github.com';

export interface ProbeOptions {
  token: string;
  owner: string;
  repo: string;
  fetchImpl?: typeof globalThis.fetch;
  baseUrl?: string;
}

export type TokenProbeResult =
  | { ok: true; warnings: string[] }
  | { ok: false; offline: boolean; message: string };

const REQUIRED_PERMISSIONS =
  'The token needs, for this repository: Contents (read and write), ' +
  'Issues (read and write), Pull requests (read and write), Metadata (read).';

function tokenHint(owner: string, repo: string): string {
  return (
    'Create a fine-grained personal access token at ' +
    'https://github.com/settings/personal-access-tokens with access to ' +
    `${owner}/${repo}. ${REQUIRED_PERMISSIONS}`
  );
}

export async function probeGitHubToken(
  options: ProbeOptions,
): Promise<TokenProbeResult> {
  const { token, owner, repo } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  let response: Awaited<ReturnType<typeof fetchImpl>>;
  try {
    response = await fetchImpl(`${baseUrl}/repos/${owner}/${repo}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'patchback-cli',
      },
    });
  } catch {
    return {
      ok: false,
      offline: true,
      message:
        `Could not reach ${baseUrl} — are you offline? ` +
        'Token validation was skipped; GitHub calls will fail until you are online.',
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      offline: false,
      message:
        'GitHub rejected the token (401 Unauthorized) — it is invalid, ' +
        `expired, or revoked. ${tokenHint(owner, repo)}`,
    };
  }
  if (response.status === 403) {
    return {
      ok: false,
      offline: false,
      message:
        `GitHub refused the request for ${owner}/${repo} (403 Forbidden) — ` +
        'the token may be rate-limited or blocked by an organization policy ' +
        '(e.g. SAML SSO authorization). Check the organization settings for ' +
        `fine-grained token access, then retry. ${tokenHint(owner, repo)}`,
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      offline: false,
      message:
        `The token cannot see ${owner}/${repo} (404). Fine-grained tokens ` +
        'only see repositories they were explicitly granted — check the ' +
        `repository selection on the token, and that Metadata (read) is ` +
        `granted. Also verify the repo name is spelled right. ${tokenHint(owner, repo)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      offline: false,
      message: `GitHub returned HTTP ${response.status} probing ${owner}/${repo}. ${tokenHint(owner, repo)}`,
    };
  }

  let body: {
    permissions?: { push?: boolean; pull?: boolean };
    has_issues?: boolean;
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.permissions !== undefined && body.permissions.push !== true) {
    return {
      ok: false,
      offline: false,
      message:
        `The token can read ${owner}/${repo} but cannot write to it — ` +
        'Patchback needs to create branches and commits. Grant the token ' +
        `Contents (read AND write) for this repository. ${REQUIRED_PERMISSIONS}`,
    };
  }

  const warnings: string[] = [];
  if (body.has_issues === false) {
    warnings.push(
      `Issues are disabled on ${owner}/${repo} — Patchback files a GitHub ` +
        'issue for every patch job, so job starts will fail. Enable issues ' +
        'in the repository settings.',
    );
  }

  // Best-effort, non-fatal: probe read access to the Deployments API. Without
  // the OPTIONAL "Deployments (read)" permission, preview links simply never
  // appear (graceful absence) — everything else works. A 403 here strongly
  // indicates the permission is missing; 404/other are treated as "no signal".
  try {
    const deployments = await fetchImpl(
      `${baseUrl}/repos/${owner}/${repo}/deployments?per_page=1`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'patchback-cli',
        },
      },
    );
    if (deployments.status === 403) {
      warnings.push(
        `The token cannot read deployments for ${owner}/${repo} — the ` +
          'optional "Deployments (read)" permission is not granted, so ' +
          'Patchback will not surface preview links in the widget. Everything ' +
          'else works; grant Deployments (read) if you want preview links.',
      );
    }
  } catch {
    // Offline or transient — the token probe above already reports offline.
  }

  return { ok: true, warnings };
}

export interface RepoScriptsProbe {
  /** Human-readable findings; empty means the repo looks well-gated. */
  warnings: string[];
  /** package.json script keys found at the repo root (empty when none). */
  scripts: string[];
}

/**
 * Check the target repo's root package.json for lint/test scripts. The
 * check-runner runs the repo's OWN scripts after every agent change — a repo
 * with no test script gets a clear message up front, not a silently ungated
 * PR later.
 */
export async function probeRepoScripts(
  options: ProbeOptions,
): Promise<RepoScriptsProbe> {
  const { token, owner, repo } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  let response: Awaited<ReturnType<typeof fetchImpl>>;
  try {
    response = await fetchImpl(
      `${baseUrl}/repos/${owner}/${repo}/contents/package.json`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'patchback-cli',
        },
      },
    );
  } catch {
    return { warnings: [], scripts: [] }; // Offline — the token probe already said so.
  }

  if (response.status === 404) {
    return {
      warnings: [
        `${owner}/${repo} has no package.json at the repo root — the ` +
          'check-runner will find no lint/typecheck/test scripts, so agent ' +
          'changes will NOT be gated by checks before a PR opens.',
      ],
      scripts: [],
    };
  }
  if (!response.ok) {
    return { warnings: [], scripts: [] };
  }

  let scripts: Record<string, string>;
  try {
    const body = (await response.json()) as { content?: string };
    const decoded = Buffer.from(body.content ?? '', 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as {
      scripts?: Record<string, string>;
    };
    scripts = parsed.scripts ?? {};
  } catch {
    return {
      warnings: [
        `Could not parse ${owner}/${repo}'s package.json — check that it is valid JSON.`,
      ],
      scripts: [],
    };
  }

  const warnings: string[] = [];
  const testScript = scripts.test;
  const isPlaceholder =
    testScript !== undefined &&
    /echo\s+.*no test specified.*exit 1/i.test(testScript);
  if (testScript === undefined || testScript.trim() === '' || isPlaceholder) {
    warnings.push(
      `${owner}/${repo} has no test script in package.json — agent changes ` +
        'will not be verified by tests before a PR opens. Add a "test" ' +
        'script (and ideally "lint") to gate generated patches.',
    );
  }
  return { warnings, scripts: Object.keys(scripts) };
}
