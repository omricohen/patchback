# @patchback/sdk

Zero-dependency typed client for the Patchback API. Works in browsers and
Node 20+ (injectable `fetch`, defaults to the global). The SDK stores
nothing — no localStorage, no token cache; read-token custody belongs to
the caller (the widget, in practice).

```ts
import { createPatchbackClient, pollJobStatus } from '@patchback/sdk';

const client = createPatchbackClient({
  baseUrl: 'http://localhost:8787',
  apiKey: process.env.PATCHBACK_KEY, // optional — absent ⇒ outsider tier
});

const { id, jobId, readToken } = await client.submitFeedback({
  message: 'The export button label has a typo',
});

const final = await pollJobStatus(
  client,
  jobId,
  { readToken },
  {
    onUpdate: (s) => console.log(s.state), // exact canonical JobState strings
  },
);
```

## Auth is explicit, never guessy

- `submitFeedback` sends the apiKey iff configured.
- Reads/replies take a `ReadAuth` argument: `{ readToken }` (the per-item
  capability returned ONCE at creation) or `{ useApiKey: true }` (trusted
  dashboard use). There is no silent fallback from token to key.
- `startJob` requires a configured apiKey and is a plain wrapper — the
  server re-enforces caller tier, stored-item tier, job state, and the
  triage gate. Unauthorized reads are **404**, never 401/403.

## Errors and polling

Non-2xx responses throw `PatchbackApiError { status, code, message }`
(malformed error bodies fail closed to `code: 'unknown'`); network errors
propagate as-is. `pollJobStatus` polls fast until triage, then slow;
backs off (capped) on transient failures with an `onConnectionIssue`
callback; resolves at terminal states (`feedback.needs_clarification`,
`patch.failed`, `feedback.closed`); stops hard on 404; and accepts an
`AbortSignal` (page-visibility pausing is the caller's job).

## Contract

Response DTO types live here, composed from `@patchback/types`
primitives. Drift is prevented by contract tests that boot the real
`@patchback/api` server — if a route shape changes, this package's suite
goes red. The typed request builders make client-supplied fields like
`trustTier` unrepresentable on the wire (and the server 400s them
anyway).
