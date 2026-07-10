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

## 2026-07-10 — Adapter success is judged by the git diff, not the CLI's self-report

**Decision:** The Claude Code adapter parses `--output-format json` tolerantly but decides pass/fail from `git diff --numstat` (via `git add --intent-to-add` so untracked files count): zero changed files fails, exceeding the diff ceiling fails, unparsable CLI output with a valid diff still succeeds.
**Why:** The CLI's self-report can be wrong in both directions (claims success without edits, or emits noise around valid work); the working tree is ground truth and the check-runner validates it independently. Alternative — trusting the JSON `is_error` alone — was kept only as an additional failure signal.
**Context:** `packages/agent-claude-code/src/adapter.ts` (`execute`), `src/result.ts`.

## 2026-07-10 — Diff ceiling defaults to 300 changed lines and fails toward triage, not retry

**Decision:** `maxChangedLines` (additions + deletions from numstat, binary files counted as 0 lines but still listed) defaults to 300; exceeding it fails the job with a message saying triage likely misclassified the item and it should go to a human — explicitly not "retry with a bigger limit".
**Why:** BUILD_PLAN Phase 4 rule: a bigger diff means the triage was wrong. Encoding the routing advice in the error keeps later phases (worker, widget thread) honest about what this failure means.
**Context:** `packages/agent-claude-code/src/adapter.ts`; CLAUDE.md "triage before code".

## 2026-07-10 — Trust boundary enforced at the brief type with a runtime guard

**Decision:** `TaskBrief` (agent-core) is the only instruction channel into adapters; its docs state outsider content must never enter any field, and `assertBriefSourceAllowed(tier)` (backed by `canInitiatePatchJob` from @patchback/types) throws `BriefSourceNotAllowedError` for outsider tiers as defense-in-depth. agent-core thus takes a workspace dep on @patchback/types; agent-claude-code does not.
**Why:** The server-side tier check (Phase 6) is the primary enforcement, but the type that actually reaches the agent should carry the rule and a guard so no orchestration path can skip it silently.
**Context:** `packages/agent-core/src/brief.ts`; CLAUDE.md rule #3.

## 2026-07-10 — plan() is deterministic (no model call); the CLI runs only in execute()

**Decision:** The adapter's `plan()` builds an auditable step list locally from the brief instead of spawning the CLI twice; `execute()` is the single agent invocation, with the ceiling and no-git-commit rules embedded in the prompt.
**Why:** A second model call would double cost/latency for a v0.1 pipeline whose plan is implied by the brief; the AgentAdapter interface keeps `plan()` as a seam where a richer planner can slot in later without changing callers.
**Context:** `packages/agent-claude-code/src/adapter.ts`; `packages/agent-core/src/adapter.ts` interface docs.

## 2026-07-10 — Adapters spawn processes via a shared agent-core runProcess helper

**Decision:** One `runProcess()` (agent-core) serves both the check-runner and CLI adapters: detached process groups on POSIX so timeout SIGKILL takes down grandchildren, settle-after-exit grace because a surviving grandchild can hold stdio pipes open, stdin input support, and separate stdout/stderr plus combined capture. The adapter binary is injectable (`binaryPath` + `binaryArgs`), which is how tests substitute a fake CLI (node script) for `claude`.
**Why:** The naive kill left `npm run` grandchildren alive and hung the runner until test timeout (observed in this session); solving it once in agent-core keeps every adapter safe. Injection keeps unit tests hermetic while the real-binary e2e stays env-gated (`PATCHBACK_E2E_CLAUDE=1`, cleanly skipped otherwise).
**Context:** `packages/agent-core/src/process.ts`; `packages/agent-claude-code/test/fixtures/fake-claude.mjs`.

## 2026-07-10 — Triage model call goes through an injectable ModelCaller; the Anthropic SDK is confined to one file

**Decision:** `triageFeedback` depends only on a vendor-neutral `ModelCaller` seam (`(req) => Promise<{text}>`); the default implementation (`createAnthropicModelCaller`, `packages/triage/src/anthropic.ts`) is the ONLY file in the package importing `@anthropic-ai/sdk`. Default model `claude-opus-4-8` (configurable), adaptive thinking at low effort, structured output via `output_config.format` json_schema, `max_tokens` 4096.
**Why:** Tests inject plain fakes with zero mocking machinery (same pattern as injectable `fetch` in @patchback/github and injectable `binaryPath` in agent-claude-code); a vendor swap touches one file. The official SDK (vs. the Phase 3 zero-dep-fetch precedent) earns its keep here: structured outputs, automatic retry with retry-after on 429/529, typed error classes mapped onto `TriageModelError`. Opus by default because classification quality is the security control — pinning a cheaper model is a config decision after evals prove it out, not a code default. Dependency approved by Omri in the phase-5 plan.
**Context:** `packages/triage/src/{model,anthropic,classifier}.ts`; plan `.a5c/runs/.../phase-5-plan.md` §3.

