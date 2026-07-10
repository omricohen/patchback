# STATE — where we left off

_Last updated: 2026-07-10_

## Current phase

**Phase 0 (Scaffold) — DONE.** Next up: **Phase 1 — Shared types & job state machine** (`packages/types`).

## What's done

- Repo bootstrapped: branch `main`, two initial commits (docs/meta, then scaffold).
- Doc gaps fixed: `BUILD_PLAN.md` moved to `docs/`, `docs/extraction-checklist.md` written,
  `docs/SPEC.md` created as a **provisional** consolidation — Omri still needs to replace it
  with the real spec from the original Claude chat session.
- Monorepo scaffold: pnpm workspaces + turborepo, TS 5.9 (see DECISIONS — TS 7 breaks
  typescript-eslint), eslint 10 flat config + prettier, vitest 4, CI workflow
  (lint/test/build), LICENSE (MIT), SECURITY.md, .env.example.
- 10 placeholder packages + `apps/widget-playground`, each with a passing placeholder test.
- Gate green: `pnpm lint && pnpm test && pnpm build` all pass. Phase 0 acceptance
  (fresh clone → `pnpm install && pnpm test`) verified.

## Next concrete step

Phase 1: implement `FeedbackItem`, `CaptureContext`, `TrustTier`, `TriageResult`, `Job` and
the typed job state machine (invalid transitions throw) in `packages/types`, with unit tests
covering every legal and illegal transition. One branch: `phase-1-types`.

## Context to pick up cleanly

- Decision log: `.claude/DECISIONS.md`. Open issues: `.claude/OPEN_ISSUES.md`
  (SPEC.md provisional; gitleaks not installed; no GitHub remote yet).
- Job states are canonical in CLAUDE.md — use exactly those strings.
- `examples/*` intentionally not scaffolded until Phase 9.
