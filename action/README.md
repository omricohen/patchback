# Patchback GitHub Action

Team-shape deployment: run Patchback's triage-confirm + patch pipeline **inside
GitHub Actions** on your target repo, with no long-running local process. A
patchback-created issue triggers the workflow; the Action verifies the issue's
signed marker and, if triage classifies the feedback `patchable`, opens a pull
request. **It never merges — PR review is the human gate.**

## How it works

1. A thin **ingest** (`@patchback/api` in `issueEmitter` mode) authenticates the
   submitter, assigns the trust tier **server-side**, signs an **HMAC marker**
   binding the feedback content + tier + a nonce + the repo, and opens a labeled
   issue carrying that marker. Outsider feedback is never emitted as an issue.
2. This workflow fires on the labeled issue and runs `patchback ci`, which
   **verifies the marker** (constant-time HMAC, content-hash binding, repo
   binding, freshness window) and — only on a valid marker — drives the item
   through the same triage worker → guarded brief factory → patch pipeline that
   `patchback dev` uses. Invalid / absent / tampered / stale marker ⇒ neutral
   exit, zero agent/GitHub-write calls.
3. The Action comments the outcome on the triggering issue (the durable thread)
   and exits.

**The `patchback` label is only a trigger filter, never authorization.** The
signed marker is the sole gate. Anyone who can label an issue still cannot pass
HMAC verification, so a mislabeled or hostile issue neutral-exits.

## Usage

`patchback init --github-action` scaffolds `.github/workflows/patchback.yml`
for you. It looks like:

```yaml
name: Patchback
on:
  issues:
    types: [labeled]
permissions:
  contents: write # patch branch + commit (git data API)
  issues: write # outcome comment
  pull-requests: write # open the PR (never merge)
concurrency:
  group: patchback-${{ github.event.issue.number }}
  cancel-in-progress: false
jobs:
  patchback:
    if: github.event.label.name == 'patchback'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: omricohen/patchback/action@v0
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          signing-secret: ${{ secrets.PATCHBACK_SIGNING_SECRET }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input               | Required | Description                                                              |
| ------------------- | -------- | ------------------------------------------------------------------------ |
| `anthropic-api-key` | yes      | Triage + agent key. Store as a repo secret.                              |
| `signing-secret`    | yes      | Shared HMAC secret; must equal the ingest's. Store as a repo secret.     |
| `github-token`      | yes      | `${{ secrets.GITHUB_TOKEN }}` with the three write scopes above.         |
| `version`           | no       | Published CLI version to run. Pin to an exact version (default `0.0.1`). |

## Secrets & least privilege

- `GITHUB_TOKEN` is scoped at the **workflow level** to exactly
  `contents: write`, `issues: write`, `pull-requests: write` — everything else
  drops to `none`.
- `ANTHROPIC_API_KEY` and `PATCHBACK_SIGNING_SECRET` are **repo secrets**, never
  written to a file and never echoed (`patchback ci` never prints secrets and
  the composite step does not use `set -x`).
- The `PATCHBACK_SIGNING_SECRET` is a signing key: if it leaks, forged markers
  become possible. Treat it accordingly — rotate it (re-set the repo secret and
  the ingest's copy together) and keep the freshness window tight.

## Scope (v0.2)

One-shot: the Action opens the PR and exits. Widget status/threading is out of
scope — the GitHub issue is the durable thread via the outcome comment. See the
repo `ROADMAP.md` for what comes next.
