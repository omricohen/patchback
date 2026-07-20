# @patchback/triage

Feedback triage for [Patchback](https://github.com/omricohen/patchback):
classifies every feedback item **before** any agent runs.

One model call over the message + capture context yields exactly one of:

- `patchable` — small, unambiguous, safe to hand to an agent.
- `needs_clarification` — plausible but underspecified; a clarifying question
  is generated and sent back to the submitter.
- `needs_human` — feature requests, redesigns, hostile or prompt-injection
  text. Never reaches an agent.

When uncertain, the classifier prefers the safer bucket (confidence threshold,
classify-down bias). Only `patchable` items from trusted tiers may start a
patch job — enforced structurally in
[`@patchback/agent-core`](https://github.com/omricohen/patchback/tree/main/packages/agent-core#readme),
not just here.

## Optional repo-aware second stage

When a `RepoProbe` is supplied (`TriageOptions.repoProbe`) and the first-pass
result is **borderline**, triage runs an optional retrieval second stage: a
**deterministic** fixed-string search of a repo working copy for strings the
feedback references, feeding a second classifier call. It is enabled purely by
the presence of a probe — wired only where a real on-disk checkout already
exists (`patchback dev` with `localRepoPath`, and the evals). With no probe,
behaviour is byte-identical to the single-call path.

Security posture — the probe never reopens the trust boundary:

- The model does **no tool use**; the probe is code between two calls. Queries
  are matched as **fixed strings, in-process** (no shell, no regex, no argv),
  so a hostile query is at worst a literal that matches or doesn't.
- Probe output is **paths + match counts only** — never file contents or
  snippets — so the evidence block can't carry attacker-controlled prose.
- Retrieval may move an item **up at most one rung** and only on an
  **unambiguous** single-file match; `needs_human` can rise to
  `needs_clarification` but **never** to `patchable`, enforced in code
  regardless of the model's output. It may always move **down**. Outsider
  feedback short-circuits before stage 1 and is never probed.

`.git`, `node_modules`, `.env`, and all dotfiles are structurally
unsearchable, and the probe is time/file/byte-bounded. See the
`RepoProbe`/`ProbeResult` types and `reconcile` in the package exports.

An eval fixture set (`evals/` in the repo, not shipped in the package) pins
behavior across labeled cases — typos, copy changes, sort-order asks, redesign
requests, borderline retrieval cases (over a synthetic fixture repo), and
injection attempts (which must always classify away from `patchable`).

Requires `ANTHROPIC_API_KEY`. Part of the Patchback monorepo — see the
[root README](https://github.com/omricohen/patchback#readme). MIT licensed.
