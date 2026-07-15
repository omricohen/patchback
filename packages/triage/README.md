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

An eval fixture set (`evals/` in the repo, not shipped in the package) pins
behavior across ~30 labeled cases — typos, copy changes, sort-order asks,
redesign requests, and injection attempts (which must always classify away
from `patchable`).

Requires `ANTHROPIC_API_KEY`. Part of the Patchback monorepo — see the
[root README](https://github.com/omricohen/patchback#readme). MIT licensed.
