# STATE — where we left off

_Last updated: 2026-07-15_

## Current phase

**Phase 8 (CLI: `npx patchback dev`) — DONE, verifier findings fixed
(attempt 2), LIVE ROUND-TRIP GREEN** on branch `phase-8-cli` (not merged,
not pushed — Omri's call). Phase 7 (`phase-7-widget-sdk`) was merged to
main before this phase started. Phase 2 (extraction pass) still pending
source material in `extraction-inbox/`. Next up: **Phase 9 — examples,
docs, demo** (or merge/review of this branch first).

## Phase 8 attempt 2 — verifier findings fixed (2026-07-15)

Two critical findings from the phase-8 review, both fixed and verified:

1. **Agent-spawn isolation (privacy).** The adapter used to spawn `claude`
   inheriting the machine's FULL global config; a globally installed plugin
   hook wrote `.a5c/` state (with local absolute paths) into the scratch
   clone, and the intent-to-add sweep published it into a real PR. Fixed
   with defense in depth, all test-pinned:
   - Spawn isolation: per-job empty `CLAUDE_CONFIG_DIR` (mkdtemp, deleted
     after the run), allowlisted env (PATH/HOME/locale +
     `ANTHROPIC_API_KEY` passthrough; `runProcess` gained
     `inheritEnv: false`), and `--bare --strict-mcp-config` appended
     (`DEFAULT_ISOLATION_FLAGS`, overridable; env layer is always on).
     Note: `--bare` means agent auth is strictly `ANTHROPIC_API_KEY`.
   - Sweep filter: `diffNumstat` excludes any newly appearing top-level
     dot-directory absent from the base commit, with a warning
     (`listNewTopLevelDotDirs` in agent-core git.ts).
   - Commit-path filter (second layer): the default pipeline re-checks and
     refuses to commit files under such directories even if an adapter
     reports them, logging via the new `DefaultPipelineOptions.log` seam
     (wired from `ApiConfig.log`).
2. **Live e2e fixture.** The old canned message was instruction-shaped and
   the real classifier correctly triaged it DOWN — the test could never
   pass live. Rewritten: the test seeds `docs/getting-started.md` with a
   real typo via the GitHub contents API, submits a natural user-voice
   defect report, asserts triage → patchable → real agent → real PR whose
   diff touches ONLY the seeded file (zero dot-dir artifacts — the live pin
   for finding 1) and actually fixes the typo, then cleans everything up.

**Live run result (2026-07-15):** GREEN against omricohen/testingPatchBack
— full suite 58/58 with the live test included; PR #8 opened by the real
agent with exactly `docs/getting-started.md` +1/−1; PR/issue closed,
branch and seeded file removed by cleanup. Keyless, the suite is 57
passed + 1 skipped (live gate skips cleanly). Root gate green:
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `format:check`.

## What's done (Phase 8)

- **`patchback init`** (interactive first-run): prompts for target repo
  (owner/name), GitHub fine-grained token (echo-suppressed), Anthropic API
  key (echo-suppressed), test commands, and app origin. The token is
  validated with a live GitHub call: 401 / 404 / read-only-permissions each
  produce an actionable message and a re-prompt (3 attempts); offline is
  warn-and-continue. A repo-scripts preflight reads the target repo's root
  package.json via the API and prints a clear "no test script — patches
  won't be gated" message. Writes:
  - `patchback.config.ts` — non-secret settings only. The template is
    **annotation-free** (JSDoc types), so it is valid JS and `patchback dev`
    loads it via a data-URL `import()` with no TS compiler at runtime.
  - `.env` — GITHUB_TOKEN / ANTHROPIC_API_KEY, merged in place, chmod 600.
    Secrets are NEVER echoed to the terminal, in summaries or errors.
  - `.gitignore` — `.env` + `patchback.config.ts` appended in a git work
    tree.
- **`patchback dev`**: loads `.env` (environment wins) + config, then
  composes the REAL `buildServer` + `createWorkers` in one process over
  `MemoryStore` + `MemoryQueue` (zero services), with
  `createClaudeCodeAdapter` (agent), `createAnthropicModelCaller` (triage),
  and `createTokenClient` (GitHub). Runs `patchback init` automatically when
  no config exists. Serves `/widget.js` (the @patchback/widget IIFE bundle)
  and `/snippet`; prints a banner with the copy-paste embed snippet and two
  per-run dev API keys (owner + insider — these are local session keys, not
  user secrets). `--port` flag; port 0 supported for tests.
- **Job log streaming** via a Store decorator (`instrumentStore`) — the
  store is the single choke point for routes AND workers, so every state
  transition, triage verdict, and feedback intake streams to the terminal
  with readable labels. `patch.failed` renders a headline + advice via
  `explainPatchFailure` (lint failed / tests failed / agent gave up / diff
  ceiling / claude not installed / clone auth), tested per path.
- **Secret scrubbing**: the clone URL embeds the GitHub token
  (`x-access-token@github.com`), so the logger AND the store decorator
  scrub every known secret from log lines, `job.error`, and history notes
  BEFORE persistence (job errors are served back over the API).
- **CORS landed in @patchback/api** behind explicit config
  (`ApiConfig.cors.allowedOrigins`, @fastify/cors 11.x): off by default,
  exact origins only, `*` rejected at startup, `credentials: false`.
  `patchback dev` wires it from `config.appOrigins`. Closes the Phase-7
  OPEN_ISSUES entry.
- **Dev-mode PR poller** (webhooks can't reach localhost): polls
  `getPullRequestStatus` for jobs at `pr.opened`/`pr.reviewed`; merged PRs
  walk `pr.reviewed → patch.shipped → feedback.closed` (merge implies
  review, same as the webhook rule); closed-without-merge is reported once
  and changes no state (still unrepresentable — see OPEN_ISSUES).
- **Phase-6 advisories fixed**: patch-worker now LOGS a lost success-path
  CAS via the new `ApiConfig.log` seam (test proves the message fires and
  metadata loss is loud); the stale reply-tier header comment in
  `routes/feedback.ts` now matches the thread-minimum-only code.
- **Tests** (57 passing + 1 env-gated skip in the cli package):
  - e2e dev-mode over fakes: SDK against the real HTTP server — submit →
    triage → start → fake pipeline → `pr.opened`, transition stream order
    asserted; clarification loop; lint-failed and agent-gave-up renderings;
    poller walk to `feedback.closed`; outsider stays data-only end to end;
    CORS on the configured origin only; widget + snippet endpoints.
  - init suite over temp dirs + scripted prompts (secrets never in output,
    config never contains secrets, bad-token re-prompt, offline, gitignore).
  - Live full-PR round-trip env-gated behind `GITHUB_TOKEN` +
    `PATCHBACK_TEST_REPO` + `ANTHROPIC_API_KEY` (also needs the `claude`
    binary), self-cleaning (closes PR/issue, deletes branch, removes the
    seeded fixture file). **Ran GREEN with real credentials on 2026-07-15**
    (see "Phase 8 attempt 2" above).
- Gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and
  `pnpm format:check`.

## Next concrete step

1. Review + merge `phase-8-cli` (live round-trip is green; findings fixed).
2. Phase 9 — `examples/nextjs-demo` + `examples/vite-demo`, README
   quickstart against reality, demo GIF script.
3. Still pending: Phase 2 extraction inbox.

## Context to pick up cleanly

- Attempt-2 decisions in `.claude/DECISIONS.md` (2026-07-15): agent-spawn
  isolation posture (flags + env + double sweep filter) and the
  seeded-defect live-fixture rule. Residual watch item in OPEN_ISSUES:
  the flag layer needs `claude` CLI >= 2.1 (`--bare`).
- Phase 8 decisions in `.claude/DECISIONS.md` (dated 2026-07-15): config
  split (secrets in .env / settings in annotation-free patchback.config.ts),
  store-decorator log streaming + secret scrubbing, CORS posture, PR
  poller, probe design, per-run dev keys.
- `npx patchback dev` from a cold machine only works after packages publish
  (Phase 10); inside the repo it's `pnpm --filter patchback build` then
  `node packages/cli/dist/index.js dev` (or a workspace script).
- `testCommands` in patchback.config.ts is informational for v0.1 — the
  pipeline runs the target repo's OWN package.json scripts via the
  check-runner; the init preflight warns when there's no test script.
- The widget bundle served at `/widget.js` resolves from
  `@patchback/widget/dist/patchback-widget.iife.js` — build the workspace
  first or the route 404s with a pointer.
