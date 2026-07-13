# STATE — where we left off

_Last updated: 2026-07-13_

## Current phase

**Phase 6 (API: Fastify + queue + trust tiers) — CODE DONE** on branch
`phase-6-api` (not merged, not pushed — Omri's call), implemented per the
approved plan
(`.a5c/runs/01KX6GMZ9TJBCR1RH3CCNMM77E/artifacts/phase-6-plan.md`).
Phase 2 (extraction pass) still pending source material in
`extraction-inbox/`. Next up: **Phase 7 — Widget + SDK** (or merge/review
of this branch first).

## What's done (Phase 6)

- `packages/api` — the orchestrator:
  - `buildServer(config)` (pure over `ApiConfig`, never reads env):
    POST /feedback, GET /feedback/:id, POST /feedback/:id/reply,
    POST /jobs/:id/start, GET /jobs/:id/status, POST /webhooks/github.
  - Server-side tier assignment ONLY: config API-key→tier map
    (owner/insider; an outsider key is unrepresentable and rejected at
    startup), no/unknown key ⇒ outsider, constant-time compare,
    body-supplied `trustTier` ⇒ 400 (ajv `removeAdditional` off).
  - `POST /jobs/:id/start` enforces caller tier AND stored-item tier
    (outsider feedback is data only, even for an owner caller — 403
    `tier_forbidden` with "data only" message), state gate
    (`feedback.triaged`, 409) and triage gate (`patchable`, 403
    `triage_gate`). Issue created synchronously; job CAS-advanced
    `feedback.triaged → issue.created → patch.queued`.
  - Replies: new linked item (+`threadId`/`inReplyTo`, additive in
    @patchback/types) + new job; original stays terminal; effective tier =
    thread minimum; reply triage sees thread context in DATA blocks
    (`ThreadContext` added to @patchback/triage, containment-tested).
  - Workers (`createWorkers`): triage worker (outsider short-circuit
    upstream in triageFeedback; TriageModelError → queue retry;
    `needs_human` rests at `feedback.triaged`) and patch worker (guarded
    brief factory is the only brief producer; deterministic brief fields;
    failure → `patch.failed` with error preserved; never retried).
  - Storage: `Store` interface + MemoryStore (dev default, zero deps) +
    DrizzleStore (pg, CAS `UPDATE … WHERE state=expected`, committed
    migration `packages/api/migrations/0000_init.sql` with tier/state
    CHECKs). Runtime `isTrustTier`/`isJobState` fail-closed validation at
    every boundary (config load, auth, deserialization, prompt path) —
    Phase 5 carry-over item 2 closed.
  - Queue: `TaskQueue` + MemoryQueue (FIFO, `onIdle()`, triage×3/patch×1
    retries) + BullMQQueue (only file importing bullmq).
  - Webhooks: route exists only with `webhookSecret`; raw-body HMAC
    (timing-safe) before parsing; handler constructed WITHOUT a
    GitHubClient (spy-asserted zero outbound calls); merged PR walks
    `pr.opened → pr.reviewed → patch.shipped → feedback.closed`.
  - PatchPipeline seam + `createDefaultPatchPipeline` (scratch dir →
    clone → adapter lifecycle → check-runner → branch/commit/PR),
    locally tested with a temp git repo and fakes.
- Repo-wide `pnpm typecheck` covering tests/evals (turbo task + CI step);
  the GuardedTaskBrief `@ts-expect-error` brand test is now live
  (verified TS2578 fires if the brand is removed) — carry-over item 1
  closed. Fixed a latent expect-type misuse it caught in
  agent-claude-code.
- Tests: 100+ across the api package — unit (auth, config, webhook
  verify, tier min, row-mapping corruption), store conformance
  (parameterized; Drizzle env-gated `PATCHBACK_TEST_DATABASE_URL`),
  queue (BullMQ env-gated `PATCHBACK_TEST_REDIS_URL`), pipeline, routes
  (full start-gate matrix), and `test/integration.test.ts` — the phase
  acceptance: happy path through the exact canonical history, outsider
  rejection (zero model calls proof + owner-key 403), clarification
  loop, webhook auth, no-merge spy, patch-failure path.
- Env-gated suites verified GREEN this session against ephemeral local
  Postgres 17 + Redis (then torn down); they skip cleanly keyless.
- Gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  and `pnpm format:check`, zero credentials/services.

## Next concrete step

1. Review + merge `phase-6-api` (6 commits).
2. Run the live triage evals once (still pending from Phase 5, needs
   `ANTHROPIC_API_KEY`).
3. Phase 7 — Widget + SDK: the widget consumes
   `{id, jobId, readToken}` from POST /feedback, polls
   GET /jobs/:id/status (canonical states, presentation mapping is the
   widget's job), thread view from GET /feedback/:id, replies via
   POST /feedback/:id/reply.

## Context to pick up cleanly

- Phase 6 decisions in `.claude/DECISIONS.md` (eight entries dated
  2026-07-13): server-side tier map; read tokens; reply/thread model with
  min-tier; needs_human-as-classification; storage split (SQLite
  deferred with revisit condition); queue semantics (patch never
  auto-retried); webhook posture (no client in handler); repo-wide
  typecheck.
- New OPEN_ISSUES: PR closed-without-merge unrepresentable (needs an
  owner-approved canonical-machine revision someday); default pipeline
  not yet run against real GitHub + agent (Phase 8 CLI composes it);
  capture context unredacted for read-token holders (accepted for now).
- PR-status POLLING for local dev (webhooks can't reach localhost) is
  deferred to Phase 8 per the plan — the store-updating pieces exist;
  no poll loop shipped.
- The api package never reads `process.env`; the CLI (Phase 8) owns
  config loading and supplies the concrete agent adapter
  (`ApiConfig.adapter` + `repoSource`, or a prebuilt `pipeline`).
