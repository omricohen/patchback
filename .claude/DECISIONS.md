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

## 2026-07-13 — Trust tiers assigned exclusively server-side from a config API-key map

**Decision:** `ApiConfig.apiKeys` maps bearer keys → `owner` | `insider` (an "outsider key" is unrepresentable in the type and rejected by `validateConfig`); no/unknown/malformed key resolves to `outsider` (fail closed, not 401 — anonymous submission is a feature). The POST /feedback body schema has `additionalProperties: false` and no `trustTier` property, and ajv's default `removeAdditional` is turned OFF, so a client-supplied tier is a loud 400. Key comparison is constant-time (hash-then-timingSafeEqual); keys never appear in logs or responses. Every tier read back from storage/config re-passes `isTrustTier` and fails closed with `StoreIntegrityError` (closes the Phase 5 carry-over: the tier is revalidated before it reaches the triage prompt path).
**Why:** The trust tier is a security boundary; the only party that may assign it is the server, from configuration the operator controls. Rejecting (not stripping) a body-supplied tier prevents anyone building against the false assumption that clients pick tiers.
**Context:** `packages/api/src/{auth,config,trust}.ts`, `src/routes/feedback.ts`; approved phase-6 plan §3.

## 2026-07-13 — Per-item read tokens (hashed at rest) gate feedback/job reads

**Decision:** `POST /feedback` returns a one-time 32-byte base64url `readToken`; only its SHA-256 hash is stored. `GET /feedback/:id`, `GET /jobs/:id/status`, and `POST /feedback/:id/reply` require the item's token or an owner/insider key; failures are 404 (not 401) so probing can't distinguish existence. Rejected alternative: unguessable-ID-as-capability — IDs land in URLs and logs by design and would leak captured context (console errors, DOM paths).
**Why:** Cheap now; the Phase 7 widget just stores the token next to the id.
**Context:** `packages/api/src/ids.ts`, `src/routes/shared.ts`; plan §3.

## 2026-07-13 — Replies are NEW linked FeedbackItems with NEW Jobs; effective tier = thread minimum (fulfils the Phase 1 anticipation)

**Decision:** `feedback.needs_clarification` stays terminal, exactly as the Phase 1 state-machine decision anticipated ("likely as a new Job rather than a resurrected one"). `POST /feedback/:id/reply` (valid only in that state, 409 otherwise) creates a new item linked via additive `threadId` (root id) / `inReplyTo` (parent id) fields and a new job at `feedback.received`. The reply item's stored tier is the MINIMUM across its thread (owner > insider > outsider) — outsider content anywhere poisons every reply, so a trusted replier can never launder an outsider-rooted thread into a triage prompt or a brief. The caller's key tier does not enter the minimum: read access already proves thread membership, and the thread's own provenance decides. Reply triage sees the thread context (prior messages + clarifying question) inside the same nonce-delimited DATA blocks.
**Why:** Keeps the canonical CLAUDE.md states byte-exact, keeps one job = one triage verdict = at most one PR, and makes the min-tier rule a data-level property rather than a caller-level courtesy. Alternative (a needs_clarification → received re-triage edge) rejected: would amend the canonical machine for no audit benefit.
**Context:** `packages/types/src/feedback.ts`, `packages/api/src/routes/feedback.ts`, `packages/triage/src/prompt.ts` (ThreadContext); plan §5.

## 2026-07-13 — needs_human is a classification resting at feedback.triaged, not a job state

**Decision:** After triage, `needs_clarification` items advance to the terminal `feedback.needs_clarification`; `patchable` AND `needs_human` items rest at `feedback.triaged`. `needs_human` items are un-startable via the server-side triage gate (`403 triage_gate`), not via a new state. This resolves the STATE.md open question without touching the canonical machine.
**Why:** Classification lives on the item; the state machine tracks lifecycle, not verdicts.
**Context:** `packages/api/src/workers/triage-worker.ts`, `src/routes/jobs.ts`; plan §4.

## 2026-07-13 — Storage is a hand-written Store interface: MemoryStore dev default, Drizzle/Postgres prod; SQLite deferred

