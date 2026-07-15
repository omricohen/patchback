# patchback

The [Patchback](https://github.com/omricohen/patchback) CLI: turn user
feedback into human-reviewed GitHub pull requests, locally, with no hosted
services.

```sh
npx patchback dev
```

First run walks you through setup (GitHub fine-grained token, Anthropic API
key, target repo, test commands) and writes `patchback.config.ts`. Then it
boots the API in in-memory mode plus a local patch worker, prints the widget
embed snippet, and streams job logs.

You need:

- Node 20+
- A GitHub fine-grained personal access token scoped to one repo
  (minimum scopes: see the
  [@patchback/github README](https://github.com/omricohen/patchback/tree/main/packages/github#readme))
- `ANTHROPIC_API_KEY`
- The `claude` CLI 2.1+ (the default agent adapter)

No Redis, no Postgres, no GitHub App, no telemetry. Every generated change
lands as a PR for a human to review — there is no auto-merge, ever.

Full quickstart: the
[root README](https://github.com/omricohen/patchback#readme). MIT licensed.
