# Patchback — Product Spec

> **⚠️ PROVISIONAL.** The original spec was drafted in a Claude chat session and has not
> been imported into this repo yet. This file is a faithful consolidation of what
> `CLAUDE.md` and `docs/BUILD_PLAN.md` already state — nothing here is invented — but it
> lacks the detail of the original. Replace this file with the real spec, then delete
> this banner. Tracked in `.claude/OPEN_ISSUES.md`.

## What it is

An open-source feedback widget that turns user feedback into GitHub pull requests via AI
coding agents. Positioned for **internal apps**: teams embed the widget in their own
tools, and trusted users' feedback ("this label is wrong", "sort this table by date")
becomes reviewable PRs with no human in the loop until code review.

## The loop

widget → context capture → triage → GitHub issue → agent writes change on branch →
lint/tests → PR → human review → status back to widget

## Components

| Package                      | Responsibility                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/widget`            | Vanilla embeddable widget: launcher, panel, element picker, screenshot capture, console-error ring buffer, masking engine, thread view                                                                                 |
| `packages/react`             | React 18 wrapper + hooks (`@patchback/react`)                                                                                                                                                                          |
| `packages/sdk`               | Client SDK: submit, thread, status                                                                                                                                                                                     |
| `packages/api`               | Fastify app: feedback, jobs, webhooks; Drizzle/Postgres; BullMQ with in-memory fallback                                                                                                                                |
| `packages/github`            | Token + App modes; issues/branches/PRs                                                                                                                                                                                 |
| `packages/agent-core`        | Adapter interface (prepare, plan, execute, summarize), planner, repo-reader, scratch-dir lifecycle, check-runner, bounded repair loop (v0.2)                                                                           |
| `packages/agent-claude-code` | Default adapter: spawns Claude Code CLI headless, diff-size ceiling (default ~300 lines)                                                                                                                               |
| `packages/triage`            | Classifier + evals: `patchable` \| `needs_clarification` \| `needs_human`; optional repo-aware stage 2 (deterministic fixed-string `RepoProbe`, paths+counts only, one-rung reconcile cap) for borderline items (v0.2) |
| `packages/cli`               | `patchback` CLI incl. `npx patchback dev`                                                                                                                                                                              |
| `packages/types`             | Shared types: feedback item, job states, trust tiers, state machine, source-hint validator                                                                                                                             |
| `packages/provenance`        | Build-time source provenance (v0.2): `jsxImportSource` dev-runtime stamping of `data-pb-source="file:line"`, Vite/Next integrations, babel plugin (prod opt-in)                                                        |

## Job state machine (canonical)

```
feedback.received → feedback.triaged → feedback.needs_clarification | issue.created
issue.created → patch.queued → patch.running → patch.failed | patch.generated
patch.generated → pr.opened → pr.reviewed → patch.shipped → feedback.closed
```

Invalid transitions throw. `packages/types` is the single source of truth.

## Security model

1. **No auto-merge, ever.** Not behind a flag. PRs require human review.
2. **Triage before code.** Only `patchable` items may start a patch job. When uncertain,
   classify down (prefer `needs_clarification`).
3. **Trust tiers are a security boundary.** `owner` and `insider` may initiate patch
   jobs. `outsider` feedback is data only — never passed to an agent as instructions,
   only stored/clustered. Enforced server-side.
4. **Capture is opt-in and maskable.** Input masking on by default; selector
   ignore-list; screenshot redaction of masked elements. Masking works before any
   capture feature ships.
5. **Prompt-injection resistance.** Hostile/injection feedback must classify
   `needs_human` and never reach an agent (eval-enforced in `packages/triage`).
6. **Source hints are data to verify, never instructions (v0.2).** The
   `data-pb-source` attribute is page-controlled: `sourceHint` is validated at
   the widget, the API schema, and authoritatively in the guarded brief
   factory (relative paths only — no absolute paths, traversal, dot-segments,
   or `node_modules`; source-file extensions only; 512-char cap). Prompts
   render it as a starting point the agent must verify before editing; the
   emitting side never writes absolute paths into the DOM (fail-closed
   relativization against the repo root).
7. **Repair feedback is tool output, never user instructions (v0.2).** When a
   patch's post-execution checks fail, agent-core runs at most ONE bounded
   repair invocation, feeding the agent the failing checks' own output
   (which check, its command, its output tail) as clearly-delimited
   diagnostic DATA — never submitter-controlled text. The diff ceiling is
   enforced across the cumulative diff (original + repair); `patch.failed`
   only after the repair also fails; no new job states (the loop is internal
   to `patch.running`). Repair is on by default and can be disabled, but the
   one-attempt cap is fixed in v0.2.

## Local-first constraint

`npx patchback dev` works with only a GitHub fine-grained token + an Anthropic API key.
No GitHub App, no hosted services, no Redis/Postgres install, no telemetry in OSS.

## Success metric

A stranger clones this, runs `npx patchback dev`, and gets a PR on their own repo in
under 10 minutes.

## Out of scope for v0.1

Dashboard app, hosted anything, repo indexing, outsider clustering, Vue build, GitHub
App mode (stub interface only), Temporal.
