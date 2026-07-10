# STATE — where we left off

_Last updated: 2026-07-10_

## Current phase

**Phase 4 (Agent core + Claude Code adapter) — DONE** on branch
`phase-4-agent-core` (not merged, not pushed — Omri's call). Phase 2
(extraction pass) is still pending Omri dropping source material into
`extraction-inbox/`. Next up: **Phase 5 — Triage**.

## What's done

- Phases 0–1 and 3 merged to `main` (scaffold; types + state machine; GitHub
  token client).
- `packages/agent-core` (vendor-neutral — a test asserts no vendor SDK/CLI in
  its deps):
  - `adapter.ts` — `AgentAdapter` interface (`prepare`, `plan`, `execute`,
    `summarize`), `AgentContext`, `AgentPlan`, `ExecutionResult` (failure is
    data: `success: false` + useful `error`, not a throw), `AgentSummary`.
  - `brief.ts` — `TaskBrief` (title, description, constraints, fileHints,
    acceptanceCriteria, feedbackId). TRUST BOUNDARY lives here:
    `assertBriefSourceAllowed(tier)` throws for `outsider`; docs forbid
    outsider content in any brief field.
  - `scratch-dir.ts` — `~/.patchback/jobs/<id>` lifecycle; `withScratchDir`
    guarantees cleanup in `finally` (success, failure, or throw); base dir
    injectable for tests; job ids validated against path traversal.
  - `repo-reader.ts` — `readRepoConventions`: package manager from lockfiles
    → `packageManager` field → npm; scripts; README/CONTRIBUTING/AGENTS.md
    (CLAUDE.md fallback) truncated to 8k chars each.
  - `check-runner.ts` — `detectChecks` (lint/typecheck/test incl. aliases,
    skips the npm placeholder test script) + `runChecks` via the repo's own
    package manager; structured pass/fail with output tails and timeouts.
  - `process.ts` — shared `runProcess`: detached process-group SIGKILL on
    timeout (grandchild-safe), stdin input, stdout/stderr/combined capture.
  - `git.ts` — clone/branch/numstat plumbing; `diffNumstat` counts untracked
    files via `git add --intent-to-add`; binary files flagged, 0 lines.
- `packages/agent-claude-code` (default adapter, `createClaudeCodeAdapter`):
  - Spawns the CLI headless (`claude -p --output-format json
--permission-mode acceptEdits` by default), prompt on stdin, built from
    the brief + conventions with the ceiling and "no git commits" rules.
  - Diff ceiling: `maxChangedLines` default 300; over-ceiling fails with a
    message pointing back at triage. Zero-change runs fail too. Diff is the
    source of truth over the CLI's self-reported JSON.
  - `binaryPath`/`binaryArgs` injectable → unit tests run a fake CLI
    (`test/fixtures/fake-claude.mjs`, scenario-driven via FAKE_CLAUDE_MODE:
    label-change, huge-diff, no-op, garbage, cli-error, crash, hang).
  - Acceptance test (`src/pipeline.test.ts`): temp fixture repo (git init,
    button label, real lint/test scripts, npm lockfile) → clone into scratch
    dir → branch `patchback/<jobId>` → prepare/plan/execute/summarize →
    checks green, minimal 1-file +1/-1 diff verified, scratch dir gone after,
    including on mid-job failure.
  - Real-binary e2e in `src/e2e.test.ts` behind `PATCHBACK_E2E_CLAUDE=1`
    (optionally `PATCHBACK_E2E_CLAUDE_BIN`); verified cleanly skipped this
    session — no real CLI run was executed.
- Gate green: `pnpm lint && pnpm test && pnpm build` and `pnpm format:check`.

## Next concrete step

Phase 5 (`packages/triage`): classifier + `evals/` fixture set (~30 labeled,
incl. injection fixtures that must classify `needs_human`). Still outstanding
from earlier: run the GitHub integration round-trip once credentials exist;
Phase 2 extraction pass when material lands.

## Context to pick up cleanly

- Phase 4 decisions in `.claude/DECISIONS.md`: diff-as-ground-truth; 300-line
  ceiling fails toward triage (never "retry bigger"); trust boundary guard on
  TaskBrief (agent-core depends on @patchback/types); deterministic `plan()`;
  shared `runProcess` with process-group kills (the naive kill hung on npm
  grandchildren).
- Orchestration wiring (clone → branch → adapter → checks → commit via
  @patchback/github → PR) is demonstrated in `pipeline.test.ts` but the real
  worker/queue wiring is Phase 6/8 territory — nothing imports @patchback/github
  yet from the agent packages, by design.
- `phase-3-github` branch still exists (already merged to main);
  `phase-4-agent-core` is unmerged and unpushed.
- Open issues: `.claude/OPEN_ISSUES.md` (SPEC.md provisional; gitleaks not
  installed; no GitHub remote yet; Phase 2 pending).
