# @patchback/agent-claude-code

The default agent adapter for
[Patchback](https://github.com/omricohen/patchback): spawns the
[Claude Code](https://claude.com/claude-code) CLI headless against a per-job
scratch directory with a structured task brief, parses the result, and
enforces a diff-size ceiling (default ~300 changed lines — a bigger diff means
triage was wrong, so the job fails with a useful message instead of opening a
sprawling PR).

Requirements:

- `claude` CLI **2.1+** on `PATH`.
- `ANTHROPIC_API_KEY` — the spawn is isolated from your machine's Claude Code
  config (empty per-job `CLAUDE_CONFIG_DIR`, allowlisted environment,
  `--bare --strict-mcp-config`), so keychain/OAuth logins are deliberately
  never read.

Implements the adapter interface from
[`@patchback/agent-core`](https://github.com/omricohen/patchback/tree/main/packages/agent-core#readme);
swap in a different adapter without touching the pipeline.

Part of the Patchback monorepo — see the
[root README](https://github.com/omricohen/patchback#readme). MIT licensed.
