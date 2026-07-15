# Contributing to Patchback

Thanks for helping. Small, focused PRs land fastest.

## Dev setup

Requirements: Node 20+, [pnpm](https://pnpm.io) (this repo is pnpm-only —
never npm or yarn).

```sh
git clone https://github.com/omricohen/patchback
cd patchback
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

That last line is **the gate** — it must pass before every commit, and CI runs
exactly it. `pnpm format` fixes prettier complaints.

Useful entry points:

- `apps/widget-playground` — dev harness for the widget (`pnpm dev` inside).
- `examples/nextjs-demo`, `examples/vite-demo` — embed examples; the demo flow
  is scripted in `docs/demo-flow.md`.
- Running the CLI from the repo: `pnpm build`, then
  `node packages/cli/dist/index.js dev`.

Some tests are env-gated (live GitHub round-trips, real-agent e2e, triage
evals against the real model). They skip without credentials; plain
`pnpm test` needs no secrets, no Redis, no Postgres.

## Workflow

- Branch from `main`, one topic per branch. The maintainers use
  `phase-<n>-<topic>` branches for build-plan phases; for contributions any
  descriptive branch name is fine.
- Commits: plain imperative, small and scoped ("Fix widget scroll restore",
  not "fixes").
- Open a PR against `main` and fill in the template. Every PR is reviewed by
  a human — this project does not auto-merge anything, including its own PRs.

## Hard rules

These are product invariants, not style preferences. PRs that violate them
will be declined regardless of quality (see `CLAUDE.md` and `SECURITY.md` for
the reasoning):

1. **No auto-merge, ever.** Not behind a flag, not as a config option.
2. **Triage before code.** Only `patchable` feedback may start a patch job;
   when uncertain, classify down.
3. **Trust tiers are a security boundary.** `outsider` feedback is data only —
   it must never be passed to an agent as instructions.
4. **Capture is opt-in and maskable.** No new default data capture.
5. **Local-first.** `npx patchback dev` needs only a GitHub token and an
   Anthropic API key; no hosted services or telemetry in the OSS version.

Also: no secrets or personal data in fixtures (run `gitleaks detect` —
`.gitleaks.toml` in the repo root is the config), and don't add dependencies
without discussing in the PR.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — please don't open public issues for
vulnerabilities.
