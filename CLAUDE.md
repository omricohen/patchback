# CLAUDE.md — Patchback

Open-source feedback widget that turns user feedback into GitHub pull requests via AI coding agents. This repo is being **extracted from existing production tooling** in private client projects, then generalized for public release.

## What this is

One loop: widget → context capture → triage → GitHub issue → agent writes change on branch → lint/tests → PR → human review → status back to widget.

Read before doing anything else:

- `docs/SPEC.md` — full product spec (internal-apps positioning, components, security model)
- `docs/BUILD_PLAN.md` — phased build order. Work ONE phase at a time. Do not skip ahead.
- `docs/extraction-checklist.md` — rules for what may and may not enter this repo

## Non-negotiable product rules

1. **No auto-merge. Ever.** Not behind a flag, not in a config option. PRs require human review.
2. **Triage before code.** Every feedback item is classified: `patchable` | `needs_clarification` | `needs_human`. Only `patchable` items may start a patch job. When uncertain, classify DOWN (prefer needs_clarification over patchable).
3. **Trust tiers are a security boundary.** `owner` and `insider` tiers may initiate patch jobs. `outsider` feedback is data only — it must NEVER be passed to an agent as instructions, only stored/clustered. Do not weaken this for convenience.
4. **Capture is opt-in and maskable.** No new default data capture without explicit config. Masking (inputs, emails, selectors) must work before any capture feature ships.
5. **Local-first.** `npx patchback dev` must work with only a GitHub fine-grained token + an Anthropic API key. No GitHub App, no hosted services, no telemetry in the OSS version.

## Non-negotiable repo hygiene (extraction context)

- This repo must contain ZERO client identifiers. Before any commit, check for: client names, client domains, staging URLs, real people's names in fixtures, internal hostnames/IPs, references to the private orchestration system ("Mission Control").
- All prompts/agent instructions must be generic. If source material references a specific business domain (legal, staffing, etc.), rewrite it.
- Never commit secrets. `.env` is gitignored; `.env.example` has placeholders only. If you ever see a real-looking key in source material, stop and flag it to me — do not copy it, do not commit.
- Fresh history only: nothing is imported via git history, only as scrubbed working files.

## Stack & conventions

- TypeScript everywhere. Node 20+. **pnpm only** (never npm/yarn). Monorepo via pnpm workspaces + turborepo.
- Widget: React 18, built with Vite, published as `@patchback/react` plus a vanilla `@patchback/widget` build.
- API: Fastify. Postgres via Drizzle. Queue: BullMQ (Redis) with an in-memory fallback for local dev so `npx patchback dev` needs no Redis.
- Local runner: Node CLI (`packages/cli`, bin: `patchback`). Agent runs in a scratch dir under `~/.patchback/jobs/<id>`, deleted after job completion.
- Agent adapter interface in `packages/agent-core`. Default adapter: Claude Code (spawned CLI). Adapters are pluggable; core never imports a specific vendor SDK directly.
- Tests: vitest. Every package has tests; triage classifier has an eval fixture set in `packages/triage/evals/`.
- Lint: eslint + prettier defaults, no bikeshedding. `pnpm lint && pnpm test && pnpm build` must pass before any commit.
- Commits: plain imperative, small and scoped. One phase = one PR-sized branch.

## Repo layout (target)

```
apps/
  widget-playground/     # dev harness for the widget
packages/
  widget/                # vanilla embeddable widget
  react/                 # React wrapper + hooks
  sdk/                   # client SDK: submit, thread, status
  api/                   # Fastify app (feedback, jobs, webhooks)
  github/                # token + App modes; issues/branches/PRs
  agent-core/            # adapter interface, planner, repo-reader
  agent-claude-code/     # default adapter
  triage/                # classifier + evals
  cli/                   # `patchback` CLI incl. `dev` command
  types/                 # shared types (feedback item, job states, tiers)
examples/
  nextjs-demo/
  vite-demo/
docs/
```

## Job states (canonical — use exactly these)

`feedback.received → feedback.triaged → feedback.needs_clarification | issue.created → patch.queued → patch.running → patch.failed | patch.generated → pr.opened → pr.reviewed → patch.shipped → feedback.closed`

## How to work in this repo

- Follow `docs/BUILD_PLAN.md` phase order. At the start of a session, state which phase you're on; at the end, update `docs/STATE.md` with what's done, what's next, and any decisions made.
- Plan before large changes. For anything touching the trust boundary, triage, or capture defaults, present the plan and wait for my approval.
- The success metric for everything is: a stranger clones this, runs `npx patchback dev`, and gets a PR on their own repo in under 10 minutes. When in doubt, optimize for that.
- Definition of done for the whole project: `docs/extraction-checklist.md` fully checked, demo GIF flow reproducible on `examples/nextjs-demo`, README quickstart verified cold.
