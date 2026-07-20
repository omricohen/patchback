# Roadmap

What Patchback deliberately does **not** do in v0.1, and roughly why. Nothing
here is promised or ordered; it is the parking lot for ideas that were pushed
out of scope on purpose (see `docs/BUILD_PLAN.md`, "Explicitly out of scope for
v0.1") plus follow-ups accumulated during the build. The v0.1 product rules —
no auto-merge, triage before code, trust tiers as a security boundary, opt-in
capture, local-first — are not on this list and are not up for relaxation.

## GitHub App mode

v0.1 is fine-grained-token only. `packages/github` already pins down the App
config shape: `createAppClient()` exists as a stub and throws
`GitHubAppModeNotImplementedError`. App mode would bring per-installation
tokens, org-wide installs, and finer audit trails, at the cost of hosting a
signing key — which conflicts with the zero-setup local story, so it waits
until there is a deployment mode that warrants it.

## Hosted mode & dashboard

Everything today runs on the user's machine (`npx patchback dev`). A hosted
API (multi-project, real Postgres/Redis, auth) and a web dashboard for
browsing feedback, threads, and job history are the obvious next surface —
but the OSS core stays local-first and telemetry-free regardless.

## Per-user token exchange for the widget

Today the widget's `apiKey` is the embedding app's key, so every visitor of an
internal page submits at that key's tier (documented prominently in the widget
and SDK READMEs). A per-user exchange — the host app trades its own session
for a short-lived, per-user Patchback token — would give real per-user tiers
and revocation. Design sketch lives in `.claude/OPEN_ISSUES.md` (2026-07-15).

## Check-runner sandboxing

The check runner executes the target repo's own lint/test scripts as the
local user, with the parent environment, right after an agent wrote changes.
Acceptable in the local-first model (documented in the agent-core README) but
deserves real sandboxing: env-stripped child processes, seatbelt/container
isolation, or a remote runner.

## Repo indexing

The repo-reader currently surfaces conventions (README, CONTRIBUTING,
AGENTS.md, package.json scripts). A proper index — symbols, ownership, prior
PRs — would let triage and the agent target changes in large repos with less
context stuffing.

## Hosted / indexed repo-aware triage

v0.2's repo-aware triage stage 2 (fixed-string probe of a local working copy,
paths+counts only, one-rung reconcile cap) runs ONLY where a real checkout
already exists — `patchback dev` with `localRepoPath`, and the evals. The
hosted API worker has no working copy at triage time (the clone happens later,
per-patchable item), so stage 2 is deliberately dead code there — we rejected
clone-for-triage because it would clone on every borderline item, including
hostile submissions (a DoS/cost amplifier). Bringing repo-aware triage to the
hosted path wants a persistent/indexed checkout pinned to the base commit
(which also fixes the local-mode working-copy-skew limitation), plus a probe
that can withstand adversarial submission volume. Semantic/embedding retrieval
(vs today's literal fixed-string) is a further extension. Both explicitly out
of scope until hosted mode happens.

## Outsider feedback clustering

Outsider-tier feedback is stored but never becomes agent input. Clustering
and deduplicating it ("34 people hit this same confusing empty state") would
make the data useful to humans without ever crossing the trust boundary.

## SQLite persistence for local dev

`patchback dev` keeps state in memory, so feedback threads die with the
process. A SQLite store (same `Store` interface as memory/Drizzle drivers)
would give durable local history with zero setup.

## Vue build

`@patchback/widget` is framework-free and `@patchback/react` wraps it; a
`@patchback/vue` wrapper is straightforward and waits on demand.

## Canonical state machine revisions

Two known gaps that need an owner-approved revision of the canonical job
states (they are a contract, not an implementation detail):

- A PR closed **without** merge is unrepresentable — the job rests at
  `pr.opened`/`pr.reviewed` forever. Likely fix: a `pr.closed` terminal state.
- `POST /jobs/:id/start` creates the GitHub issue before the state CAS, so
  two racing starts can file duplicate issues. Needs issue-after-CAS or an
  idempotency key.

## Custom check commands

`testCommands` in `patchback.config.ts` is recorded but informational; the
pipeline runs the target repo's own package.json scripts. Wiring configured
commands through the pipeline would support non-npm projects.

## Durable orchestration (Temporal or similar)

The queue is BullMQ with an in-memory fallback. If hosted mode happens,
long-running patch jobs may warrant a durable workflow engine. Explicitly out
of scope until then.
