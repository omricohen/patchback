# Decisions — Patchback

## 2026-07-10 — Provisional SPEC.md reconstructed instead of blocking

**Decision:** `docs/SPEC.md` was missing (drafted in Claude chat, never saved to repo); a provisional version consolidating only CLAUDE.md + BUILD_PLAN.md content was written, clearly bannered for replacement.
**Why:** Every session is instructed to read SPEC.md first; a faithful consolidation beats a broken reference. Inventing new spec detail was avoided so it can't drift from the original. Alternative — leaving it missing — would break the documented workflow.
**Context:** Tracked in OPEN_ISSUES.md; replace with the real spec from the original chat session.

## 2026-07-10 — First two commits land directly on main

**Decision:** Renamed `master` → `main`; the docs/meta commit and the Phase 0 scaffold commit go directly on `main`. Phases 1+ get their own branches per BUILD_PLAN.
**Why:** A repo with zero commits has no base to branch from, and with no remote there is nothing to PR against yet. "One phase = one PR-sized branch" starts making sense from Phase 1.
**Context:** BUILD_PLAN.md workflow section; user default branch is `main`.

## 2026-07-10 — Phase 0 scaffolds packages/ + widget-playground only; examples/ deferred

**Decision:** Phase 0 creates all `packages/*` and a stub `apps/widget-playground`, but not `examples/nextjs-demo` / `examples/vite-demo`.
**Why:** Examples are Phase 9 deliverables; empty Next.js/Vite apps now would just be churn. The pnpm workspace globs include `examples/*` so they slot in later without config changes.
**Context:** BUILD_PLAN Phase 0 vs Phase 9.

## 2026-07-10 — TypeScript pinned to 5.x, not 7.x

**Decision:** Root devDependency is `typescript@^5.9.0` even though 7.x is latest.
**Why:** typescript-eslint 8.x crashes against TS 7 (the native-compiler line) — `pnpm lint` fails at startup. TS 5.9 is the current stable-ecosystem line. Revisit when typescript-eslint ships TS 7 support.
**Context:** Error was `TypeError: Cannot read properties of undefined (reading 'Cjs')` in @typescript-eslint/typescript-estree.

## 2026-07-10 — Shared dev tooling hoisted to workspace root

**Decision:** typescript, vitest, eslint, prettier, turbo live only in the root `package.json`; packages carry just `test`/`build` scripts.
**Why:** One version of each tool across the monorepo, no per-package devDependency drift. Bin resolution walks up to the root `node_modules/.bin`, so package scripts work unchanged.
**Context:** Root `package.json`, `turbo.json`.
