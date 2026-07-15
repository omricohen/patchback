# Demo flow — the reproducible GIF script

The demo GIF shows the whole loop once: feedback typed into a fake ops
dashboard becomes a one-line pull request that a human reviews and merges,
and the widget reports the fix as shipped. This file is the exact,
repeatable script. The set is [`examples/nextjs-demo`](../examples/nextjs-demo)
— an "Acme Ops" orders dashboard seeded with three one-line flaws:

| #   | Flaw                                                        | Where                                                      |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | Column header typo: **"Ammount"** should be "Amount"        | `examples/nextjs-demo/app/components/orders-dashboard.tsx` |
| 2   | Default sort shows the **oldest** orders first              | `examples/nextjs-demo/lib/orders.ts` (`sortOrders`)        |
| 3   | The **"Pending only"** filter actually shows shipped orders | `statusForFilter` in `orders-dashboard.tsx`                |

The GIF uses flaw 1 (visible, unambiguous, provably fixed by a one-line
diff). Flaws 2 and 3 are spares for live demos. The example's smoke tests
deliberately do not pin any of them, so the demo PR leaves tests green.

## Prerequisites

- Node 20+, pnpm 10+, git, and the `claude` CLI (2.1+) on PATH.
- A **scratch GitHub repository you own containing a copy of this repo**
  (push your clone to e.g. `you/patchback-demo`). The demo PR lands there,
  fixing `examples/nextjs-demo/...` — never demo against the real upstream.
- A fine-grained token for that scratch repo (scopes:
  [packages/github/README.md](../packages/github/README.md)) and an
  Anthropic API key.

## Boot (before recording)

```sh
# Terminal A — repo root
pnpm install && pnpm build
node packages/cli/dist/index.js dev
#   First run drops into `patchback init`:
#     Target GitHub repository (owner/name): you/patchback-demo
#     GitHub fine-grained personal access token: <paste, hidden>
#     Anthropic API key: <paste, hidden>
#     How does the target repo run its tests?: pnpm test
#     Where does your app run during development?: http://localhost:3000
#   Then the banner prints. COPY the insider key
#   (pb-dev-insider-…) — it is minted fresh every run.
```

```sh
# Terminal B — wire the key into the demo app and start it
cp examples/nextjs-demo/.env.example examples/nextjs-demo/.env.local
#   edit .env.local: NEXT_PUBLIC_PATCHBACK_API_KEY=pb-dev-insider-…
pnpm --filter nextjs-demo dev
```

Open <http://localhost:3000>: the orders table renders and the Patchback
launcher button floats bottom-right. If you instead see a yellow
"Patchback is not wired up yet" note, the key is missing/stale — re-copy
it and restart `next dev`.

Optional speed-ups for a tighter GIF: agent runs are much faster with
`localRepoPath` set in `patchback.config.ts` to a local clone of the
scratch repo (clone step skipped; the PR still opens on GitHub).

## Recording script

1. **The flaw.** Hover the orders table so the misspelled **"Ammount"**
   header is on screen for a beat.
2. **Open the widget.** Click the launcher. (Optional flourish: use the
   element picker and click the "Ammount" header — the DOM path rides
   along with the feedback.)
3. **Type the feedback** — a defect report in user voice, not an
   instruction (instruction-shaped text is correctly triaged _away_ from
   `patchable`; see `.claude/DECISIONS.md`, 2026-07-15 fixture decision):

   > Spotted a typo in the orders table: the amount column header says
   > "Ammount".

4. **Submit.** The widget thread shows the item; Terminal A streams
   `feedback.received` → `feedback.triaged` with the triage verdict
   `[patchable]` (takes a few seconds — one model call).
5. **Start the patch.** Click **Start patch** in the widget thread.
   Terminal A streams `issue.created` → `patch.queued` → `patch.running`.
   The agent clones the scratch repo, edits, and runs the repo's own
   lint/typecheck/test scripts — for this monorepo that is a few minutes;
   cut or time-lapse this stretch in the GIF.
6. **PR opens.** `patch.generated` → `pr.opened`, with the PR URL in the
   terminal and a link in the widget thread. Expected PR shape:
   - branch `patchback/issue-<n>`, linked to the tracking issue;
   - a one-line diff in
     `examples/nextjs-demo/app/components/orders-dashboard.tsx`
     (`Ammount` → `Amount`) — nothing else, no dot-directory artifacts;
   - checks green (the seeded flaws are not pinned by tests).
7. **Human review.** Open the PR on GitHub, show the diff, click **Merge**
   yourself — Patchback has no merge capability, by design.
8. **Loop closes.** Within ~15 s the dev PR poller notices the merge:
   `pr.reviewed` → `patch.shipped` → `feedback.closed` in Terminal A, and
   the widget thread chip lands on the closed/shipped state. End the GIF
   on the widget showing the loop closed.

## If triage asks a question instead

A vaguer message (e.g. "the orders table looks wrong to me") may triage to
`needs_clarification`: the widget shows the model's follow-up question and
an answer box. Answering creates a linked follow-up item that triages
again. That is correct behavior, not a demo failure — either record the
richer loop or restart with the message above.

## Cleanup (after recording)

- On the scratch repo: the merge landed a commit — `git revert` it (or
  reset the scratch repo from upstream) so the flaw is back for the next
  take. Delete the `patchback/issue-<n>` branch if GitHub didn't.
- Close the tracking issue if it didn't auto-close with the PR.
- Ctrl+C both terminals. The dev API keys die with the process; the
  agent's scratch dir under `~/.patchback/jobs/<id>` is deleted after the
  job.
- `rm examples/nextjs-demo/.env.local` if you're done (it's gitignored
  either way). Keep `.env` / `patchback.config.ts` for the next run or
  delete them — both are gitignored too.
