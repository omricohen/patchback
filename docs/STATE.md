# STATE — where we left off

_Last updated: 2026-07-20 (v0.2 Phase 7 — release hardening)_

## Current phase

**v0.2 Phase 7 — repositioning + hardening: DONE (offline gate green)** on
branch `v2-7-hardening` (branched from up-to-date `main`; NOT merged, NOT pushed
— Omri's call). This is the final v0.2 phase: with it, v0.2 is a complete,
publish-prepped feature set.

v0.2 shipped, across Phases 1–7 (all on unmerged `v2-*` branches):

1. `v2-1-provenance` — `@patchback/provenance` (build-time `data-pb-source`).
2. `v2-2-repair-loop` — bounded one-attempt repair in `agent-core`.
3. `v2-3-triage-retrieval` — repo-aware triage stage 2 (local-probe only).
4. `v2-4-action-mode` — GitHub Action mode (`action/`, `patchback ci`, HMAC markers).
5. `v2-5-token-exchange` — per-user `pbt_` token exchange.
6. `v2-6-outcome-view` — `Job.userSummary` + `Job.previewUrl` + preview surfacing.
7. `v2-7-hardening` — version bump, dry-run audit, sweeps, doc repositioning (this branch).

## What's done (Phase 7)

- **Version bump.** All 11 public packages → `0.2.0` (the ten `@patchback/*`
  incl. the new `@patchback/provenance`, plus `patchback`). Root/apps/examples
  stay `private`. `workspace:*` deps resolve to `0.2.0` (verified by unpacking
  `@patchback/sdk` → `@patchback/types: 0.2.0`).
- **Publish dry-run green 11/11.** `pnpm -r publish --dry-run --no-git-checks`
  succeeds for every public package. Each tarball audited: only `dist/`,
  `README.md`, `LICENSE` (pnpm injects the root MIT license), and `package.json`
  — no tests/fixtures/src/`.env`. `@patchback/provenance` metadata confirmed
  (MIT, repo/homepage/bugs → github.com/omricohen/patchback, keywords, files
  whitelist `[dist, README.md]`, `engines.node >=20`, `publishConfig.access
public`, README present).
- **Sweeps clean.** `gitleaks git` (109 commits + committed tree): no leaks.
  Two synthetic HMAC signing-secret fixtures were allowlisted in `.gitleaks.toml`
  (`<prefix>-signing-secret-0123456789…`). `gitleaks dir`'s 8 raw hits are all
  untracked/gitignored (`.env`, `examples/nextjs-demo/.next/` artifacts) — 0 in
  tracked source. Forbidden-content sweep (Mission Control / client identifiers /
  internal hostnames / real `/Users/` home paths) clean on tree + history. `git
log --all --diff-filter=A -- .env` empty (never committed).
- **Docs repositioned.** README now leads with a "Two ways to run it" overview
  and promotes GitHub Action mode to a first-class `##` section co-equal with
  the local quickstart; outcome view / tokens / provenance framed as
  cross-mode enhancements; pre-alpha status line kept. ROADMAP gained a "Shipped
  in v0.2" section and refined NEXT items (signing-key rotation/keyId,
  multi-attempt repair, thread-aggregate state). Extraction checklist got a v0.2
  addendum with sweep evidence. DECISIONS + OPEN_ISSUES updated (prettier-drift
  and dry-run issues resolved).

## Gate status

`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check` —
all green on `v2-7-hardening`. (The `fake-claude.mjs` prettier drift is gone;
the whole tree is Prettier-clean.)

## Next concrete steps

- **Omri's call:** merge the `v2-*` branch stack to `main` (Phases 1–7) in
  order, or squash-merge the v0.2 work as a unit.
- **Launch gate (needs Omri — real credentials / npm login / a second human):**
  the human-only list in `docs/extraction-checklist.md` "Remaining — requires
  Omri" — real `pnpm -r publish` (dry-run green), `npx patchback dev` from a
  clean machine, stranger's-repo gauntlet, timed cold quickstart, demo GIF,
  final private-term-list pass, GitHub repo settings, then flip public.
- **Honest open items** (see `.claude/OPEN_ISSUES.md`): signing-secret custody &
  rotation (both HMAC secrets), Action-mode replay bound, preview-permission and
  preview-privacy caveats, live triage retrieval eval not yet re-run at ≥90% for
  the recorded numbers.

## Context to pick up cleanly

- **pnpm only.** Gate = `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  (+ `pnpm format:check` kept clean).
- **No auto-merge, ever. Triage before code. Trust tiers are a security
  boundary. Capture is opt-in/maskable. Local-first.** Not up for relaxation.
- Phase plans live under `.a5c/runs/…/artifacts/` (do not touch `.a5c/`).
- Nothing is pushed; `main` is at the v2-6 merge commit locally, and the `v2-*`
  branches are unmerged working history.
