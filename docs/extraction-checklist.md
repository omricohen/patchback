# Extraction checklist

Rules and final gate for extracting code from private client projects into this public
repo. The whole project is **done** only when every box here is checked.

_Phase-10 status (2026-07-15): every box that can be verified mechanically is checked
below, each with a one-line evidence note. The boxes that need Omri (real npm publish,
second human, GitHub settings) are collected in "Remaining — requires Omri" at the
bottom._

## Rules (apply continuously, not just at the end)

- [x] Source material only ever enters via `/extraction-inbox/` (gitignored). Nothing is
      imported via git history — fresh history only, scrubbed working files only.
      _Evidence: all 60+ commits authored fresh in this repo; the `.env` add-log
      across all refs is empty; no client source material was ultimately imported
      (everything was written fresh — the inbox is empty and was never committed)._
- [x] No client identifiers anywhere in the tree: client names, client domains, staging
      URLs, real people's names in fixtures, internal hostnames/IPs, references to the
      private orchestration system ("Mission Control").
      _Evidence: 2026-07-15 grep sweep over tree AND full history — "Mission Control"
      only in this file + CLAUDE.md (the rule text itself); no `staging.`/`.internal`/
      `.corp`/`.local` hostnames; fixtures use synthetic company names and
      `@example.com`; the only `/Users/` strings are deliberately fake paths
      (`/Users/example-user/…`) in the dot-dir-leak regression tests._
- [x] All prompts/agent instructions are generic. Domain-specific source material
      (legal, staffing, etc.) rewritten before it lands in a package.
      _Evidence: triage prompt, brief builder, and adapter prompt are domain-neutral;
      grep for domain terms clean (2026-07-15)._
- [x] Anything that smells client-specific gets flagged to Omri — never guessed at.
      _Evidence: standing rule, followed through Phase 9; nothing pending flagging._
- [x] No secrets, ever. `.env` gitignored; `.env.example` placeholders only. A
      real-looking key in source material stops work and gets flagged — not copied,
      not committed.
      _Evidence: gitleaks 8.30.1 clean on tree + full history (see Sweeps); `.env`
      never committed in any ref._

## Per-file extraction flow (Phase 2)

1. File lands in `/extraction-inbox/`.
2. Generalize + strip client context per the rules above.
3. Move into the right package.
4. Delete from inbox.

- [x] `extraction-inbox/` empty at end of Phase 2.
      _Evidence: directory is empty as of 2026-07-15 (no source material was ever
      staged — the codebase was written fresh instead of extracted)._

## Sweeps (run before any commit that touches extracted material, and at launch)

- [x] Forbidden-term grep sweep clean. No local term-list file was ever created
      because no client source material entered the repo; the generic-pattern sweep
      (client-context patterns above) is clean on tree and history. _Omri should do
      one final pass with his private term list before flipping public — listed
      below._
- [x] `gitleaks detect` clean on the full tree.
      _Evidence: gitleaks 8.30.1 (installed 2026-07-15 via brew), config committed as
      `.gitleaks.toml` (allowlists only synthetic fixtures/placeholders, each with a
      comment). Tree scan (git-archive of HEAD) and history scan (60 commits): no
      leaks. The one raw finding was the `owner-key-0123456789abcdef` test fixture in
      `packages/api/src/auth.test.ts`._

## Launch gate (Phase 10)

- [x] gitleaks + forbidden-term sweep on full tree, including git history.
      _Evidence: both run 2026-07-15 on branch `phase-10-hardening`; both clean (see
      Sweeps notes above)._
- [x] npm publish dry-run clean for all public packages.
      _Evidence: `pnpm -r publish --dry-run --no-git-checks` succeeds for all 10
      public packages (the nine `@patchback/*` scoped packages plus `patchback`);
      tarballs contain only dist, README.md, LICENSE, and package.json (test-only
      `fixture.ts` excluded from the agent-claude-code build); `workspace:*` deps
      convert to `0.0.1`._
- [ ] `npx patchback dev` verified from a clean machine via published packages.
- [ ] Stranger's-repo gauntlet: 3 unfamiliar repos, one expected graceful failure.
- [ ] README quickstart verified cold, timed under 10 minutes by someone other than Omri.
- [ ] Demo GIF flow reproducible on `examples/nextjs-demo`.

## Remaining — requires Omri

Everything still open needs real credentials, a real npm publish, a second human, or
GitHub settings access:

1. **Real npm publish** of all 10 public packages (`pnpm -r publish` after `npm login`;
   dry-run already green).
2. **`npx patchback dev` from a clean machine** via the published packages (blocked on
   1).
3. **Stranger's-repo gauntlet** — 3 unfamiliar repos, one expected graceful failure
   (needs real GitHub + Anthropic credentials; carried from Phase 9).
4. **Timed quickstart** — someone other than Omri, under 10 minutes (carried from
   Phase 9).
5. **Demo GIF recording** — run `docs/demo-flow.md` on `examples/nextjs-demo` with real
   credentials and record it.
6. **Final forbidden-term pass with the private term list** — only Omri knows the
   client identifiers; the generic-pattern sweep is clean but is not a substitute.
7. **GitHub repo settings** — description, topics, social-preview image; enable
   private vulnerability reporting (SECURITY.md points at it); confirm issues enabled.
8. **Flip the repo to public** — last, after 1–7.
