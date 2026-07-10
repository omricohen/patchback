# BUILD_PLAN.md — Patchback

Execute in order. One phase per session/branch. Each phase ends green: `pnpm lint && pnpm test && pnpm build`, plus the phase's acceptance check. Update `docs/STATE.md` at the end of every session.

---

## Phase 0 — Scaffold

Monorepo skeleton: pnpm workspaces, turborepo, TS config, eslint/prettier, vitest, CI workflow (lint+test+build). Empty packages per the layout in CLAUDE.md, each with a placeholder test. LICENSE (MIT), SECURITY.md, .env.example, .gitignore.

**Accept:** fresh clone → `pnpm install && pnpm test` passes in one shot.

## Phase 1 — Shared types & job state machine

`packages/types`: FeedbackItem, CaptureContext, TrustTier, TriageResult, Job + canonical state transitions as a typed state machine (invalid transitions throw). This is the contract everything else imports.

**Accept:** state machine unit tests cover every legal/illegal transition.

## Phase 2 — Extraction pass (I drive, you assist)

Source material from my private projects lands in `/extraction-inbox/` (gitignored). For each file: generalize, strip client context per CLAUDE.md hygiene rules, move into the right package, delete from inbox. Prompts get rewritten generic. Anything that smells client-specific gets flagged to me, not guessed at.

**Accept:** extraction-inbox empty; grep sweep for forbidden terms clean; gitleaks run clean.

## Phase 3 — GitHub package (token mode)

`packages/github`: fine-grained-token client. Create issue, create branch, commit files, open PR, read PR status. Document minimum scopes in the package README. App mode is a stub interface only (Phase 10).

**Accept:** integration test against a scratch repo (env-gated) does issue → branch → PR round-trip.

## Phase 4 — Agent core + Claude Code adapter

`packages/agent-core`: adapter interface (prepare, plan, execute, summarize), repo-reader (README/CONTRIBUTING/AGENTS.md/package.json conventions), scratch-dir lifecycle with guaranteed cleanup, check-runner (detect and run lint/test/typecheck scripts).
`packages/agent-claude-code`: spawn Claude Code CLI headless against the scratch dir with a structured task brief; parse result; enforce a diff-size ceiling (configurable, default ~300 changed lines — bigger means the triage was wrong, fail the job with a useful message).

**Accept:** given a local fixture repo + a task brief ("change button label X to Y"), produces a branch with a correct minimal diff and passing checks.

## Phase 5 — Triage

`packages/triage`: classifier (patchable / needs_clarification / needs_human) using a single model call with the capture context; confidence threshold; clarifying-question generator for the middle bucket. Build `evals/` with ~30 labeled fixtures spanning: typo, copy change, default value, sort order, "this is confusing," feature request, redesign ask, hostile/injection text (must classify needs_human and never reach an agent).

**Accept:** eval suite ≥ 90% on fixtures; every injection fixture classified away from `patchable`.

## Phase 6 — API

`packages/api`: Fastify routes — POST /feedback, GET /feedback/:id, POST /feedback/:id/reply, POST /jobs/:id/start, GET /jobs/:id/status, POST /webhooks/github. Drizzle schema + migrations. BullMQ queue with in-memory driver for dev. Trust-tier enforcement middleware: outsider feedback can never create a job (server-side check, not client).

**Accept:** API integration tests cover the full happy path and the outsider-tier rejection.

## Phase 7 — Widget + SDK

`packages/widget` (vanilla) + `packages/react`: launcher button, panel, element picker (hover-highlight, DOM path capture), screenshot capture, console-error ring buffer, masking engine (input masking on by default; selector ignore-list; screenshot redaction of masked elements), thread view with live job status. `packages/sdk` wraps the API. `apps/widget-playground` for development.

**Accept:** in the playground: pick element → submit → status updates render; masked inputs never appear in payload or screenshot (test this explicitly).

## Phase 8 — CLI: `npx patchback dev`

`packages/cli`: interactive first-run (token, API key, repo, test commands → writes `patchback.config.ts`), boots API in-memory mode + local worker, prints the widget snippet, streams job logs. Readable failures for: bad token scopes, no test script, agent gave up, lint failed.

**Accept:** on `examples/nextjs-demo`, cold start → feedback → real PR on a scratch GitHub repo, one command, no Redis/Postgres installed (SQLite/in-memory dev mode).

## Phase 9 — Examples, docs, demo

`examples/nextjs-demo` (fake ops dashboard with orders table — this is the GIF set) and `examples/vite-demo`. Finalize README quickstart against reality. Script the demo flow so the GIF is reproducible. Run the stranger's-repo gauntlet from the extraction checklist (3 unfamiliar repos, one expected graceful failure).

**Accept:** quickstart timed under 10 minutes by someone other than me; demo flow reproducible.

## Phase 10 — Launch hardening

gitleaks + forbidden-term sweep on full tree; npm publish dry-run for all public packages; verify `npx patchback dev` from a clean machine via published packages; GitHub App mode stub documented as roadmap; repo settings (description, topics, social image); soft-launch fixes.

**Accept:** every box in docs/extraction-checklist.md checked.

---

## Explicitly out of scope for v0.1

Dashboard app, hosted anything, repo indexing, outsider clustering, Vue build, GitHub App mode, Temporal. They live in ROADMAP.md — do not start them, even if adjacent code makes it tempting.