**Decision:** One `Store` interface with compare-and-swap `updateJob(job, expectedState)` as the concurrency primitive (drizzle: `UPDATE … WHERE state = expected`; duplicate queue deliveries and double-starts lose the CAS instead of corrupting the audit trail). MemoryStore (zero deps, deep-copy in/out, same fail-closed validation) is the dev/test default; DrizzleStore + committed drizzle-kit migrations (CHECK constraints over the three tiers and twelve canonical states) is prod; `pg` is imported by exactly one file. SQLite is NOT in Phase 6: better-sqlite3 is a native build step (violates the no-install spirit) and `node:sqlite` needs Node 22.5+ (engines say >=20). Revisit condition: if `patchback dev` needs persistence across restarts in Phase 8, a drizzle sqlite-core store slots in behind the same interface. Row → domain mapping revalidates tier/state/triage jsonb and throws `StoreIntegrityError` — never coerced toward a runnable state or an eligible tier.
**Why:** The interface is five queries; an ORM-agnostic seam keeps `npx patchback dev` at zero services while prod gets real CAS semantics.
**Context:** `packages/api/src/store/`; one conformance suite parameterized over both drivers, Drizzle env-gated behind `PATCHBACK_TEST_DATABASE_URL` (verified green against a live Postgres 17 this session).

## 2026-07-13 — Queue is a minimal TaskQueue; memory dev default; bullmq confined to one file; patch tasks never auto-retry

