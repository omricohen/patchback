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
   scripts, and opens a PR: `issue.created → patch.queued → patch.running → patch.generated
→ pr.opened`, with the PR link in the terminal and the widget.
5. Review the PR on GitHub and merge it yourself — Patchback never merges.
   The dev poller notices the merge and walks the job to `feedback.closed`;
   the widget shows the feedback as shipped.

Uncertain feedback never reaches the agent: the triage step classifies it
`needs_clarification` (the widget asks you a follow-up question) or
`needs_human` instead. Submissions without an API key are `outsider` tier —
stored as data, never turned into instructions.

### The outcome view: a non-technical summary + a preview link

The person who submitted the feedback sees, in the widget thread, a
non-technical account of what their feedback became — not a diff:

- **Plain-language summary.** When the agent opens a PR it also writes a
  one- or two-sentence, jargon-free summary of what changed and why it
  addresses the feedback. It renders as a short "What changed" note in the
  thread (and, in Action mode, in the outcome comment on the issue). It is
  best-effort: if the agent doesn't produce one, nothing extra renders — it is
  never fabricated.
- **"Preview this change" link.** If your repo already has a preview-deploy
  provider (Vercel, Netlify, Cloudflare Pages, …), Patchback surfaces the
  preview URL that provider publishes to GitHub — it does **not** create
  preview environments. The link appears once your deploy finishes (seconds to
  minutes after the PR opens). This needs the token's optional
  **`Deployments: read`** permission; without it, everything else works and the
  link simply never appears.

Both are shown only to the same audience that already sees the job's status for
that item (the submitter's read token, or an owner/insider key). Preview links
are your existing provider's URLs — if your previews must stay private, use your
provider's preview-environment protection; Patchback relays the URL, it does not
gate it.

### Public-facing apps: per-user token exchange

The dev quickstart above ships the embedding app's `apiKey` to the page. That is
fine for an **internal app behind your own auth** (every visitor is a trusted
teammate), but on a **public-facing or many-user app** a raw key in page source
would confer its tier on every visitor. For those, mint a **short-lived,
tier-scoped per-user token** on your **backend** and hand it to the widget:

```
Browser (widget)            Your app backend              Patchback API
     │                             │                            │
     │  GET /patchback-token ─────▶│  (authenticates the user   │
     │  (your app's session)       │   via YOUR session)        │
     │                             │  POST /tokens/exchange ───▶ │
     │                             │  Authorization: <server key>│
     │                             │  { tier, ttlMs, subject }   │
     │                             │◀── { token, tier, expiresAt}│
     │◀── { token, expiresAt } ────│                            │
     │                                                          │
     │== token as Bearer for /feedback, /feedback/:id, /jobs ==▶│
```

Enable it on the API with an opt-in signing secret:

```ts
buildServer({
  /* …store, queue, github, apiKeys… */
  tokenExchange: { signingSecret: process.env.PATCHBACK_TOKEN_SECRET },
});
```

Then, in your app's backend, expose a tiny endpoint (your framework, your
session) that exchanges the server key:

```ts
// GET /patchback-token — server-side; the browser never sees the API key.
app.get('/patchback-token', requireAppSession, async (req, res) => {
  const r = await fetch('https://patchback.your.host/tokens/exchange', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.PATCHBACK_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tier: 'insider', subject: req.user.id }),
  });
  res.json(await r.json()); // { token, tier, expiresAt }
});
```

And point the widget at it (no `apiKey` — the two are mutually exclusive):

```ts
createPatchbackWidget({
  apiUrl: 'https://patchback.your.host',
  getToken: () => fetch('/patchback-token').then((r) => r.json()),
});
```

The widget caches the token and re-fetches it before it expires. Key
guarantees: the exchange endpoint is **server-only** (it requires your parent
key, rejects browser-origin requests, and is never CORS-exposed — a browser can
never call it), a minted token can **never exceed its parent key's tier**, its
expiry is enforced on **every** request, and an expired/leaked token grants only
its already-limited tier for a bounded window (revoke everything at once by
rotating `tokenExchange.signingSecret`). See the
[SDK](packages/sdk/README.md) and [widget](packages/widget/README.md) READMEs
for the full flow.

### Optional: source provenance (better localization)

Add [`@patchback/provenance`](packages/provenance) to your app's build and
dev renders stamp every element with `data-pb-source="src/file.tsx:42"`
(repo-root-relative). A picked element then carries that `file:line` into
the feedback payload — shown in the "What will be sent" preview — and the
agent starts at the exact source location instead of searching. Vite,
Next.js (SWC and Turbopack), and a plain babel plugin are supported;
production builds stamp nothing by default. Non-JSX apps can write the
attribute by hand — it is a documented public contract.

### Optional: GitHub Action mode (no long-running process)

For a team-shape deployment, run the triage + patch pipeline **inside GitHub
Actions** on your repo instead of a local `patchback dev` process. A thin
**ingest** (the API in `issueEmitter` mode) authenticates the submitter, assigns
the trust tier **server-side**, signs an **HMAC marker** binding the feedback
content + tier + a nonce + the repo, and opens a labeled issue. A workflow fires
on that issue and runs `patchback ci`, which **verifies the marker** and — only
on a valid one — drives the item through the same triage → guarded brief → patch
pipeline, opening a PR. **It never merges; PR review is the human gate.**

```sh
npx patchback init --github-action
```

This scaffolds a least-privilege `.github/workflows/patchback.yml`
(`contents`/`issues`/`pull-requests: write` only) and prints the `gh secret set`
steps for `ANTHROPIC_API_KEY` and `PATCHBACK_SIGNING_SECRET` (secrets are never
written to a file). The `patchback` label is only a trigger filter — the signed
marker is the sole authorization, so a mislabeled or forged issue neutral-exits
with no agent run. See [`action/`](action) for details and the trust model.

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

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (including the
hard product rules PRs must not cross) and [ROADMAP.md](ROADMAP.md) for what
is deliberately out of scope in v0.1. Security reports:
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
