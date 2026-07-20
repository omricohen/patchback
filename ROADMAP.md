# Roadmap

What Patchback deliberately does **not** do yet, and roughly why. Nothing here
is promised or ordered; it is the parking lot for ideas that were pushed out of
scope on purpose (see `docs/BUILD_PLAN.md`) plus follow-ups accumulated during
the build. The product rules — no auto-merge, triage before code, trust tiers as
a security boundary, opt-in capture, local-first — are not on this list and are
not up for relaxation.

## Shipped in v0.2

These were on the parking lot and are now in the product:

- **Source provenance** (`@patchback/provenance`) — build-time `data-pb-source`
  `file:line` stamping (Vite / Next SWC + Turbopack / babel), fail-closed path
  privacy, carried into the feedback payload so the agent starts at the source.
- **Bounded repair loop** — a failed check triggers one guided repair attempt
  (`MAX_REPAIR_ATTEMPTS = 1`) before the job fails; `repair.enabled` gates it.
- **Repo-aware triage (stage 2)** — a fixed-string probe of a local working copy
  (paths + counts only, one-rung reconcile cap) sharpens the classifier where a
  checkout exists (`patchback dev` with `localRepoPath`, and the evals).
- **GitHub Action mode** — signed-ingest + `patchback ci` + HMAC issue markers
  run the pipeline inside GitHub Actions with no long-running process.
- **Per-user token exchange** — public-facing apps mint short-lived,
  tier-ceilinged per-user tokens on their backend (`POST /tokens/exchange`)
  instead of shipping a raw key to the page.
- **Feedback outcome view** — the submitter sees a plain-language "what changed"
  summary (`Job.userSummary`) and, when the host's own preview provider
  publishes one, a relayed preview link (`Job.previewUrl`).

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

## Signing-key rotation & key IDs

v0.2 introduced two symmetric HMAC secrets — the Action-mode issue-marker
secret (`PATCHBACK_SIGNING_SECRET`) and the per-user token-exchange secret
(`tokenExchange.signingSecret`). Both rotate today only by swapping the secret,
which bulk-invalidates every outstanding marker/token at once (no zero-downtime
overlap, no per-token revoke). A `keyId`/version field in the marker and token
payloads — with the verifier accepting a small set of active keys — would enable
overlapping rotation and, for tokens, a place to hang store-backed per-token
revocation. Shared hook across both secrets; sketch in `.claude/OPEN_ISSUES.md`
(2026-07-19 marker, 2026-07-20 token).

## Multi-attempt repair

The repair loop is capped at a single guided attempt
(`MAX_REPAIR_ATTEMPTS = 1`); `repair.enabled` only turns it off. Multiple
attempts — with a per-job repair budget and per-attempt diff accounting so a
runaway agent can't inflate cost or blast radius — wait until real repos show a
class of failures a second guided pass reliably fixes.

## Thread-aggregate job state

Job state today is per-item. A feedback thread with several related items has no
single rolled-up status ("2 shipped, 1 in review, 1 needs clarification"). A
thread-aggregate view — derived from member job states, not a new canonical
state — would make multi-item threads legible in the widget and a future
dashboard.

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

## Patchback-provisioned preview environments

v0.2's outcome view **surfaces** a preview URL — it relays the URL the host's
own preview provider (Vercel/Netlify/Cloudflare/…) already publishes to the
GitHub Deployments API via the read-only `getPreviewDeploymentUrl` (dev poller)
and the payload-only `deployment_status` webhook (hosted). Patchback never
provisions a preview environment. Actually spinning up an isolated preview
deploy of a patch branch (so hosts WITHOUT their own preview CI still get a
link) is a separate, heavier feature — it needs a build/host integration, a
cost/quota model, and its own privacy/expiry story — and is explicitly out of
scope until (and if) it earns its keep. A related smaller follow-up: an
opt-in hosted background preview poller (mirroring the dev poller) if inbound
`deployment_status` event coverage ever proves insufficient for hosted mode.

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