**Decision:** `TaskQueue` = enqueue / process / close over two task types (`triage {feedbackId, jobId}`, `patch {jobId}` — the triage payload carries the jobId, a deliberate convenience over the plan's sketch). Retry policy is per task type and shared by both drivers via `maxAttemptsForTask`: triage 3 attempts (transport `TriageModelError`s throw and retry; exhausted retries leave the job at `feedback.received`, never a fabricated classification), patch exactly 1 (the worker records `patch.failed` itself; the queue re-running an agent would burn money and hide failures). MemoryQueue is single-consumer FIFO with `onIdle()` so tests await drains instead of sleeping; BullMQQueue is the only file importing bullmq, parses the Redis URL without importing ioredis, env-gated test behind `PATCHBACK_TEST_REDIS_URL` (verified green against a live Redis this session).
**Why:** Local-first structurally: memory drivers are the defaults, services activate only when explicitly configured.
**Context:** `packages/api/src/queue/`; plan §7.

## 2026-07-13 — Webhook route exists only with a secret; handler wired without a GitHubClient

**Decision:** `POST /webhooks/github` is registered ONLY when `webhookSecret` is configured — there is no "verification disabled" mode, because an unverified webhook endpoint is an unauthenticated state-transition API. Verification is HMAC SHA-256 over the RAW request bytes (scoped buffer content-type parser, hash-then-timingSafeEqual) before any JSON parsing. The handler receives a Store and a plain `RepoRef` value — NOT the GitHubClient — so outbound GitHub calls (let alone a merge) are impossible by wiring, on top of GitHubClient having no merge method (Phase 3) and an integration spy asserting zero client calls during webhook processing. Merged PRs walk `pr.opened → pr.reviewed → patch.shipped → feedback.closed` through `transitionJob` (merge by a human implies review); closed-without-merge changes nothing (see OPEN_ISSUES).
**Why:** No-auto-merge is enforced at three independent layers; PR status flows in only.
**Context:** `packages/api/src/routes/webhooks.ts`, `src/webhook-verify.ts`; plan §8.

## 2026-07-13 — Repo-wide typecheck task covers test files and evals (closes the dead @ts-expect-error gap)

**Decision:** Every package gets `tsconfig.typecheck.json` (extends the package tsconfig, `noEmit`, `rootDir: "."`, includes `src`/`test`/`evals`, empty exclude) and a `typecheck` script; turbo gains a `typecheck` task (`dependsOn ^build`), the root gains `pnpm typecheck`, and CI runs it between lint and test. Verified live: temporarily deleting the GuardedTaskBrief brand makes `pnpm typecheck` fail with TS2578 in agent-core. The check also surfaced and fixed a latent expect-type misuse in agent-claude-code.
**Why:** Package tsconfigs exclude tests from builds and vitest transpiles without typechecking, so every `@ts-expect-error` security assertion was dead until now — and Phase 6 is where a brand regression becomes reachable from network input.
**Context:** `*/tsconfig.typecheck.json`, `turbo.json`, `.github/workflows/ci.yml`; plan §10.

## 2026-07-15 — Capture defaults: message + query-stripped URL only; two-tier consent model

**Decision:** With zero config the widget sends exactly the user's typed message, the page URL with query string AND hash stripped, and the submit timestamp — pinned by an exact-snapshot test. Everything else needs consent at one of two tiers: CONFIG consent (the embedding developer) for anything background — `page` env trio, `console` (the wrap is not even installed without it), `screenshot` (button hidden without it) — and GESTURE consent (the submitting user, per use) for the element picker and screenshots, both of which capture only on an explicit click. The picker button is visible by default because its capture is gesture-gated and previewed (plan Q2, approved). The panel renders a "What will be sent" preview and the payload is built FROM that preview model in `buildCaptureContext` — one choke point, unconstructable without the masking engine, so the preview structurally cannot lie. The user's typed message is sent verbatim; scrub applies to captured text only (plan Q3, approved reading).
**Why:** Rule 4 ("no new default data capture without explicit config") interpreted as a bright line; query strings carry tokens/PII so even the one default field ships stripped.
**Context:** `packages/widget/src/capture/context.ts`, `src/config.ts`; plan §4; acceptance test `src/capture/context.test.ts`.

## 2026-07-15 — Masking engine semantics: masked vs ignored; nearest marker; non-overridable floor; fail closed

**Decision:** Two verbs — MASKED (exists in capture, content replaced, geometry preserved, domPath/tagName still emitted) and IGNORED (absent: unpickable, text dropped, whole box painted in screenshots). Resolution: ignore beats everything on its subtree; then a non-overridable hard floor (password/hidden inputs; autocomplete cc-number/cc-csc/cc-exp*/one-time-code/current-password/new-password) that no unmask source or `maskInputs:false` can reach, each member pinned by a test; then nearest-marker resolution walking self→ancestors (markup attrs `data-patchback-mask/unmask/ignore` + config selectors; mask wins a same-node tie); else `maskInputs` (default true) masks form-field VALUES. Policy crosses OPEN shadow boundaries via flat-tree parents; cross-origin iframes are always ignored (fail closed); invalid config selectors throw at widget init. Built and merged BEFORE any capture module existed (rule 4's ordering enforced by construction).
**Why:** Conflating "hide the value" with "pretend it doesn't exist" produces both privacy leaks and useless captures; two explicit verbs serve both.
**Context:** `packages/widget/src/masking/`; plan §5.

## 2026-07-15 — Screenshots: snapdom behind a one-file renderer seam; two independent redaction layers; drop-not-violate ladder

**Decision:** DOM rasterization via `@zumer/snapdom` (pinned 2.12.8 — the newest release was 2 days old; the pin stays safely behind the 1-month age posture), chosen over html2canvas (unmaintained, breaks on modern CSS color functions), native getDisplayMedia (permission prompt per capture, can capture OTHER windows), and NIH foreignObject serialization. snapdom is imported by exactly ONE file (`screenshot-snapdom.ts`), only via dynamic `import()` — a hygiene test pins both facts — so the ESM core stays zero-dep; the IIFE bundle inlines it as an async chunk (no CDN loads, per the no-telemetry posture). Redaction is two INDEPENDENT layers: layer 1 strips masked values/text from the renderer's detached clone in snapdom's `afterClone` hook (masked content never exists in the serialized SVG; the clone preserves attributes so the same policy classifies it directly — no fragile source-pairing); layer 2 paints opaque rects (1px bleed) measured from the LIVE document in the same synchronous frame. Encoding walks WebP→JPEG quality rungs and DROPS the screenshot with a visible notice if it cannot fit the 512 KiB schema cap — never an oversized payload, never a blocked submit. Closed shadow roots are unserializable by the renderer at all (content never reaches the clone) — documented as the fail-closed story since closed roots are undetectable from outside.
**Why:** Redaction correctness is safety-critical; either layer alone surviving a renderer quirk still covers the pixels, and CI proves pixel truth.
**Context:** `packages/widget/src/capture/screenshot*.ts`, `redact.ts`; plan §6; pixel proof in `apps/widget-playground/test/acceptance.browser.test.ts`.

## 2026-07-15 — Console capture: wrap not installed without config; errors-only default; scrub-at-insert

**Decision:** `capture.console` off (the default) means the console wrap is NOT INSTALLED — installing the wrap is itself capture behavior. Enabled: errors only by default, `warn` opt-in via `levels`; log/info/debug unrepresentable in the type and the server schema. Ring cap 50 mirrors the server schema; entries are scrubbed AT INSERT (bearer tokens, key shapes, JWTs, emails, URL query strings, high-entropy blobs — synthetic fixtures only) so secrets never sit in widget memory. Uninstall restores by reference-swap only if the wrapper is still ours; a third party wrapping after us keeps its chain and ours becomes a recording no-op. Buffer contents attach to a submission only while the user leaves the preview checkbox checked.
**Why:** Background collection is the highest-trust capture class; consent must be structural, not documentary.
**Context:** `packages/widget/src/capture/console-buffer.ts`, `src/masking/scrub.ts`; plan §7.

## 2026-07-15 — Widget architecture: zero-dep vanilla core in an OPEN shadow root; no custom element; Vite IIFE alongside tsc ESM

**Decision:** The core is framework-free TS rendered into `attachShadow({mode:'open'})` on a host div that carries `data-patchback-ignore` + `data-patchback-widget` (the widget never captures itself — engine ignore + renderer exclude). Open, not closed: closed buys no security, only friction for testing/debugging. No custom-element registration (two widget builds on one page must not fight over a registry name). Styles are one injected constructed stylesheet (`<style>` fallback); theming via `--patchback-*` custom properties, which pierce the boundary by design. Distribution: the package ESM entry is the tsc per-module output (keeps snapdom a true dynamic import for bundlers); Vite lib-mode emits only the IIFE for script tags (`window.Patchback.create`). React package is a lifecycle-only wrapper (peer `^18 || ^19`, no react-dom): provider effect + hooks + optional custom launcher, no parallel UI.
**Why:** One UI implementation; the framework wrapper that re-implements panels is the maintenance trap this avoids.
**Context:** `packages/widget/src/ui/root.ts`, `vite.config.ts`, `packages/react/src/index.tsx`; plan §8–9.

## 2026-07-15 — SDK: zero-dep injectable-fetch client; SDK-owned DTOs kept honest by contract tests; explicit ReadAuth

**Decision:** `createPatchbackClient` follows the github-package pattern (zero deps, injectable fetch, works in browser + Node 20+). Response DTO types live IN the SDK, composed from @patchback/types primitives; the anti-drift mechanism is a contract suite booting the REAL `buildServer` (via the promoted `@patchback/api/testing` fakes) on an ephemeral port — @patchback/api is a devDependency only. Auth is explicit: submit sends the key iff configured; reads/replies take `ReadAuth` ({readToken} | {useApiKey:true}) with NO silent fallback — an SDK that "helpfully" reuses the owner key for reads trains integrators to ship keys where tokens suffice. `startJob` requires a key client-side and is otherwise a plain wrapper over fully server-enforced gates. Typed request builders (no user-object spreads) make `trustTier` unrepresentable on the wire. `pollJobStatus`: fast until triage then slow, capped exponential backoff on network/5xx with an onConnectionIssue callback, hard stop on 404 (polling a 404 forever is a probe pattern), resolve at `isTerminalJobState`, AbortSignal for the widget's visibility pausing. The SDK stores nothing — token custody is the widget's.
**Why:** The wire contract locks first; everything UI builds on typed calls that CI executes against the real server.
**Context:** `packages/sdk/`; plan §3; `packages/sdk/test/contract.test.ts`.

## 2026-07-15 — Read-token custody: widget memory by default; localStorage opt-in with documented tradeoff

**Decision:** Thread records `{rootId, entries[{feedbackId, jobId, readToken}]}` live in memory only by default — reload forgets past threads (tokens are shown once by the server). `persistThreads: true` opts into localStorage under `patchback:v1:threads:<hash(apiUrl)>`, for internal apps on trusted machines only: a read token grants read access to the item INCLUDING capture context (ties to the 2026-07-13 unredacted-capture open issue; if that posture changes, revisit this default). Tokens never logged, never in URLs, sent only as Authorization headers.
**Why:** Correct-by-default privacy with an explicit, documented escape hatch matching the product's internal-apps positioning.
**Context:** `packages/widget/src/storage.ts`; plan §8.5.

## 2026-07-15 — API test fakes promoted to @patchback/api/testing

**Decision:** `packages/api/test/fakes.ts` moved to `src/testing.ts` and shipped as the `./testing` subpath (precedent: `./drizzle`, `./bullmq`). The api's own tests, the SDK contract suite, the playground dev API, and the browser acceptance suite all consume ONE set of scripted fakes; no runtime deps added. Dev/test-only usage, but a public surface once published (plan Q4, approved).
**Context:** `packages/api/src/testing.ts`, package.json exports; plan §11.3.

## 2026-07-15 — Acceptance proven in CI via env-gated Playwright Chromium; default clone stays browser-free

**Decision:** The phase acceptance ("pick → submit → status updates render; masked inputs never in payload or screenshot") is an executable suite driving the real playground page against the real fake-pipeline API in headless Chromium, gated behind `PATCHBACK_BROWSER_TESTS=1` and run as a dedicated required CI job (`playwright install --with-deps chromium`). Plain Playwright inside vitest rather than @vitest/browser — one fewer root dependency, same runner. Proofs: hover-highlight geometry tracks the target rect; the ignored card is unpickable; the STORED item (read in-process from MemoryStore) contains zero sentinel values and the picked `#export-btn` domPath; the stored screenshot's pixels over the password input and the ignored card are ≥99% uniform redaction fill (±14/channel WebP headroom); the status chip walks the canonical states to Closed via the signed merge-webhook helper; the clarification branch mints and advances a NEW job. jsdom suites cover everything geometry-free (payload masking, both redaction layers unit-tested, poll semantics, hard-floor pins). Verified green locally against installed Chromium this session. Playwright pinned `~1.60.0` and snapdom `2.12.8` — both aged releases, consistent with the no-fresh-packages posture.
**Why:** jsdom cannot see pixels; an acceptance criterion about screenshots that CI cannot falsify would be aspirational dead code.
**Context:** `apps/widget-playground/test/acceptance.browser.test.ts`, `.github/workflows/ci.yml`; plan §12.

## 2026-07-15 — CORS deferred to Phase 8 (CLI owns the serving topology)

**Decision:** The playground avoids CORS entirely via Vite's dev proxy (`/api` → localhost:8787), keeping Phase 7 free of api-package changes. Real cross-origin embedding (user's app on :3000, patchback API on :8787 — exactly what `npx patchback dev` will print a snippet for) WILL need CORS on the API; that lands with the Phase 8 CLI, behind explicit config (allowed origins, never `*` with credentials). Logged in OPEN_ISSUES.
**Context:** `apps/widget-playground/vite.config.ts`; plan §11.4.

## 2026-07-15 — Screenshot geometry corrected: viewport crop + pre-render measurement; clone stage strips media (supersedes parts of the two 2026-07-15 screenshot entries)

**Decision:** Verification falsified two claims in the earlier screenshot entries — "either layer alone still covers the pixels" and the implied viewport raster. Reality: snapdom rasters the FULL document (not the viewport) and scrolls the page to the top mid-capture without restoring it, while layer-2 rects were viewport-space and viewport-clipped — on a scrolled page every rect painted at the wrong canvas position (masked content leaked; innocent pixels got covered) — and layer 1 stripped only values/text, leaving `<img>`/`<canvas>`/`<svg>`/`<video>` and CSS background images inside masked subtrees fully visible (and an ignored element's OWN background). Fixes, all pixel-proven in the browser suite: (1) clone stage now strips media sources, canvas buffers, svg children, video/audio sources+posters, and sets `background-image`/`border-image-source`/`mask-image` to `none !important` on masked and ignored elements (ignored elements' own media included; unmask-marked descendants stay intact); (2) ALL live geometry (body rect, scroll, viewport, redaction rects) is measured BEFORE rendering in one synchronous frame, the full-document raster is cropped to the viewport via `computeViewportCrop` (canvas-px-per-CSS-px scale absorbs devicePixelRatio), viewport-space rects are painted on the crop, and the user's scroll position is restored after the renderer's scroll reset; (3) the shipped screenshot is therefore "what the user saw", matching the panel preview. The acceptance suite gained a SCROLLED below-fold case: masked `<img>`, masked CSS background, and a below-fold password must be uniformly redaction-filled while an adjacent UNMASKED control block must keep its own color (proves crop alignment and no misplaced fill), plus a viewport-shape assertion on every screenshot and a scroll-restore assertion.
**Why:** Redaction correctness is safety-critical and was only ever proven at scroll 0 with text-only content; the two layers are independent again only now that layer 1 covers media and layer 2 lands on the right pixels at any scroll.
**Context:** `packages/widget/src/masking/clone.ts`, `src/capture/screenshot.ts` (`computeViewportCrop`), `apps/widget-playground/test/acceptance.browser.test.ts`; verifier rejection of phase-7 attempt 1.

## 2026-07-15 — snapdom's vendored icon-font URLs suppressed at runtime; hygiene scan extended to the shipped bundle

**Decision:** snapdom 2.12.8 vendors four hardcoded `fonts.gstatic.com` Material-Icons woff2 URLs it can fetch at render time (Material Symbols with FILL=1). The adapter now sets `window.__SNAPDOM_ICON_FONTS__` to empty strings BEFORE the module evaluates (snapdom's documented override hook — falsy values skip its FontFace fetch entirely; cost: that icon variant rasters outlined). The hygiene posture is two-tier and documented as such: widget SOURCE must contain zero `http(s)://` literals (always enforced); the shipped IIFE bundle — which inlines snapdom — is scanned against an explicit origin allowlist (`www.w3.org` XML namespaces and `localhost` URL-resolution fallbacks, neither ever fetched; `fonts.gstatic.com` accepted ONLY together with the suppression marker shipping in the same bundle), any other origin fails. The bundle scan runs whenever dist exists (always in the CI browser job, which builds first) and skips with a visible notice on test-before-build runs — src-only scanning alone was the old boundary and is no longer sufficient since the bundle inlines vendor code.
**Why:** A no-phone-home posture that only audits first-party source is blind to exactly the class of fetch a vendored renderer introduces.
**Context:** `packages/widget/src/capture/screenshot-snapdom.ts`, `src/hygiene.test.ts`; README "No phone-home" section; OPEN_ISSUES entry.

## 2026-07-15 — Clone-stage background redaction is an opaque inset box-shadow; layer-2 rects round outward to device pixels (supersedes the background-image:none mechanism in the "geometry corrected" entry)

**Decision:** Verification falsified the attempt-2 mechanism for CSS backgrounds: snapdom's resource-inlining pass rewrites url-bearing properties (background-image at minimum) into the clone's style attribute from its LIVE-element snapshot AFTER the afterClone hook — probing the serialized SVG showed our `background-image: none !important` replaced by the resolved data URI while a control property (`outline … !important`) survived. Style-level suppression of backgrounds is therefore unreliable under snapdom, and by the same mechanism border-image/mask-image suppression must be presumed single-layer. Fixes: (1) layer 1 now paints `box-shadow: inset 0 0 0 9999px REDACTION_FILL !important` on every masked and ignored clone element — a NON-url property that survives the pipeline, paints over the background (color and image) and under child content, needs no positioning, and makes a layer-1-only capture pixel-identical in color to the full pipeline (the `none` suppressions are kept as defense for renderers that honor the clone); REDACTION_FILL moved to masking/policy.ts and is shared by both layers. (2) Layer 2 rounds ALWAYS OUTWARD: 1 CSS px bleed → device px → floor/ceil outward → 1 extra device px outset, eliminating the ~1-device-px leading-edge sliver that sub-pixel crop/scroll offsets produced (over-covering by a pixel is fine; under-covering leaks). (3) The two-layer guarantee is now TESTED, not asserted: a test-only global (`__PATCHBACK_TEST_ONLY_DISABLE_RASTER_REDACTION__`, deliberately not part of PatchbackWidgetConfig) disables layer-2 painting, and a browser acceptance test captures with it set and pixel-proves the masked CSS background is NOT its source color (≤2%) and IS the redaction fill (≥95%), with unmasked content intact; the scrolled test's masked regions are sampled at inset(1) so an edge sliver fails CI. Residual, documented honestly: layer-1 coverage of border-ring imagery (border-image) relies on the kept `none` suppression plus layer 2's border-box rects — the inset shadow covers the padding box only.
**Why:** "Two independent layers" is only true if each layer is verified ALONE against the real renderer; both prior attempts asserted independence that the pipeline quietly violated.
**Context:** `packages/widget/src/masking/clone.ts` (inset shadow), `src/masking/policy.ts` (REDACTION_FILL), `src/capture/redact.ts` (outward rounding), `src/capture/screenshot.ts` (test-only switch), `apps/widget-playground/test/acceptance.browser.test.ts` (layer-1-only + inset(1) proofs); verifier rejection of phase-7 attempt 2.

## 2026-07-15 — CLI config split: secrets in .env, settings in an annotation-free patchback.config.ts

**Decision:** `patchback init` writes two files: `.env` (GITHUB_TOKEN, ANTHROPIC_API_KEY — merged in place, chmod 600, values never echoed) and `patchback.config.ts` (repo, testCommands, port, appOrigins, baseBranch, localRepoPath, maxChangedLines, triageModel — no secret fields exist in the type). The config template is deliberately **annotation-free** (JSDoc `@type` only), making it valid TypeScript AND valid JavaScript, so `patchback dev` loads it with a plain data-URL `import()` — no tsx/jiti/esbuild dependency, no TS compiler at runtime. TS-only syntax in a user-edited file produces a readable "keep it annotation-free" error. Runtime validation (`validatePatchbackConfig`) treats the file as outside-the-compiler input.
**Why:** BUILD_PLAN names the file `patchback.config.ts`; the alternatives were a config-loader dependency (against the minimal-deps posture and a cold-start risk for `npx patchback dev`) or a `.json`/`.mjs` rename (against the plan). Splitting secrets out keeps the config committable-if-wanted and makes "never commit secrets" structural. Both files are gitignored by `init` in a git work tree, and this repo's .gitignore gained `patchback.config.ts`.
**Context:** `packages/cli/src/{config-file,env,init}.ts`; round-trip + TS-syntax-error tests in `config-file.test.ts`.

## 2026-07-15 — Dev job logs stream through a Store decorator, which also scrubs secrets from persisted errors

**Decision:** `patchback dev` streams job progress by wrapping the Store (`instrumentStore`): every `createFeedback`/`setTriage`/`createJob`/`updateJob` success logs readable lines (canonical state in brackets, notes, PR link, `explainPatchFailure` rendering for `patch.failed`). The same decorator scrubs every configured secret (GitHub token, Anthropic key) from log lines AND from `job.error` + history notes BEFORE persistence. No new API/queue surface was added for log streaming.
**Why:** The store is the single choke point that both routes and workers already flow through, so a decorator observes the whole pipeline for free. The scrubbing is load-bearing, not cosmetic: the clone URL embeds the token (`https://x-access-token:<token>@github.com/...`) and `git clone` failure messages quote their argv — without scrub-at-persist the token would land in the terminal and in `job.error`, which the API serves to read-token holders. Alternatives (event emitter in api, log seam per worker) rejected as new surface duplicating what the store already sees.
**Context:** `packages/cli/src/logging.ts`; secret-leak regression test in `logging.test.ts` (clone error with embedded token → `[redacted]` in store and terminal).

## 2026-07-15 — CORS: explicit origin list in ApiConfig, wildcard unrepresentable, off by default (resolves the Phase-7 deferral)

**Decision:** `ApiConfig.cors?: { allowedOrigins }` registers `@fastify/cors` (11.x, aged) only when configured; `validateConfig` rejects `*` (and any `*`-containing origin) and non-origin strings at startup; `credentials: false` always (the API authenticates via Authorization headers set by page script, never cookies). Absent config → zero CORS headers. The CLI wires it from `patchback.config.ts` `appOrigins` (init default: `http://localhost:3000`).
**Why:** The dev snippet flow is cross-origin by construction (user's app on :3000, API on :8787). A wildcard on a bearer-token API would hand every website a same-key surface; making it unrepresentable beats documenting it.
**Context:** `packages/api/src/{config,server}.ts`, `src/cors.test.ts`; OPEN_ISSUES entry moved to Resolved.

## 2026-07-15 — Dev mode substitutes a PR-status poller for webhooks; webhook route stays off

**Decision:** `patchback dev` does NOT set a `webhookSecret` (no webhook route exists, per the Phase-6 no-unverified-endpoint rule) — localhost cannot receive GitHub deliveries anyway. Instead a poller checks `getPullRequestStatus` for tracked jobs at `pr.opened`/`pr.reviewed` (default every 15s); merged PRs walk `pr.reviewed → patch.shipped → feedback.closed` with the same "merge by a human implies review" note as the webhook handler; closed-without-merge is logged once and changes no state (still the OPEN_ISSUES-documented gap). The poller is read-only toward GitHub — the only client method it can reach is the status read.
**Why:** Without it, dev-mode jobs dead-end at `pr.opened` and the widget never shows the shipped/closed states that make the demo loop land. Polling the 5-per-run PR set is well inside rate limits.
**Context:** `packages/cli/src/pr-poller.ts`; canonical-tail walk + closed-without-merge + error-resilience tests in `pr-poller.test.ts`.

## 2026-07-15 — Token probe reads observable permissions, not scopes; failures are actionable sentences

**Decision:** Bad-credential failures are caught at startup/init by probing `GET /repos/:owner/:repo`: 401 → invalid/expired token, 404 → repo not granted to the fine-grained token (or typo), `permissions.push !== true` → missing Contents write, `has_issues: false` → warning (job starts would fail at issue creation). A second probe reads the repo's root package.json via the contents API and prints a clear "no test script — patches will NOT be gated by tests" message. Offline is warn-and-continue (init keeps the typed token; dev boots). Fine-grained PATs expose no scope introspection, so observed behavior is the only honest check.
**Why:** BUILD_PLAN demands readable failures for "bad token scopes" and "no test script"; failing at first patch job with a raw 403 from deep inside the pipeline is the failure mode this kills.
**Context:** `packages/cli/src/github-probe.ts` + tests; wired in `dev.ts` (fail closed) and `init.ts` (re-prompt up to 3 attempts).

## 2026-07-15 — Dev API keys are minted per run and printed; user secrets never are

**Decision:** `patchback dev` mints random `pb-dev-owner-…`/`pb-dev-insider-…` keys each boot, prints them in the banner, and embeds the insider key in the served snippet. The GitHub token and Anthropic key, by contrast, are never printed anywhere (enforced by tests). Rejected alternative: persisting dev keys in patchback.config.ts (a key in a maybe-committed file, for zero benefit — the widget snippet is re-printed each run).
**Why:** The tier keys only guard a localhost API bound to 127.0.0.1 and die with the process; printing them is what makes the snippet copy-paste work. The distinction between "session-local capability" and "user secret" is deliberate and documented in the snippet comment.
**Context:** `packages/cli/src/{dev,snippet}.ts`; banner in `renderDevBanner`.

## 2026-07-15 — Agent CLI spawns are isolated from the machine's global Claude Code config (defense in depth, verifier finding)

**Decision:** The claude-code adapter spawns the CLI with (a) a per-job EMPTY `CLAUDE_CONFIG_DIR` (mkdtemp, deleted after the run) plus an allowlisted environment — PATH/HOME/locale/`ANTHROPIC_API_KEY` only, via a new `runProcess` `inheritEnv: false` mode — and (b) `--bare --strict-mcp-config` appended to the invocation (overridable `isolationFlags` for older CLIs; the env layer stays on regardless). Separately, the changed-file sweep (`diffNumstat`) and the pipeline commit path both exclude any newly appearing top-level dot-directory absent from the base commit, with a warning per exclusion (pipeline warnings flow through a new `DefaultPipelineOptions.log` seam wired from `ApiConfig.log`).
**Why:** Phase-8 verification caught globally installed plugin hooks writing `.a5c/cache/*.json` + `.a5c/logs/*.log` — containing machine-local absolute paths — into the scratch clone during a real run; the intent-to-add sweep then published them into a real PR (#6 on the scratch repo, since cleaned). On ANY user's machine, ANY hook/plugin output would leak into THEIR PRs. Two independent layers because either alone has failure modes: flags can be overridden or lag CLI versions; the sweep filter catches artifacts from any source (not just the CLI). `--bare` also makes agent auth strictly `ANTHROPIC_API_KEY` (keychain/OAuth never read) — consistent with the local-first "token + API key" contract. Rejected: filtering only `.a5c` by name (today's plugin, not tomorrow's); a gitignore-based approach (artifacts aren't ignored in the target repo's terms).
**Context:** `packages/agent-claude-code/src/adapter.ts` (DEFAULT_ISOLATION_FLAGS, buildIsolatedEnv), `packages/agent-core/src/{git,process}.ts` (listNewTopLevelDotDirs, DiffNumstatOptions.warn, inheritEnv), `packages/api/src/pipeline.ts` (second-layer filter). Test-pinned: spawn-capture isolation tests in `adapter.test.ts`, sweep tests in `git.test.ts`, commit-path tests in `api/src/pipeline.test.ts`, and a live PR-diff assertion in the CLI live e2e.

## 2026-07-15 — Live e2e fixture is a seeded defect + user-voice report, never an instruction (verifier finding)

**Decision:** `packages/cli/test/live.e2e.test.ts` seeds the scratch repo with `docs/getting-started.md` containing a real typo ("recieve") via the GitHub contents API, then submits a natural defect REPORT ("Spotted a spelling mistake … should be 'receive'"). It asserts triage → `feedback.triaged` (patchable), real agent, real PR whose diff touches ONLY the seeded file (which live-pins the isolation fix — no dot-dir artifacts in the PR) and whose branch content actually fixes the typo; cleanup removes PR/branch/issue/seeded file.
**Why:** The previous canned message ("add a line … to the end of README.md") was instruction-shaped, and the real classifier correctly classifies instructions DOWN (needs_human/needs_clarification) — the test failed 3/3 with real credentials. The fixture must exercise the product's actual contract: feedback describes symptoms; triage and the agent decide the change. Weakening the classifier to accept instructions was never an option (triage-before-code is a product rule).
**Context:** `packages/cli/test/live.e2e.test.ts`; still env-gated behind `GITHUB_TOKEN` + `PATCHBACK_TEST_REPO` + `ANTHROPIC_API_KEY`, skips cleanly keyless.
