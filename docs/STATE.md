# STATE — where we left off

_Last updated: 2026-07-15_

## Current phase

**Phase 9 (Examples, docs, demo) — code + docs DONE** on branch
`phase-9-examples-docs` (not merged, not pushed — Omri's call). Phase 8
(`phase-8-cli`) was merged to main before this phase started. Phase 2
(extraction pass) still pending source material in `extraction-inbox/`.

Two Phase-9 acceptance items are deferred to Omri because they need real
credentials and a second human (logged in OPEN_ISSUES): the
stranger's-repo gauntlet (3 unfamiliar repos, one expected graceful
failure) and the under-10-minutes quickstart timing by someone else.

## What's done (Phase 9)

- **`examples/nextjs-demo`** — the demo-GIF set: a Next.js 15 (pinned
  15.5.19, aged release) "Acme Ops" dashboard with a synthetic orders
  table and THREE deliberate one-line flaws ("Ammount" header typo,
  oldest-first default sort, mislabeled "Pending only" filter), each
  marked `DELIBERATE DEMO FLAW` in source. The widget is embedded via the
  exact snippet pattern `patchback dev` prints, re-created as a client
  component (`app/components/patchback-snippet.tsx`) with the per-run
  insider key env-injected (`NEXT_PUBLIC_PATCHBACK_API_KEY` from
  `.env.local`; template `.env.example`); keyless it renders a visible
  setup note. Smoke tests (5) render the page/dashboard/snippet in jsdom
  and deliberately do NOT pin the flaws — the demo PR that fixes one must
  stay green. Package turbo.json caches `.next/**`; `next-env.d.ts` is
  eslint-ignored; test JSX compiles via Vite 8's `oxc.jsx` option (the
  esbuild override is ignored by Vite 8 — see DECISIONS).
- **`examples/vite-demo`** — minimal vanilla embed: static page + one
  `createPatchbackWidget` call (`src/main.ts`), key via
  `VITE_PATCHBACK_API_KEY`, one seeded flaw ("Whats new"), jsdom smoke
  test, port 5174 (README notes the appOrigins addition it needs).
- **README quickstart** — rewritten against verified CLI reality: ran the
  built CLI's help/version, a scripted `patchback init` in a scratch dir
  (observed the live token probe's actionable 401 message and 3-attempt
  re-prompt), and the dev harness over injected fakes (captured the real
  banner, `/snippet`, `/widget.js` 200). Written for the published
  `npx patchback dev` future with a "running from this repo today"
  callout (`pnpm install && pnpm build && node packages/cli/dist/index.js
dev`). Prereqs name the exact fine-grained token scopes (linking
  packages/github/README.md), the Anthropic key, and the `claude` CLI
  2.1+ requirement.
- **`docs/demo-flow.md`** — the reproducible GIF script: flaw table, boot
  commands for both terminals, the user-voice defect report to type
  ("Spotted a typo in the orders table: the amount column header says
  'Ammount'." — a report, never an instruction, per the 2026-07-15
  fixture decision), expected state stream at each click, expected PR
  shape (one-line diff, `patchback/issue-<n>` branch, no dot-dir
  artifacts), the clarification branch as a non-failure, and cleanup.
- Gate green at root: `pnpm lint && pnpm typecheck && pnpm test &&
pnpm build` + `pnpm format:check` (examples included: both build, 6
  example tests pass).

## Next concrete step

1. Review + merge `phase-9-examples-docs`.
2. Omri: run the stranger's-repo gauntlet + timed quickstart (deferred
   Phase-9 acceptance, see OPEN_ISSUES) — can fold into Phase 10.
3. Phase 10 — launch hardening (gitleaks + forbidden-term sweep, publish
   dry-run, `npx patchback dev` from a clean machine, extraction
   checklist completion). Shooting the actual GIF needs Phase 9's demo
   flow + real credentials.
4. Still pending: Phase 2 extraction inbox.

## Context to pick up cleanly

- Phase-9 decisions in `.claude/DECISIONS.md` (2026-07-15): env-injected
  per-run key in examples (+ rejected alternatives), flaws-never-pinned
  test rule, next@15.5.19 exact pin + the Vite-8-oxc JSX gotcha.
- The examples README run instructions use the from-this-repo form; swap
  to `npx patchback dev` when Phase 10 publishes.
- pnpm ignored `sharp@0.34.5`'s build script on install (Next optional
  image optimization — unused by the demo; approve via `pnpm
approve-builds` only if next/image ever gets used).
