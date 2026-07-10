# Open issues — Patchback

## Open

- **[2026-07-10] docs/SPEC.md is provisional** — the real spec was drafted in a Claude chat session and never saved into the repo. Current file is a consolidation of CLAUDE.md + BUILD_PLAN.md only. Omri: paste the original spec over it and remove the banner.
- **[2026-07-10] gitleaks not installed** — extraction checklist requires gitleaks sweeps before commits touching extracted material (Phase 2+). `brew install gitleaks` before starting Phase 2.
- **[2026-07-10] No GitHub remote yet** — repo is local-only. Needed before Phase 3 (integration tests against a scratch repo) and for the phase-branch → PR workflow.

## Resolved

- **[2026-07-10 → 2026-07-10] CLAUDE.md referenced missing/misplaced docs** — moved BUILD_PLAN.md to docs/, created docs/extraction-checklist.md and provisional docs/SPEC.md.
