# Open issues — Patchback

## Open

- **[2026-07-10] docs/SPEC.md is provisional** — the real spec was drafted in a Claude chat session and never saved into the repo. Current file is a consolidation of CLAUDE.md + BUILD_PLAN.md only. Omri: paste the original spec over it and remove the banner.
- **[2026-07-10] gitleaks not installed** — extraction checklist requires gitleaks sweeps before commits touching extracted material (Phase 2+). `brew install gitleaks` before starting Phase 2.
- **[2026-07-10] No GitHub remote yet** — repo is local-only. Needed before Phase 3 (integration tests against a scratch repo) and for the phase-branch → PR workflow.

- **[2026-07-10] Triage evals not yet run against a live model** — the Phase 5 eval suite (30 fixtures, ≥90% bar + absolute injection gate, `packages/triage/evals/`) is env-gated behind `ANTHROPIC_API_KEY` and verified to skip cleanly, but no live run has happened (no key in this session). Omri: run `ANTHROPIC_API_KEY=... pnpm --filter @patchback/triage test` once and record the numbers in docs/STATE.md; tune the system prompt / threshold if below the bar.

## Resolved

- **[2026-07-10 → 2026-07-10] Brief trust-tier guard not yet structural** — resolved in Phase 5 via the guarded-factory option: `GuardedTaskBrief` is branded with a unique symbol (not object-literal-constructible); `createBriefFromTriagedFeedback` is the only producer and enforces `canInitiatePatchJob(tier)` AND `triage.classification === 'patchable'`, stamping `feedbackId` + `sourceTier`; `AgentContext.brief` now requires the branded type.

- **[2026-07-10 → 2026-07-10] CLAUDE.md referenced missing/misplaced docs** — moved BUILD_PLAN.md to docs/, created docs/extraction-checklist.md and provisional docs/SPEC.md.
