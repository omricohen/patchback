# @patchback/github

GitHub integration for the Patchback patch pipeline: create an issue, create a
branch, commit files, open a pull request, read a pull request's status.

Two modes share one `GitHubClient` interface:

- **Token mode** (supported today): a fine-grained personal access token,
  direct calls to the GitHub REST API via `fetch`. Zero dependencies.
- **App mode** (roadmap, BUILD_PLAN Phase 10): stub only. `createAppClient()`
  pins down the config shape and throws `GitHubAppModeNotImplementedError`.

There is **no merge method** on the client, by design. Patchback never
auto-merges — PRs are merged by a human in the GitHub UI.

## Minimum fine-grained token scopes

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
restricted to **only the repository Patchback operates on**, with these
repository permissions:

| Permission        | Access         | Used for                                       |
| ----------------- | -------------- | ---------------------------------------------- |
| **Contents**      | Read and write | Create branches, commit files (git data API)   |
| **Issues**        | Read and write | Create the tracking issue for triaged feedback |
| **Pull requests** | Read and write | Open PRs, read PR status                       |
| **Metadata**      | Read           | Mandatory baseline for any fine-grained token  |

Nothing else. No account-level scopes, no admin, no workflows.

## Usage

```ts
import { createTokenClient } from '@patchback/github';

const gh = createTokenClient({
  token: process.env.GITHUB_TOKEN!,
  owner: 'your-org',
  repo: 'your-repo',
});

const issue = await gh.createIssue({
  title: 'Sort orders table by date',
  body: 'Reported via the feedback widget.',
});

const branch = await gh.createBranch({
  branch: `patchback/issue-${issue.number}`,
});

await gh.commitFiles({
  branch: branch.branch,
  message: `Sort orders table by date (#${issue.number})`,
  files: [
    { path: 'src/orders-table.tsx', content: '/* updated source */' },
    { path: 'src/legacy-sort.ts', delete: true },
  ],
});

const pr = await gh.openPullRequest({
  title: `Sort orders table by date (#${issue.number})`,
  head: branch.branch,
  body: `Closes #${issue.number}`,
});

const status = await gh.getPullRequestStatus(pr.number);
// status.state: 'open' | 'closed' | 'merged'
```

`createBranch` and `openPullRequest` default to the repository's default
branch when `from` / `base` are omitted. Failures throw `GitHubApiError`
carrying the HTTP status, method, path, and GitHub's error body.

Options: `baseUrl` (GitHub Enterprise), `fetch` (injectable, used by the unit
tests), `userAgent`.

## Testing

Unit tests run against a mocked `fetch` — no network, no credentials:

```sh
pnpm --filter @patchback/github test
```

The integration round-trip (issue → branch → commit → PR → status) is
env-gated and **skipped** unless both variables are set. Point it at a
throwaway repo — it creates and then closes/deletes an issue, a branch, and a
PR:

```sh
GITHUB_TOKEN=github_pat_... \
PATCHBACK_TEST_REPO=you/scratch-repo \
pnpm --filter @patchback/github test
```

## App mode (roadmap)

`GitHubAppConfig` and `createAppClient()` exist so later phases can code
against the interface, but App mode ships in Phase 10, not v0.1. The
local-first flow (`npx patchback dev`) intentionally requires only a
fine-grained token.
