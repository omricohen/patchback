# Security Policy

Patchback turns user feedback into AI-generated pull requests, so its security posture
is part of the product. The core guarantees:

- **No auto-merge.** Patchback never merges a PR. There is no flag or config option to
  enable it. Every change requires human review.
- **Trust tiers are enforced server-side.** Only `owner` and `insider` feedback can
  initiate patch jobs. `outsider` feedback is stored as data and is never passed to a
  coding agent as instructions.
- **Triage gates the agent.** Feedback classified as anything other than `patchable`
  never reaches an agent. Suspected prompt-injection content is classified
  `needs_human`.
- **Capture is opt-in and masked.** Input values are masked by default; screenshots
  redact masked elements before anything leaves the browser.
- **Local-first.** The OSS version sends no telemetry and requires no hosted services.

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub Security Advisories on this
repository ("Report a vulnerability"). Do not open public issues for security reports.

You can expect an acknowledgment within 72 hours. Please include reproduction steps and
the affected package(s).

## Scope of particular interest

- Trust-tier bypasses (outsider content reaching an agent)
- Prompt-injection paths from feedback text or captured context into agent instructions
- Masking bypasses (masked input values appearing in payloads or screenshots)
- Token/scope escalation in the GitHub integration
