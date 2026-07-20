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

- `submitFeedback` sends the app credential iff configured (`apiKey`, or a
  per-user token via `getToken` — see below).
- Reads/replies take a `ReadAuth` argument: `{ readToken }` (the per-item
  capability returned ONCE at creation) or `{ useApiKey: true }` (trusted
  dashboard use). There is no silent fallback from token to key.
- `startJob` requires an app credential (`apiKey` or `getToken`) and is a
  plain wrapper — the server re-enforces caller tier, stored-item tier, job
  state, and the triage gate. Unauthorized reads are **404**, never 401/403.

## Per-user tokens (recommended for public-facing / multi-user apps)

Shipping the app's long-lived `apiKey` to a page confers its tier on every
visitor and exposes the key in source — fine for an **internal app behind your
own auth**, wrong for a public or many-user app. Instead, pass a `getToken`
provider that fetches a **short-lived, tier-scoped per-user token** from **your
own backend** (which holds the key and exchanges it at Patchback's server-only
`POST /tokens/exchange`). `apiKey` and `getToken` are mutually exclusive.

```ts
const client = createPatchbackClient({
  baseUrl: 'https://patchback.your.host',
  // Points at YOUR backend, not Patchback. The SDK never calls
  // /tokens/exchange (it has no parent key and that endpoint rejects
  // browsers). The SDK caches the token and re-fetches before expiry.
  getToken: () => fetch('/patchback-token').then((r) => r.json()),
});
```

Your backend endpoint is ~15 lines (your framework, your session) — it
authenticates the user and forwards to the exchange:

```ts
app.get('/patchback-token', requireAppSession, async (req, res) => {
  const r = await fetch('https://patchback.your.host/tokens/exchange', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.PATCHBACK_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tier: 'insider', subject: req.user.id }),
  });
  res.json(await r.json()); // { token, tier, expiresAt }
});
```

Guarantees the server enforces: the minted token can **never exceed the parent
key's tier**, its **expiry is checked on every request** (an expired token fails
closed to `outsider` — data-only, exactly like no credential, never a 401), and
the exchange endpoint is unreachable from a browser. The **direct `apiKey`
remains supported and unchanged** for the internal-app path.

## Errors and polling

Non-2xx responses throw `PatchbackApiError { status, code, message }`
(malformed error bodies fail closed to `code: 'unknown'`); network errors
propagate as-is. `pollJobStatus` polls fast until triage, then slow;
backs off (capped) on transient failures with an `onConnectionIssue`
callback; resolves at terminal states (`feedback.needs_clarification`,
`patch.failed`, `feedback.closed`); stops hard on 404; and accepts an
`AbortSignal` (page-visibility pausing is the caller's job).

## Outcome fields on the job status

`JobStatusResponse` carries two optional, non-technical outcome fields once a
PR exists (both served to the read-token holder / owner-insider keys, both
absent when unset — the DTO is byte-identical to a job without them):

- `userSummary?: string` — a plain-language summary of what changed. Display
  text; if you render it, escape it (the widget uses a text node).
- `previewUrl?: string` — your preview provider's URL for this change, surfaced
  from GitHub. Validated `http(s)` server-side; re-validate before using it as
  an `href`.

## Contract

Response DTO types live here, composed from `@patchback/types`
primitives. Drift is prevented by contract tests that boot the real
`@patchback/api` server — if a route shape changes, this package's suite
goes red. The typed request builders make client-supplied fields like
`trustTier` unrepresentable on the wire (and the server 400s them
anyway).
