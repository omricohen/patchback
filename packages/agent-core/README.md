# @patchback/agent-core

Agent plumbing for [Patchback](https://github.com/omricohen/patchback):
everything the patch pipeline needs around an AI coding agent, with the agent
itself behind a pluggable adapter interface.

- **Adapter interface** — `prepare` / `plan` / `execute` / `summarize`. Core
  never imports a vendor SDK; adapters (e.g.
  [`@patchback/agent-claude-code`](https://github.com/omricohen/patchback/tree/main/packages/agent-claude-code#readme))
  plug in.
- **Guarded task briefs** — `createBriefFromTriagedFeedback()` is the only way
  to construct a brief an adapter will accept, and it enforces the trust
  boundary: only `patchable` triage results from tiers allowed to initiate
  patch jobs. Outsider feedback cannot become agent instructions.
- **Repo reader** — surfaces README / CONTRIBUTING / AGENTS.md / package.json
  conventions to the agent.
- **Scratch-dir lifecycle** — per-job working dir with guaranteed cleanup.
- **Check runner** — detects and runs the target repo's own lint / test /
  typecheck scripts. Note: these scripts run unsandboxed as your user, right
  after the agent writes changes — treat target repos accordingly.

Part of the Patchback monorepo — see the
[root README](https://github.com/omricohen/patchback#readme). MIT licensed.
