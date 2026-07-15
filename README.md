# Patchback

Open-source feedback widget that turns user feedback into GitHub pull requests via AI
coding agents — with a human review gate on every change.

**Status: pre-alpha. Works from a clone of this repo; not yet published to
npm (`npx patchback` lands with the first release — see the callout in the
quickstart).**

The loop: widget → context capture → triage → GitHub issue → agent writes change on a
branch → lint/tests → PR → human review → status back to the widget.

Design principles:

- **No auto-merge, ever.** Every change ships through a human-reviewed PR.
- **Triage before code.** Feedback is classified before any agent runs; uncertain or
  hostile input never reaches an agent.
- **Trust tiers.** Only trusted users can trigger patch jobs; outsider feedback is data,
  not instructions.
- **Local-first.** `npx patchback dev` will need only a GitHub fine-grained token and an
  Anthropic API key. No hosted services, no telemetry.

See [docs/SPEC.md](docs/SPEC.md) and [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## Quickstart

Goal: feedback submitted in your app becomes a reviewed pull request on your
repo, in under ten minutes, with nothing hosted.

**You need:**

- Node 20+ and a GitHub repository you own (PRs land there).
- A [GitHub fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
  restricted to that one repository, with exactly these repository
  permissions (details in [packages/github/README.md](packages/github/README.md)):
  Contents (read and write), Issues (read and write), Pull requests (read
  and write), Metadata (read). Nothing else.
- An [Anthropic API key](https://console.anthropic.com/) — used for triage
  and the coding agent.
- The [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  (`claude`, version 2.1+) on your PATH — the default agent adapter spawns
  it. The agent authenticates with your `ANTHROPIC_API_KEY` only.

**Steps:**

```sh
npx patchback dev
```

> **Running from this repo today** — until the packages are published,
> `npx patchback` does not resolve. From a clone, the equivalent is:
>
> ```sh
> pnpm install && pnpm build
> node packages/cli/dist/index.js dev
> ```

1. The first run notices there is no `patchback.config.ts` and drops into
   `patchback init`: it asks for the target repo (`owner/name`), the GitHub
   token (validated live — a bad token gets an actionable message and a
   re-prompt), the Anthropic key, how the repo runs its tests, and your
   app's dev origin (CORS allow-list, default `http://localhost:3000`).
   Secrets go to `.env` (chmod 600, never echoed); settings go to
   `patchback.config.ts`; both are gitignored automatically.
2. `patchback dev` then boots the whole loop in one process — API, triage
   worker, patch worker, in-memory store and queue. No Redis, no Postgres,
   no webhooks (PR status is polled). The banner prints a copy-paste widget
   snippet with a per-run dev API key:

   ```html
   <script src="http://127.0.0.1:8787/widget.js"></script>
   <script>
     Patchback.create({
       apiUrl: 'http://127.0.0.1:8787',
       apiKey: 'pb-dev-insider-…', // dev-only key, minted per run
     });
   </script>
   ```

3. Paste the snippet into your app's dev pages (or run an example app —
   see below), open your app, and submit a piece of feedback describing a
   real defect. The terminal streams every state:
   `feedback.received → feedback.triaged [patchable]`.
4. Click **Start patch** in the widget thread. The agent clones your repo
   into a scratch dir, makes the change, runs the repo's own lint/test
   scripts, and opens a PR: `patch.queued → patch.running → patch.generated
→ pr.opened`, with the PR link in the terminal and the widget.
5. Review the PR on GitHub and merge it yourself — Patchback never merges.
   The dev poller notices the merge and walks the job to `feedback.closed`;
   the widget shows the feedback as shipped.

Uncertain feedback never reaches the agent: the triage step classifies it
`needs_clarification` (the widget asks you a follow-up question) or
`needs_human` instead. Submissions without an API key are `outsider` tier —
stored as data, never turned into instructions.

## Example apps

- [`examples/nextjs-demo`](examples/nextjs-demo) — a fake internal ops
  dashboard (orders table) with three deliberately seeded one-line flaws.
  This is the app the demo GIF is shot on; the exact reproducible script is
  [docs/demo-flow.md](docs/demo-flow.md).
- [`examples/vite-demo`](examples/vite-demo) — the smallest useful embed:
  a static page plus one `createPatchbackWidget` call.

## Development

Node 20+, [pnpm](https://pnpm.io) 10+.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## License

[MIT](LICENSE)
