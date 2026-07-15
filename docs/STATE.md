# STATE — where we left off

_Last updated: 2026-07-15_

## Current phase

**Phase 7 (Widget + React wrapper + SDK) — CODE DONE** on branch
`phase-7-widget-sdk` (not merged, not pushed — Omri's call), implemented
per the approved plan
(`.a5c/runs/01KX6GMZ9TJBCR1RH3CCNMM77E/artifacts/phase-7-plan.md`), all
open questions resolved as approved (picker visible by default, message
verbatim, snapdom, `/testing` subpath, playwright infra, Start-patch
button in-widget, query-stripped URL default).
Phase 2 (extraction pass) still pending source material in
`extraction-inbox/`. Next up: **Phase 8 — CLI `npx patchback dev`** (or
merge/review of this branch first).

## What's done (Phase 7)

- `@patchback/sdk` — zero-dep injectable-fetch client for the six-route
  contract; explicit `ReadAuth` (read token | apiKey, no silent
  fallback); typed request builders (client-side `trustTier`
  unrepresentable); `PatchbackApiError` failing closed to `unknown`;
  `pollJobStatus` (fast→slow at triage, capped backoff + connection
  callback, hard stop on 404, terminal stop, AbortSignal). Contract
  tests boot the REAL `buildServer`; poll tests under fake timers.
- `@patchback/api/testing` — the phase-6 scripted fakes promoted to a
  shipped subpath; api tests, SDK contract tests, and the playground all
  consume one copy.
- `@patchback/widget` — vanilla zero-runtime-dep core (snapdom the one
  lazy exception), open shadow root, no custom element, host
  ignore-marked so the widget never captures itself:
  - **Masking engine (built first):** masked-vs-ignored verbs,
    nearest-marker resolution, non-overridable password/cc/otp floor
    (each member test-pinned), open-shadow traversal, fail-closed
    cross-origin iframes, loud invalid-selector init errors; `scrubText`
    for captured text (bearer/keys/JWT/email/query/blob).
  - **Capture defaults per rule 4:** zero-config payload = message +
    query-stripped URL + capturedAt (exact-snapshot test); config
    consent for page/console/screenshot; gesture consent + "What will be
    sent" preview for picker/screenshot; `buildCaptureContext` is the
    single choke point and requires the engine.
  - Console ring buffer (wrap not installed without config, errors-only
    default, scrub-at-insert, reference-safe uninstall), DOM path
    builder (stable-id preference, generated-id rejection), element
    picker overlay (page DOM never mutated, ignored elements
    unpickable), thread view + compile-exhaustive status map + reply
    gate mirroring the server + presentation-only Start-patch button,
    visibility-aware polling, memory-first read-token custody
    (localStorage opt-in).
  - **Screenshots:** renderer seam; snapdom (pinned 2.12.8) confined to
    one dynamically-imported file (hygiene test); redaction = clone-stage
    strip (afterClone) + raster-stage rect painting, independently
    unit-tested; WebP→JPEG drop-not-violate ladder under 512 KiB.
  - Vite IIFE bundle (`window.Patchback.create`) alongside tsc ESM.
- `@patchback/react` — lifecycle-only wrapper (peer `^18||^19`):
  Provider (SSR/StrictMode-safe, config by identity), `usePatchback`,
  `usePatchbackStatus`, `PatchbackLauncher`.
- `apps/widget-playground` — real Vite harness: demo dashboard with
  sentinel-filled inputs / ignored card / typo'd button; fake-pipeline
  dev API (real server+workers+memory drivers, keyword-scripted model —
  `[clarify]`/`[human]` —, delayed fake pipeline, signed
  `/_dev/merge/:pr` webhook helper); vanilla + React pages; dev proxy
  (CORS deferred to Phase 8, logged). README documents the manual accept
  flow.
- **Acceptance:** jsdom half — masked inputs never in the serialized
  payload (sentinel proof over picker text/console/title/URL). Browser
  half — env-gated (`PATCHBACK_BROWSER_TESTS=1`) Playwright Chromium
  suite runs the whole loop on the real playground: hover-geometry,
  unpickable ignored card, stored-item sentinel proof + `#export-btn`
  domPath, screenshot PIXEL uniformity proof over masked regions, status
  chip walk to Closed via the signed merge webhook, clarification/reply
  branch. **Verified green locally against installed Chromium this
  session**; CI gained a dedicated required browser job.
- Gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  and `pnpm format:check`, zero credentials/services/browsers by
  default.

## Next concrete step

1. Review + merge `phase-7-widget-sdk`.
2. Phase 8 — CLI `npx patchback dev`: boots API in-memory + workers +
   local PR-status polling (webhooks can't reach localhost), prints the
   widget snippet (needs the CORS work — see OPEN_ISSUES), first-run
   config writer, composes the real pipeline (Claude Code adapter +
   GitHub token).
3. Still pending: live triage eval run (`ANTHROPIC_API_KEY`).

## Context to pick up cleanly

- Phase 7 decisions in `.claude/DECISIONS.md` (ten entries dated
  2026-07-15): capture defaults/two-tier consent; masking semantics;
  screenshot seam + two-layer redaction; console posture; widget
  architecture (open shadow, IIFE+ESM); SDK DTO/contract-test strategy;
  token custody; `/testing` subpath; env-gated browser acceptance;
  CORS deferral.
- New OPEN_ISSUES: API CORS (Phase 8); embedded-key tier implication
  (documented, revisit = per-user token exchange); closed shadow roots
  undetectable (fail-closed via renderer opacity, not paint).
- Dep pins: `@zumer/snapdom@2.12.8` and `playwright@~1.60.0` — aged
  releases per the no-fresh-packages posture.
- The widget's `polling: {fastMs, slowMs}` config exists mainly so the
  playground/acceptance run snappily; SDK defaults are 2500/15000.
- Browser suite locally: `pnpm --filter widget-playground exec
playwright install chromium` once, then
  `PATCHBACK_BROWSER_TESTS=1 pnpm --filter widget-playground test`.
