# STATE — where we left off

_Last updated: 2026-07-19 (v0.2 Phase 3 session)_

## Current phase

**v0.2 Phase 3 — Repo-aware triage (stage 2): DONE** on branch
`v2-3-triage-retrieval` (branched from up-to-date main; NOT merged, NOT
pushed — Omri's call). Phases 1 (`v2-1-provenance`) and 2 (`v2-2-repair-loop`)
are still unmerged too. Plan:
`.a5c/runs/01KXXPDF1Y7TMPE4J22S3GNN6K/artifacts/phase-3-plan.md` (approved
with owner Decisions A + B — see DECISIONS 2026-07-19).

### What's done (Phase 3)

- **`@patchback/triage` stage 2** — optional retrieval second pass. New
  `RepoProbe` seam (`src/probe.ts`, interface only, no `node:fs`), pure logic
  in `src/retrieval.ts` (`isBorderline`, `deriveProbeQueries`,
  `renderProbeEvidence`, `reconcile`, `isUnambiguous`, rung map, constants),
  a second frozen `RETRIEVAL_SYSTEM_PROMPT` + `buildRetrievalUserMessage`
  (`src/prompt.ts`), and the orchestration in `triageFeedback`
  (`src/classifier.ts`): stage 1 unchanged, then IF a probe is injected AND
  the result is borderline, derive queries → probe → second call →
  `reconcile`. Absent probe ⇒ byte-identical to today.
- **Decision A (LITERAL one-rung cap)** — `reconcile` allows DOWN always, UP
  by exactly one rung under strict unambiguity; `needs_human` may rise to
  `needs_clarification` but NEVER to `patchable` (two rungs) — structurally
  guaranteed (`r2 - r1 === 1`), property-tested. `needs_human` is now
  probe-eligible (band-gated).
- **Decision B (paths + counts only)** — probe output carries no file
  contents / snippets; evidence references queries by index; type-level
  containment (`ProbeResult` has no text field), still nonce-wrapped +
  sanitised + capped.
- **`LocalRepoProbe`** (`packages/cli/src/repo-probe.ts`) — deterministic
  in-process fixed-string search (no shell, no regex), ignore list
  (`.git`/`node_modules`/`.env`/dotfiles/dist/build/.next/coverage), file/
  byte/time caps → `truncated`, symlink-escape refusal, path-shape validation,
  NUL binary guard. Wired in `dev.ts` iff `localRepoPath` is a real dir (one
  banner line); `ApiConfig.repoProbe` threaded through the triage worker (the
  hosted API never sets it ⇒ stage 2 dead code there).
- **Gating (final)** — `needs_clarification` always probes; `patchable` and
  (Decision A) `needs_human` probe only inside the band `[0.55, 0.85]`
  (δ=`DEFAULT_RETRIEVAL_BAND` 0.15); confidently-settled items above the band
  never probe.
- **Tests** — `retrieval.test.ts` (band gating, one-rung cap property test
  incl. nh→nc allowed / nh→patchable forbidden, unambiguity, input safety
  with `$(rm -rf /)` etc., output containment), `classifier.stage2.test.ts`
  (outsider-never-probes spy, band gating, reconcile through the full
  pipeline, second-call-failure fallback, absent-probe byte-identical),
  `repo-probe.test.ts` (fixed-string, ignore-list secret-unsearchable,
  symlink refusal, caps, NUL guard). Evals: generic fixture repo under
  `evals/fixtures/repo/` + 8 borderline fixtures + eval probe; sanity pins 39
  fixtures and the absolute injection gate.
- **Gate** — `pnpm lint && typecheck && test && build` all green offline.
  Live eval env-gated: ran it (sourced `.env`) and it failed specifically on
  "Your credit balance is too low" (external funding, not a phase failure) —
  liveEval = blocked-credit; see OPEN_ISSUES.

## Previous phase

**v0.2 Phase 2 — Bounded repair iteration: DONE** on branch
`v2-2-repair-loop` (branched from main; NOT merged, NOT pushed — Omri's
call). Phase 1 (`v2-1-provenance`) is still unmerged too.

### What's done (Phase 2)

- **agent-core `executeWithRepair`** (new `execute-with-repair.ts`) — the
  vendor-neutral loop: `execute()` → run checks → if they fail and repair is
  enabled, set `AgentContext.repair` (structured `RepairContext` =
  which-check/command/output-tail) and re-invoke the adapter ONCE, then
  re-check. `MAX_REPAIR_ATTEMPTS = 1` (fixed constant, not a knob).
  `patch.failed` only after the repair also fails, error keeps BOTH check
  outputs. Returns `repairAttempts` (0 or 1).
- **Cumulative ceiling** comes for free: the repair runs on the same scratch
  tree with the prior diff applied, so the adapter's `diffNumstat`-vs-base
  already measures original+repair. Ceiling failure message now notes when it
  happened during repair (`agent-claude-code/src/adapter.ts`).
- **Repair prompt section** (`agent-claude-code/src/prompt.ts`) — fenced,
  clearly-delimited "your prior change is ALREADY APPLIED, amend it" block
  with the failing-check OUTPUT as diagnostic DATA (tool-generated, not user
  text — trust boundary intact).
- **Wiring** — `DefaultPipelineOptions.repair` + `ApiConfig.repair` (default
  ON, disableable); pipeline is a thin caller of `executeWithRepair` then the
  GitHub commit/PR half; patch-worker records the attempt count in the
  `patch.generated` history note. CLI/API keep repair on by default.
- **Tests** — 4 fake-CLI acceptance scenarios end-to-end
  (`repair.pipeline.test.ts`: fail-then-fix, fail-then-fail w/ both outputs,
  repair-exceeds-ceiling, disabled=one-invocation), agent-core unit tests,
  api pipeline + patch-worker coverage, prompt + failures tests. Fake CLI got
  an invocation-counter file + per-run prompt capture.
- **Gate** — `pnpm lint && typecheck && test && build` + `format:check` all
  green. Live real-binary e2e reached the real CLI but hit "Credit balance is
  too low" (account funding, not a regression) — see OPEN_ISSUES.

## Previous phase

**v0.2 Phase 1 — Build-time source provenance: DONE** on branch
`v2-1-provenance` (not merged, not pushed — Omri's call). Plan:
`.a5c/runs/01KXXPDF1Y7TMPE4J22S3GNN6K/artifacts/phase-1-plan.md` (approved
in full, including the @babel/core dependency).

## What's done (this session)

- **Step-0 spike (mechanism gate): PASSED on all four environments** —
  Vite 8 dev, Next 15.5 dev (SWC), Next dev --turbopack all emit jsxDEV
  `source` (Turbopack with `[project]/`-relative fileNames); Vite/Next prod
  builds emit no source info (structural stripping confirmed). No fallback
  pivot needed. Full matrix in .claude/DECISIONS.md (2026-07-19).
- **`packages/types`** — `PROVENANCE_ATTRIBUTE`, `PickedElement.sourceHint`
  (additive), shared `parseSourceHint`/`isValidSourceHint`/
  `formatSourceHint` validator + exhaustive accept/reject table tests.
- **New `packages/provenance` (@patchback/provenance)** — browser-safe core
  (fail-closed repo-relative stamping, `[project]/` handling, memoized),
  `jsx-dev-runtime`/`jsx-runtime` entries (dev stamping / pure prod
  passthrough), Vite plugin (oxc vs esbuild version-aware import source,
  dev root injection via inline script, `production: 'annotate'` opt-in),
  `withPatchbackProvenance` Next helper (dev-phase-only env root), static
  babel plugin (`elements: 'all' | 'interactive'`). 38 unit tests.
  Dep: @babel/core ^7.29.7 (v7 line kept; Babel 8 too fresh — see log).
- **Widget** — picker walks self→flat-tree ancestors for the first VALID
  `data-pb-source`; choke point re-validates and canonicalizes; preview
  shows a `source: file:line` row; zero-config snapshot untouched.
- **API/SDK** — `CAPTURE_SCHEMA.element.sourceHint` (maxLength 512 +
  conservative pattern); patch-worker threads it into brief fields; SDK
  contract test round-trips it against the real server.
- **agent-core/agent-claude-code** — `TaskBrief.sourceHint`; the guarded
  factory is the authoritative validator (drops invalid, warns, never
  throws); prompt renders a PRIMARY-but-VERIFY-FIRST section above
  fileHints; absent-hint output byte-identical (test-pinned).
- **Triage** — hint serialized as DATA in the element block (200-char cap);
  hostile-hint injection eval fixture added.
- **Playground + examples** — /react.html annotated (typo button +
  dangerouslySetInnerHTML ancestor-fallback child); vanilla / stays the
  negative control; browser suite (PATCHBACK_BROWSER_TESTS=1, 6/6 green)
  proves real file:line with line numbers computed from source at runtime;
  nextjs-demo wired (tsconfig jsxImportSource + withPatchbackProvenance),
  verified live in SWC dev AND Turbopack dev (repo-relative stamps, zero
  absolute paths) and in `next build` (zero stamps); vite-demo README
  documents the manual data-pb-source contract.
- **Gates** — pnpm lint + typecheck + test + build + format:check green;
  publish dry-run incl. the new package; docs (READMEs, SPEC additive
  rows), DECISIONS (mechanism+spike, babel-7 pin, validation policy),
  OPEN_ISSUES (version-skew release note, Vite-major sensitivity).

## Next concrete step

v0.2 Phase 4 per the v0.2 plan (Omri to point at the next phase artifact), or
review + merge the stack `v2-1-provenance` → `v2-2-repair-loop` →
`v2-3-triage-retrieval` in order. When credit is restored, re-run the live
triage eval (retrieval fixtures) to confirm ≥90% + the injection gate, and the
Phase-2 live e2e. Release-note reminder: older API 400s a newer widget that
sends sourceHint (see OPEN_ISSUES 2026-07-19).

---

# Previous state (v0.1 orchestration run closed, 2026-07-15)

## Build run: COMPLETE

All 10 BUILD_PLAN phases merged to `main` and pushed to
github.com/omricohen/patchback (private). Release readiness: **READY, no
engineering blockers** — see the report at
`.a5c/runs/01KX6GMZ9TJBCR1RH3CCNMM77E/artifacts/release-readiness.md`
(gitignored; regenerate insights from .claude/ logs if absent).

Live-proven: triage evals ≥90% + injection gate; two full feedback→PR
round-trips with the real agent on omricohen/testingPatchBack; masking
pixel-verified across 3 adversarial rounds; agent-spawn isolation fixed.

## Next: the 10 human-only launch items (in order)

1. Confirm ocohen@gmail.com as public author email (66 commits)
2. Private client-term sweep (tree + history)
3. docs/SPEC.md decision (original vs provisional)
4. Demo GIF per docs/demo-flow.md
5. npm login + pnpm -r publish
6. Clean-machine npx verify → real PR
7. Stranger's-repo gauntlet
8. Timed quickstart by someone else
9. Repo settings (description/topics/social/vuln reporting)
10. Flip public (move 'No GitHub remote' issue to Resolved then)

---

# Previous state (phase 10 session)

_Last updated: 2026-07-15_

## Current phase

**Phase 10 (Launch hardening) — automatable portion DONE** on branch
`phase-10-hardening` (not merged, not pushed — Omri's call). Phase 9 was
merged to main before this phase started. This is the LAST build-plan
phase; what remains is exclusively the human-only launch list below.

## What's done (Phase 10)

- **Secret sweep** — gitleaks 8.30.1 installed (brew). History scan (60
  commits) + tree scan (`gitleaks dir` over a git-archive of HEAD, so the
  gitignored real `.env` never enters) both CLEAN. One raw finding — the
  synthetic `owner-key-0123456789abcdef` fixture in
  `packages/api/src/auth.test.ts` — allowlisted in a committed
  `.gitleaks.toml` (fixtures/placeholders only, each with a comment;
  header says unexplained findings get flagged, never allowlisted).
  Verified `.env` was never committed in any ref.
- **Forbidden-content sweep** — tree AND full history grep: "Mission
  Control" appears only in the rule text (CLAUDE.md +
  extraction-checklist); no `staging.`/`.internal`/`.corp`/`.local`
  hostnames; fixture names are synthetic companies, emails `@example.com`;
  the only `/Users/` strings are deliberately fake paths
  (`/Users/example-user/…`) inside the dot-dir-leak regression tests.
  Nothing needed fixing.
- **Publish prep** — all 10 public packages (`@patchback/{types,widget,
react,sdk,api,github,agent-core,agent-claude-code,triage}` +
  `patchback`) de-privated with uniform metadata (MIT, repo/homepage/bugs
  → github.com/omricohen/patchback, keywords, `files: ["dist",
"README.md"]`, engines node>=20, publishConfig public). New minimal
  READMEs for types/api/agent-core/agent-claude-code/triage/cli (code
  samples verified against real exports: `transitionJob`, `buildServer`).
  `agent-claude-code/src/fixture.ts` (test scaffolding) excluded from the
  build so it left the tarball. `pnpm -r publish --dry-run
--no-git-checks` green 10/10; tarball audit clean (dist + README +
  LICENSE + package.json only); `workspace:*` → `0.0.1` verified via
  `pnpm pack`. Root/apps/examples stay private.
- **ROADMAP.md** (root) — App mode, dashboard, hosted, indexing, outsider
  clustering, Vue, per-user token exchange, check-runner sandboxing,
  SQLite, `pr.closed` state revision, issue idempotency, custom check
  commands, Temporal. github README's "Phase 10" App-mode refs now point
  at it; root README links CONTRIBUTING/ROADMAP/SECURITY.
- **Repo metadata** — `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md`,
  `.github/PULL_REQUEST_TEMPLATE.md` (gate + no-secrets + hard-rules
  checklist), CONTRIBUTING.md (pnpm-only setup, gate command, phase-branch
  note, the five hard rules), CODE_OF_CONDUCT.md (Contributor Covenant
  2.1, GitHub-native contact — no email committed).
- **Extraction checklist** — every mechanically verifiable box checked
  with a one-line evidence note; human-only work consolidated in a new
  "Remaining — requires Omri" section (8 items).
- Gate green at root: `pnpm lint && pnpm typecheck && pnpm test && pnpm
build` + `pnpm format:check`.

## Next concrete step — all Omri, in order

1. Review + merge `phase-10-hardening`; push.
2. Real `pnpm -r publish` (after `npm login`).
3. `npx patchback dev` from a clean machine via the published packages.
4. Stranger's-repo gauntlet (3 repos, one graceful failure) + quickstart
   timed by someone else (carried from Phase 9).
5. Demo GIF: run `docs/demo-flow.md` on examples/nextjs-demo, record.
6. One forbidden-term pass with the private term list (only Omri has it).
7. GitHub settings: description, topics, social image, private
   vulnerability reporting; then flip public.

Full list with evidence notes: docs/extraction-checklist.md, "Remaining —
requires Omri".

## Context to pick up cleanly

- Phase-10 decisions in `.claude/DECISIONS.md` (2026-07-15): gitleaks
  allowlist policy, publish posture (maps shipped, fixture.ts excluded),
  ROADMAP placement, CoC contact choice.
- Phase 2's extraction inbox was never used — the codebase was written
  fresh, which is why the checklist's inbox/fresh-history boxes are
  checkable. `extraction-inbox/` is empty and stays gitignored.
- The examples' READMEs still use the run-from-this-repo form; swap to
  `npx patchback dev` once the real publish lands (README quickstart
  already written for the published future with a callout).
