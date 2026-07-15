# widget-playground

Dev harness for the Patchback widget: a fake "ops dashboard" page plus a
**fake-pipeline API** — the real `buildServer` + workers + MemoryStore +
MemoryQueue from `@patchback/api`, with a deterministic keyword-scripted
model, a fake GitHub client, and a delayed fake patch pipeline. The full
canonical state walk runs locally with **zero credentials and zero
services**.

## Run it

```sh
pnpm --filter widget-playground dev
```

- Vanilla widget page: http://localhost:5173/
- React wrapper page: http://localhost:5173/react.html
- Fake API: http://127.0.0.1:8787 (proxied at `/api`)

Dev API keys are printed at boot; the pages mount with the **insider** key
so the whole loop runs.

## Triage keywords (deterministic model)

| Message contains | Triage result                             |
| ---------------- | ----------------------------------------- |
| `[clarify]`      | `needs_clarification` (+ canned question) |
| `[human]`        | `needs_human`                             |
| anything else    | `patchable` @ 0.95                        |

Keyless submissions (e.g. via curl) are **outsiders**: data only, no model
call, can never start a patch job — same as production.

## Manual accept flow (the phase-7 acceptance, by hand)

1. `pnpm --filter widget-playground dev`, open http://localhost:5173/
2. Click the round launcher (bottom right).
3. Type: `Change the export button label from "Expot" to "Export"`.
4. Click **Point at the problem** → hover the mislabeled `Expot CSV`
   button (highlight tracks it) → click it. Note the element chip in
   "What will be sent". Hovering the dashed "Internal notes" card shows
   the struck-through _excluded_ treatment — it cannot be picked.
5. Click **Attach screenshot** → the preview is post-redaction: the
   account form values and the ignored card are solid boxes. The password
   (`SENTINEL-hunter2`) and email values never leave the page — the
   pixel-proof test asserts this on every CI run.
6. Click **Send feedback** → status chip walks Received → Triaged.
7. Click **Start patch** → chip walks Patch queued → "Agent working on
   it…" → In review (with a fake PR link).
8. Simulate the human merging the PR (no auto-merge, ever — this stands in
   for a person clicking Merge on GitHub):
   `curl -X POST http://127.0.0.1:8787/_dev/merge/<prNumber>`
   → chip walks Review approved → Shipped → Closed.
9. Clarification branch: submit `[clarify] something seems off?` → chip
   shows "Question for you" with a reply box; answer it → a NEW job is
   minted and advances.
10. Console capture: click **Throw console error**, then open the panel —
    "Include recent errors (…)" appears in the preview, scrubbed
    (email/token → placeholders), with a checkbox to leave it out.

## Automated acceptance

`test/acceptance.browser.test.ts` runs this exact flow in headless
Chromium — including sampling the stored screenshot's pixels over the
masked inputs (uniform redaction fill) and asserting no sentinel value
appears anywhere in the stored item. It is env-gated so fresh clones stay
browser-free:

```sh
pnpm --filter widget-playground exec playwright install chromium   # once
PATCHBACK_BROWSER_TESTS=1 pnpm --filter widget-playground test
```

CI runs it as a dedicated job on every push.
