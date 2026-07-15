# Open issues — Patchback

## Open

- **[2026-07-10] docs/SPEC.md is provisional** — the real spec was drafted in a Claude chat session and never saved into the repo. Current file is a consolidation of CLAUDE.md + BUILD_PLAN.md only. Omri: paste the original spec over it and remove the banner.
- **[2026-07-10] gitleaks not installed** — extraction checklist requires gitleaks sweeps before commits touching extracted material (Phase 2+). `brew install gitleaks` before starting Phase 2.
- **[2026-07-10] No GitHub remote yet** — repo is local-only. Needed before Phase 3 (integration tests against a scratch repo) and for the phase-branch → PR workflow.

- **[2026-07-10] Triage evals not yet run against a live model** — the Phase 5 eval suite (30 fixtures, ≥90% bar + absolute injection gate, `packages/triage/evals/`) is env-gated behind `ANTHROPIC_API_KEY` and verified to skip cleanly, but no live run has happened (no key in this session). Omri: run `ANTHROPIC_API_KEY=... pnpm --filter @patchback/triage test` once and record the numbers in docs/STATE.md; tune the system prompt / threshold if below the bar.

- **[2026-07-13] PR closed-without-merge is unrepresentable in the canonical machine** — `pull_request` closed with `merged: false` changes no job state (the webhook returns 202 and the job rests at `pr.opened`/`pr.reviewed`); notes ride on transitions only, so nothing can even be recorded on the job. Deliberate: no non-canonical edge was invented (CLAUDE.md "use exactly these"). Needs an owner-approved canonical-machine revision (e.g. a `pr.closed` terminal state) in a future phase. Lives in `packages/api/src/routes/webhooks.ts`.
- **[2026-07-13] Default patch pipeline's end-to-end path untested against real GitHub + agent** — `createDefaultPatchPipeline` is covered by local tests (temp git repo, fake adapter/client) and the seam is fake-driven in the acceptance suite, but no run with the real Claude Code adapter + a real repo has happened (same posture as the Phase 4 e2e: env-gated pieces exist per package, the composed run arrives with the Phase 8 CLI).
- **[2026-07-13] Feedback GET returns capture context to read-token holders unredacted** — decided non-blocking in the phase-6 plan (the token holder submitted the capture), but revisit when the widget ships if tokens get shared beyond the submitter.

- **[2026-07-15] API has no CORS support** — required by the Phase 8 `patchback dev` snippet flow (user's app on :3000, API on :8787). Phase 7 sidestepped it with the playground's Vite proxy (`/api` → localhost:8787). Add `@fastify/cors` behind explicit config — allowed origins listed by the user, never `*` with credentials. Lives with the CLI phase, which owns the serving topology.
- **[2026-07-15] Embedded apiKey confers its tier on every page visitor** — inherent to the design: the widget's `apiKey` is the EMBEDDING APP's key, so anyone who can load an internal page submits at that key's tier (and the key is visible in page source). Accepted for v0.1 with prominent README warnings (@patchback/widget, @patchback/sdk): internal apps behind the app's own authentication only; public pages go keyless (outsider, data-only). Revisit: per-user token exchange (roadmap thought, not v0.1).
- **[2026-07-15] Closed shadow roots are undetectable by the masking engine** — `element.shadowRoot` is null for closed roots, so the planned "host treated as masked in screenshots" cannot be implemented from outside. Current posture is fail-closed by construction: the renderer cannot serialize closed-root content at all (it never reaches the clone), so nothing leaks — but the host's box is also not painted in layer 2. Documented in the widget README. Revisit only if a renderer gains closed-root access.
- **[2026-07-15] Live triage evals still pending (carried)** — Phase 7 added no model calls (fake-pipeline harness only); the Phase 5 live-eval run against `ANTHROPIC_API_KEY` remains outstanding (see 2026-07-10 entry).

## Resolved

- **[2026-07-10 → 2026-07-10] Brief trust-tier guard not yet structural** — resolved in Phase 5 via the guarded-factory option: `GuardedTaskBrief` is branded with a unique symbol (not object-literal-constructible); `createBriefFromTriagedFeedback` is the only producer and enforces `canInitiatePatchJob(tier)` AND `triage.classification === 'patchable'`, stamping `feedbackId` + `sourceTier`; `AgentContext.brief` now requires the branded type.

- **[2026-07-10 → 2026-07-10] CLAUDE.md referenced missing/misplaced docs** — moved BUILD_PLAN.md to docs/, created docs/extraction-checklist.md and provisional docs/SPEC.md.

- **[2026-07-13] Phase 6 verifier advisories** — (1) stale header comment in packages/api routes/feedback.ts says reply tier includes the caller; code deliberately uses thread-minimum only, so a leaked read token submits at the thread's tier (capability-model choice; document it); (2) POST /jobs/:id/start creates the GitHub issue before the CAS — two concurrent starts can duplicate issues; (3) patch-worker success-path CAS failure silently drops PR metadata (add a log line). All non-critical; fold into Phase 8 or 10.
