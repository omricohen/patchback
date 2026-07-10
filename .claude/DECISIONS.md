# Decisions — Patchback

## 2026-07-10 — Provisional SPEC.md reconstructed instead of blocking

**Decision:** `docs/SPEC.md` was missing (drafted in Claude chat, never saved to repo); a provisional version consolidating only CLAUDE.md + BUILD_PLAN.md content was written, clearly bannered for replacement.
**Why:** Every session is instructed to read SPEC.md first; a faithful consolidation beats a broken reference. Inventing new spec detail was avoided so it can't drift from the original. Alternative — leaving it missing — would break the documented workflow.
**Context:** Tracked in OPEN_ISSUES.md; replace with the real spec from the original chat session.

## 2026-07-10 — First two commits land directly on main

**Decision:** Renamed `master` → `main`; the docs/meta commit and the Phase 0 scaffold commit go directly on `main`. Phases 1+ get their own branches per BUILD_PLAN.
**Why:** A repo with zero commits has no base to branch from, and with no remote there is nothing to PR against yet. "One phase = one PR-sized branch" starts making sense from Phase 1.
**Context:** BUILD_PLAN.md workflow section; user default branch is `main`.

## 2026-07-10 — Phase 0 scaffolds packages/ + widget-playground only; examples/ deferred

**Decision:** Phase 0 creates all `packages/*` and a stub `apps/widget-playground`, but not `examples/nextjs-demo` / `examples/vite-demo`.
**Why:** Examples are Phase 9 deliverables; empty Next.js/Vite apps now would just be churn. The pnpm workspace globs include `examples/*` so they slot in later without config changes.
**Context:** BUILD_PLAN Phase 0 vs Phase 9.

## 2026-07-10 — TypeScript pinned to 5.x, not 7.x

**Decision:** Root devDependency is `typescript@^5.9.0` even though 7.x is latest.
**Why:** typescript-eslint 8.x crashes against TS 7 (the native-compiler line) — `pnpm lint` fails at startup. TS 5.9 is the current stable-ecosystem line. Revisit when typescript-eslint ships TS 7 support.
**Context:** Error was `TypeError: Cannot read properties of undefined (reading 'Cjs')` in @typescript-eslint/typescript-estree.

## 2026-07-10 — Shared dev tooling hoisted to workspace root

**Decision:** typescript, vitest, eslint, prettier, turbo live only in the root `package.json`; packages carry just `test`/`build` scripts.
**Why:** One version of each tool across the monorepo, no per-package devDependency drift. Bin resolution walks up to the root `node_modules/.bin`, so package scripts work unchanged.
**Context:** Root `package.json`, `turbo.json`.

## 2026-07-10 — Job state machine models only canonical edges; clarification/failure states are terminal

**Decision:** `packages/types` implements exactly the 11 transitions in the CLAUDE.md canonical chain. `feedback.needs_clarification`, `patch.failed`, and `feedback.closed` have zero outgoing edges — no re-triage-after-reply or retry-after-failure transitions were invented.
**Why:** CLAUDE.md says "use exactly these" states; adding non-canonical edges (e.g. needs_clarification → feedback.triaged after a user reply) would let the contract drift from the spec before the consuming code exists. Retry/clarification-loop semantics can be added as a new decision when Phase 5 (triage) and Phase 6 (API replies) need them, likely as a new Job rather than a resurrected one.
**Context:** `packages/types/src/job.ts` (`JOB_STATE_TRANSITIONS`); BUILD_PLAN Phase 1; SPEC.md state machine section.

## 2026-07-10 — Job carries an immutable transition history; transitionJob is pure

**Decision:** `Job.history` records every state change (`from`, `to`, ISO timestamp, optional note), and `transitionJob()` returns a new Job instead of mutating.
**Why:** An audit trail is cheap now and load-bearing later (widget thread view, debugging failed patches); purity keeps the type package storage-agnostic so the API layer decides persistence. Alternative — a mutable class — would couple consumers to an instance lifecycle.
**Context:** `packages/types/src/job.ts`.

## 2026-07-10 — @patchback/github is a zero-dependency fetch client, not octokit

**Decision:** Token mode calls the GitHub REST API directly with the global `fetch` (Node 20+), injectable via `TokenClientOptions.fetch`; no octokit or other HTTP/SDK dependency.
**Why:** The surface is five endpoints — octokit would add a dependency tree to the most security-sensitive package for no leverage. Injectable fetch makes unit tests trivial (no `vi.stubGlobal`, no nock). Octokit remains the fallback if the surface ever grows pagination/rate-limit complexity.
**Context:** `packages/github/src/token-client.ts`; BUILD_PLAN Phase 3; CLAUDE.md "minimal, established dependencies".

## 2026-07-10 — commitFiles uses the git data API; one call, one commit, no force

**Decision:** `commitFiles` builds ref → parent commit → tree (`base_tree` + inline `content`, `sha: null` for deletes) → commit → non-force ref PATCH, instead of the per-file contents API.
**Why:** The agent pipeline commits multi-file changes; the contents API is one commit per file and can't delete in the same commit. A single atomic commit keeps PR history readable and the non-force ref update fails loudly if the branch moved underneath us.
**Context:** `packages/github/src/token-client.ts` (`commitFiles`).

## 2026-07-10 — No merge capability on the GitHubClient surface

**Decision:** The `GitHubClient` interface has exactly `createIssue`, `createBranch`, `commitFiles`, `openPullRequest`, `getPullRequestStatus` — no merge method, and a unit test asserts no `*merge*` member ever appears on the token client.
**Why:** "No auto-merge, ever" is a product rule (CLAUDE.md #1); the cheapest enforcement is for the capability to not exist at the integration layer at all, so no later phase can reach it by accident or config.
**Context:** `packages/github/src/types.ts`; `packages/github/src/index.test.ts`.

## 2026-07-10 — App mode is a throwing stub; integration test env-gated and self-cleaning

**Decision:** `createAppClient()` type-checks `GitHubAppConfig` but always throws `GitHubAppModeNotImplementedError` (Phase 10 roadmap). The integration round-trip is gated with `describe.skipIf` on `GITHUB_TOKEN` + `PATCHBACK_TEST_REPO`, closes/deletes everything it creates in `afterAll`, and nothing in the suite factory throws at collection time when credentials are absent.
**Why:** Later phases can code against one `GitHubClient` interface today without App-mode plumbing. Env-gating keeps CI and stranger clones green with zero credentials (verified skipped this session — no creds configured); self-cleanup keeps the scratch repo reusable.
**Context:** `packages/github/src/app-client.ts`; `packages/github/src/integration.test.ts`; owner call: "Env-gate it — no credentials now".

## 2026-07-10 — @patchback/github does not depend on @patchback/types

**Decision:** No workspace dependency from `packages/github` to `packages/types` was added in Phase 3.
**Why:** Nothing from the shared contract is consumed at this layer — the client speaks GitHub nouns (issues, refs, trees, PRs), not Patchback nouns. Mapping FeedbackItem/Job → issue/branch/PR belongs to the orchestrating phases (4/6/8); an unused dependency would only invite layering drift.
**Context:** `packages/github/package.json`; task guidance said "where relevant" — it wasn't.
