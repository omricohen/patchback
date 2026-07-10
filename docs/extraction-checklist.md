# Extraction checklist

Rules and final gate for extracting code from private client projects into this public
repo. The whole project is **done** only when every box here is checked.

## Rules (apply continuously, not just at the end)

- [ ] Source material only ever enters via `/extraction-inbox/` (gitignored). Nothing is
      imported via git history — fresh history only, scrubbed working files only.
- [ ] No client identifiers anywhere in the tree: client names, client domains, staging
      URLs, real people's names in fixtures, internal hostnames/IPs, references to the
      private orchestration system ("Mission Control").
- [ ] All prompts/agent instructions are generic. Domain-specific source material
      (legal, staffing, etc.) rewritten before it lands in a package.
- [ ] Anything that smells client-specific gets flagged to Omri — never guessed at.
- [ ] No secrets, ever. `.env` gitignored; `.env.example` placeholders only. A
      real-looking key in source material stops work and gets flagged — not copied,
      not committed.

## Per-file extraction flow (Phase 2)

1. File lands in `/extraction-inbox/`.
2. Generalize + strip client context per the rules above.
3. Move into the right package.
4. Delete from inbox.

- [ ] `extraction-inbox/` empty at end of Phase 2.

## Sweeps (run before any commit that touches extracted material, and at launch)

- [ ] Forbidden-term grep sweep clean (maintain the term list in a **local, uncommitted**
      file, e.g. `extraction-inbox/forbidden-terms.txt`, since the terms themselves are
      client identifiers).
- [ ] `gitleaks detect` clean on the full tree. _(Not yet installed on this machine —
      `brew install gitleaks`.)_

## Launch gate (Phase 10)

- [ ] gitleaks + forbidden-term sweep on full tree, including git history.
- [ ] npm publish dry-run clean for all public packages.
- [ ] `npx patchback dev` verified from a clean machine via published packages.
- [ ] Stranger's-repo gauntlet: 3 unfamiliar repos, one expected graceful failure.
- [ ] README quickstart verified cold, timed under 10 minutes by someone other than Omri.
- [ ] Demo GIF flow reproducible on `examples/nextjs-demo`.
