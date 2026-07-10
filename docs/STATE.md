# STATE — where we left off

_Last updated: 2026-07-10_

## Current phase

**Phase 5 (Triage classifier + evals) — CODE DONE** on branch
`phase-5-triage` (not merged, not pushed — Omri's call). One item
outstanding before the phase can be called fully verified: the live eval
run (needs `ANTHROPIC_API_KEY`; see below). Phase 2 (extraction pass) is
still pending Omri dropping source material into `extraction-inbox/`.
Next up: **Phase 6 — API + orchestration**.

## What's done (Phase 5)

- `packages/triage` — classifier per the approved plan
  (`.a5c/runs/01KX6GMZ9TJBCR1RH3CCNMM77E/artifacts/phase-5-plan.md`):
  - `model.ts` — vendor-neutral `ModelCaller` seam + `TriageModelError`
    (transport errors throw; they never become classifications).
  - `anthropic.ts` — the ONLY file importing `@anthropic-ai/sdk`
    (approved dep). Default model `claude-opus-4-8` (configurable),
    adaptive thinking, `output_config` low effort + json_schema
    structured output, SDK retries; errors mapped via testable
    `toTriageModelError`.
  - `prompt.ts` — frozen system prompt (classify-down + injection rules);
    user message wraps all submitter content in per-call nonce DATA
    blocks with tag-shape sanitization; caps per field; console capped
    at last 5 entries; trust tier stated outside blocks; screenshot
    never serialized.
  - `schema.ts` — output schema + validation: unparseable/unknown-enum/
    non-object output → failsafe `needs_human`/confidence 0; confidence
    clamped to [0,1].
  - `threshold.ts` — one-step demotion ladder at configurable 0.7
    (strict `<`): patchable→needs_clarification (question preserved or
    deterministic fallback), needs_clarification→needs_human (question
    dropped), needs_human floor; demotions annotated in reasoning.
  - `classifier.ts` — `triageFeedback(item, {callModel, ...})`; OUTSIDER
    SHORT-CIRCUIT: outsider items return deterministic `needs_human`
    with ZERO model invocations (unit-tested guarantee).
  - 53 unit tests across 5 files, scripted fake ModelCallers (no
    vi.mock, no network): prompt containment (feedback never in the
    system prompt), delimiter escape, failsafe, ladder, short-circuit,
    error mapping.
- `packages/triage/evals/` — 30 labeled generic fixtures (typo/copy/
  default/sort/confusing/under-specified/feature/redesign/bug/
  borderline + 6 injection vectors incl. console- and element-smuggled
  instructions); `score.ts` (accuracy, per-tag, misses, gate);
  `eval.test.ts` env-gated on `ANTHROPIC_API_KEY` with TWO assertions —
  accuracy ≥ 90% AND the absolute injection gate (any `mustNotBe`
  violation fails the run regardless of score). Verified to SKIP
  cleanly keyless this session.
- `packages/agent-core` — structural trust-tier guard (resolves the
  OPEN_ISSUES advisory): branded `GuardedTaskBrief` (unique symbol; not
  object-literal-constructible), `createBriefFromTriagedFeedback`
  enforcing eligible tier AND patchable classification, stamping
  `feedbackId` + `sourceTier`; `AgentContext.brief` now requires the
  branded type. `agent-claude-code` fixtures build their brief through
  the factory (and the package gained a @patchback/types dep).
- Gate green keyless: `pnpm lint && pnpm test && pnpm build` and
  `pnpm format:check` (evals + github integration + claude e2e all
  skip cleanly).

## Next concrete step

1. **Run the live evals once** (Omri, needs a key):
   `ANTHROPIC_API_KEY=... pnpm --filter @patchback/triage test`
   — record accuracy + per-tag numbers here; tune system prompt /
   threshold if under 90% or if any injection fixture leaks. Cost is
   well under $1/run. `PATCHBACK_EVAL_RUNS=3` for a stability check.
2. Merge decision on `phase-4-agent-core` (already merged to main
   earlier) housekeeping: delete stale branch if desired; then review +
   merge `phase-5-triage`.
3. Phase 6: API + orchestration — wire `triageFeedback` into the
   feedback intake path and `createBriefFromTriagedFeedback` into the
   job runner; server-side tier middleware remains the primary
   enforcement. Open design questions flagged in the plan: no
   `needs_human` edge in the job state machine; re-triage after a
   clarification reply is undefined.

## Context to pick up cleanly

- Phase 5 decisions in `.claude/DECISIONS.md` (six entries dated
  2026-07-10): ModelCaller seam + SDK confinement; outsider
  short-circuit; failsafe + demotion ladder; injection posture;
  branded brief factory (supersedes the Phase 4 runtime-guard-only
  decision); env-gated eval runner with acceptable-set grading.
- The triage core never reads env vars — `ANTHROPIC_API_KEY` is read
  only inside `createAnthropicModelCaller` (the CLI/API will own config
  in later phases).
- `triageFeedback` is side-effect-free: it starts no jobs and builds no
  briefs. Only the Phase 6 orchestrator may act on `patchable`, and
  only through the guarded factory.
- Open issues: `.claude/OPEN_ISSUES.md` (SPEC.md provisional; gitleaks
  not installed; no GitHub remote; live eval run pending).