## 2026-07-10 — Outsider feedback short-circuits triage: needs_human, zero model calls

**Decision:** `triageFeedback` never sends `outsider`-tier feedback to the model; it returns a deterministic `needs_human` (confidence 1) with reasoning noting the short-circuit.
**Why:** Rule #3 — outsider feedback is data only. Classifying it buys nothing in v0.1 (no clustering yet; `patchable` is a forbidden output for the tier anyway) and each hostile submission would cost a model call (griefing vector). The tier check becomes structural inside triage: even if a later caller forgets the server-side check, triage output for outsider items can never be `patchable`. Defense-in-depth, not a replacement for Phase 6 server-side enforcement. Alternative considered (classify-but-cap for future clustering) rejected in the approved plan.
**Context:** `packages/triage/src/classifier.ts`; zero-invocation guarantee unit-tested in `classifier.test.ts`.

## 2026-07-10 — Every uncertain triage path resolves DOWN: failsafe parsing + one-step demotion ladder at 0.7

**Decision:** Malformed/unparseable/unknown-enum model output resolves to `needs_human`/confidence 0 (never a throw, never patchable); transport errors throw `TriageModelError` (caller owns retries). Below a configurable `confidenceThreshold` (default 0.7, strict `<`), results demote exactly one rung: patchable→needs_clarification (model's clarifying question preserved, deterministic fallback question otherwise), needs_clarification→needs_human (question dropped), needs_human is the floor. Demotions are annotated in `reasoning`; the returned confidence stays the model's original number. No promotion mechanism, no retry-for-a-better-label.
**Why:** "When uncertain, classify DOWN" as mechanism, not aspiration. Self-reported confidence is uncalibrated, so the threshold is a policy knob validated end-to-end by the evals (which score post-demotion results). Separating transport failure (retryable, thrown) from classifier fault (terminal, failsafe) keeps a flaky network from ever producing a classification.
**Context:** `packages/triage/src/{schema,threshold,classifier}.ts`.

## 2026-07-10 — Prompt-injection posture: nonce-delimited DATA blocks + hard needs_human mapping + absolute eval gate

**Decision:** All submitter-controlled content (message, console entries, picked-element text, URL, title) is wrapped in per-call random-nonce DATA blocks with tag-shaped sequences sanitized (`<data-`/`</data-` defanged); the frozen system prompt maps instruction-smuggling, self-classification, and secret-exfiltration asks to `needs_human` regardless of tier; trust tier is stated outside the blocks as metadata. Screenshots are never serialized in v0.1 (cost + image-borne injection surface). The eval suite (30 fixtures incl. 6 injection vectors across message/console/element channels) asserts the injection gate separately from the 90% accuracy bar — one leaked injection fails the run regardless of aggregate score.
**Why:** Injection is never "solved"; the layered design (delimiting + rule mapping + classify-down + tier gates + human review of every PR) is the posture, and the fixture file is the living regression suite.
**Context:** `packages/triage/src/prompt.ts`; `packages/triage/evals/`.

## 2026-07-10 — Brief construction is structurally guarded: branded GuardedTaskBrief + factory (supersedes the runtime-guard-only decision of Phase 4)

**Decision:** `GuardedTaskBrief` (agent-core) extends `TaskBrief` with stamped `feedbackId` + `sourceTier` and a unique-symbol brand, making object-literal construction a type error; `createBriefFromTriagedFeedback(item, fields)` is the only producer and throws `BriefSourceNotAllowedError` unless `canInitiatePatchJob(item.trustTier)` and `BriefNotPatchableError` unless `item.triage?.classification === 'patchable'` (tier checked first). `AgentContext.brief` now requires the branded type, so adapters cannot receive an unguarded brief.
**Why:** Landing the guard in Phase 5 (the phase that creates the producer side) prevents Phase 6's orchestrator from being written against the unguarded interface and retrofitting later — exactly the failure mode the OPEN_ISSUES advisory warned about. `assertBriefSourceAllowed` stays as the underlying tier check, now with a production call site inside the factory. Approved in the phase-5 plan (§8).
**Context:** `packages/agent-core/src/{brief,adapter}.ts`; `packages/agent-claude-code/src/fixture.ts` builds its acceptance brief through the factory.

## 2026-07-10 — Eval runner is env-gated vitest, with acceptable-set grading

**Decision:** `evals/eval.test.ts` uses `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` (repo precedent: github integration test, Phase 4 e2e). Fixtures carry an `expected` array (acceptable set — used for two genuinely borderline items) plus an optional `mustNotBe` absolute gate; scoring reports accuracy, per-tag breakdown, and misses. Concurrency capped at 4; `PATCHBACK_EVAL_RUNS=n` for repeatability checks. Verified to skip cleanly keyless this session; a live run awaits a key (logged in OPEN_ISSUES).
**Why:** CI and stranger clones stay green with zero credentials; borderline items should test the classify-down policy, not luck.
**Context:** `packages/triage/evals/{eval.test.ts,score.ts,fixtures/fixtures.json}`.
