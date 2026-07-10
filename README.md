# Patchback

Open-source feedback widget that turns user feedback into GitHub pull requests via AI
coding agents — with a human review gate on every change.

**Status: pre-alpha, under active extraction/construction. Not usable yet.**

The loop: widget → context capture → triage → GitHub issue → agent writes change on a
branch → lint/tests → PR → human review → status back to the widget.

Design principles:

- **No auto-merge, ever.** Every change ships through a human-reviewed PR.
- **Triage before code.** Feedback is classified before any agent runs; uncertain or
  hostile input never reaches an agent.
- **Trust tiers.** Only trusted users can trigger patch jobs; outsider feedback is data,
  not instructions.
- **Local-first.** `npx patchback dev` will need only a GitHub fine-grained token and an
  Anthropic API key. No hosted services, no telemetry.

See [docs/SPEC.md](docs/SPEC.md) and [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## Development

Node 20+, [pnpm](https://pnpm.io) 10+.

```sh
pnpm install
pnpm lint && pnpm test && pnpm build
```

## License

[MIT](LICENSE)
