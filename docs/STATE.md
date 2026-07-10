# STATE — where we left off

_Last updated: 2026-07-10_

## Current phase

**Phase 3 (GitHub package, token mode) — DONE** on branch `phase-3-github` (not yet
merged to `main`). Phase 2 (extraction pass) was skipped over for now — it's
Omri-driven and no source material has landed in `extraction-inbox/` yet.
Next up: **Phase 4 — Agent core + Claude Code adapter** (or Phase 2 whenever Omri
drops material in the inbox).

## What's done

- Phases 0–1 merged to `main` (scaffold; `packages/types` shared contract + job
  state machine — see git history and earlier decisions).
- `packages/github` implemented (token mode):
  - `types.ts` — `GitHubClient` interface: `createIssue`, `createBranch`,
    `commitFiles`, `openPullRequest`, `getPullRequestStatus`, plus input/result
    types (`FileChange` supports content, mode, and explicit deletes). No merge
    method exists on the surface, by design.
  - `token-client.ts` — `createTokenClient()` taking token, owner, repo and
    optional baseUrl / fetch / userAgent. Zero dependencies; direct `fetch`
    against the GitHub REST API
    (api-version 2022-11-28). `commitFiles` uses the git data API (ref → parent
    commit → tree with `base_tree` → commit → non-force ref update) so one call =
    one commit, deletes included. Default branch resolved lazily and cached.
  - `errors.ts` — `GitHubApiError` (status, method, path, message, responseBody).
  - `app-client.ts` — App mode STUB only: `GitHubAppConfig` + `createAppClient()`
    which always throws `GitHubAppModeNotImplementedError` (roadmap, Phase 10).
  - `README.md` — usage + minimum fine-grained token scopes: Contents R/W,
    Issues R/W, Pull requests R/W, Metadata R.
- Tests: 21 unit tests against an injected mock `fetch` (no network, no vi.stubGlobal
  needed) covering every method, header auth, error mapping, default-branch caching,
  tree/commit payloads, merged-vs-closed PR state. Plus `integration.test.ts` —
  env-gated round-trip (issue → branch → commit → PR → status, with cleanup) behind
  `GITHUB_TOKEN` + `PATCHBACK_TEST_REPO` (`owner/repo`); reported as skipped when
  either is absent. No credentials were configured this session, so it was verified
  as cleanly skipped, not executed.
- Gate green: `pnpm lint && pnpm test && pnpm build` and `pnpm format:check` all pass.

## Next concrete step

Phase 4: `packages/agent-core` (adapter interface, repo-reader, scratch-dir
lifecycle, check-runner) + `packages/agent-claude-code` (headless CLI adapter with
diff-size ceiling). Before or alongside: run the integration round-trip once real
credentials exist (`GITHUB_TOKEN` + `PATCHBACK_TEST_REPO` → scratch repo).

## Context to pick up cleanly

- Phase 3 decisions in `.claude/DECISIONS.md`: zero-dep fetch client over octokit;
  git-data-API commits; App mode stub throws; integration test env-gated and
  self-cleaning; `@patchback/github` does NOT depend on `@patchback/types` (nothing
  from the shared contract is needed at this layer — feedback→issue formatting
  belongs to later phases).
- `phase-3-github` branch is unmerged and unpushed; merge/PR is Omri's call.
- Open issues: `.claude/OPEN_ISSUES.md` (SPEC.md provisional; gitleaks not
  installed; no GitHub remote yet; Phase 2 pending Omri's source material).
