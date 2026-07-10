# STATE — where we left off

_Last updated: 2026-07-10_

## Current phase

**Phase 1 (Shared types & job state machine) — DONE** on branch `phase-1-types` (not yet merged to `main`).
Next up: **Phase 2 — Extraction pass** (Omri drives; source material lands in `/extraction-inbox/`).

## What's done

- Phase 0 scaffold (see git history on `main`).
- `packages/types` implemented as the shared contract:
  - `trust.ts` — `TrustTier` (`owner | insider | outsider`), `PATCH_ELIGIBLE_TIERS`,
    `canInitiatePatchJob()` (outsider always false), `isTrustTier()`.
  - `capture.ts` — `CaptureContext` (all fields optional — capture is opt-in), plus
    `ConsoleEntry`, `PickedElement`, `Viewport`; screenshot carries a `masked` flag.
  - `triage.ts` — `TriageClassification` (`patchable | needs_clarification | needs_human`),
    `TriageResult` (confidence, reasoning, clarifyingQuestion), `isTriageClassification()`.
  - `feedback.ts` — `FeedbackItem` (message, trustTier, optional submitter/capture/triage).
  - `job.ts` — canonical `JOB_STATES` (exact CLAUDE.md strings), `JOB_STATE_TRANSITIONS`
    adjacency map, `INITIAL_JOB_STATE`, `canTransition` / `assertTransition` /
    `nextJobStates` / `isTerminalJobState` / `isJobState`, `InvalidJobTransitionError`
    (carries `from`/`to`), `Job` + `JobStateChange` history, pure `transitionJob()`.
- Tests: 196 passing. The state-machine suite declares the legal transition list
  independently of the implementation and sweeps all 144 state pairs — every legal
  (11) and illegal (133) transition asserted, plus terminal states, error shape,
  happy path, failure path, and immutability. Phase 1 acceptance met.
- Gate green: `pnpm lint && pnpm test && pnpm build` and `pnpm format:check` all pass.

## Next concrete step

Phase 2: Omri drops source material into `extraction-inbox/`; for each file, generalize,
strip client context per CLAUDE.md hygiene rules, move into the right package, delete
from inbox. Accept: inbox empty, forbidden-term grep clean, gitleaks clean (gitleaks
still not installed — see OPEN_ISSUES).

## Context to pick up cleanly

- Decisions logged for Phase 1 in `.claude/DECISIONS.md`: only canonical edges modeled
  (`feedback.needs_clarification`, `patch.failed`, `feedback.closed` are terminal — no
  invented retry/clarification-loop edges yet), and `Job` carries an immutable transition
  history with a pure `transitionJob()`.
- `phase-1-types` branch is unmerged and unpushed; merge/PR is Omri's call.
- Open issues: `.claude/OPEN_ISSUES.md` (SPEC.md provisional; gitleaks not installed;
  no GitHub remote yet).
