# STATE — where we left off

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
