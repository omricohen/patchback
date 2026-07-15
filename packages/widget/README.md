# @patchback/widget

Vanilla embeddable feedback widget. Zero runtime dependencies in the core
(the screenshot renderer lazy-loads `@zumer/snapdom` — the one exception),
rendered into an **open shadow root** on its own host element. No custom
elements, no CSS files, no CDN assets, no telemetry: the widget's only
network destination is the `apiUrl` you configure.

```ts
import { createPatchbackWidget } from '@patchback/widget';

const widget = createPatchbackWidget({ apiUrl: '/patchback-api' });
```

Script-tag build: `dist/patchback-widget.iife.js` exposes
`window.Patchback.create(config)`.

## Trust model — read this before shipping an apiKey

- `apiKey` is the **embedding app's** key and confers its tier
  (owner/insider) on every submission from the page. Shipping an insider
  key in a page makes **every visitor of that page an insider** — do this
  only in internal apps behind your own authentication (Patchback's
  stated positioning).
- Omit the key on public-facing pages: submissions land as `outsider` —
  stored and clusterable, but **never** passed to an agent and never able
  to start a patch job. The widget works keyless by design (submit + read
  via per-item read tokens need no key).
- The widget never handles trust tiers: no config field, no payload
  field. Tiers are assigned exclusively server-side; a body-supplied tier
  is a 400.

## What leaves the page (capture defaults)

With **zero config**, exactly this is sent on submit: the user's typed
message, the page URL with **query string and hash stripped**, and the
submit timestamp. Nothing else — pinned by an exact-snapshot test.

Everything else is opt-in, with two consent tiers:

- **Config consent** (you, the developer) for anything background:
  `page` (title/viewport/userAgent), `console` (the console wrap is not
  even installed without it), `screenshot` (shows the button).
- **Gesture consent** (the submitting user, per use) for the element
  picker and screenshots: data is captured only on an explicit click and
  shown in the panel's **"What will be sent"** preview — the payload is
  built _from_ that preview model, so the preview cannot lie. Every
  optional item has a remove control.

```ts
createPatchbackWidget({
  apiUrl: '/patchback-api',
  apiKey: process.env.INTERNAL_PATCHBACK_KEY, // internal apps only
  submitter: { id: 'u_123', name: 'Dana' }, // asserted by YOUR app
  capture: {
    url: { includeQuery: false }, // default; `false` drops the URL, `{includeQuery:true}` keeps the query
    page: false, // default
    elementPicker: true, // default (capture only on user pick)
    screenshot: false, // default; `true` shows the button
    console: false, // default; `true` = errors only; or { levels: ['error','warn'], max: 50 }
  },
  masking: {
    maskInputs: true, // default: all form-field VALUES masked
    maskSelectors: ['.pii'],
    unmaskSelectors: ['.public-stat'],
    ignoreSelectors: ['.admin-panel'],
    scrubText: true, // default: emails/keys/JWTs/query-strings scrubbed from CAPTURED text
  },
  persistThreads: false, // default: read tokens live in memory only
  launcher: true,
  theme: { '--patchback-accent': '#7c3aed' },
  zIndex: 2147483000,
});
```

## Masking semantics

Two verbs, not one:

- **masked** — the element exists in capture but its content is replaced:
  picker text becomes `[masked]`; in screenshots its content is stripped
  before rasterization and its box painted over after. Geometry and
  `domPath`/`tagName` remain (structure is not content).
- **ignored** — the subtree is absent: unpickable (the picker shows an
  "excluded" treatment), text never captured, full box painted over in
  screenshots.

Markup controls work with zero config: `data-patchback-mask`,
`data-patchback-unmask`, `data-patchback-ignore` (nearest marker wins;
mask beats unmask on the same node; ignore beats everything).

**Non-overridable floor:** `input[type=password]`, `input[type=hidden]`,
and `autocomplete` values `cc-number` / `cc-csc` / `cc-exp*` /
`one-time-code` / `current-password` / `new-password` are ALWAYS masked.
No config flag or unmask marker reaches them.

Fail-closed rules: cross-origin iframes are always treated as ignored.
Invalid config selectors throw at init rather than running unprotected.
The user's typed message is sent verbatim — scrubbing applies to
_captured_ text only, never deliberate speech.

## Screenshots

DOM rasterization (snapdom, behind a one-file renderer seam) with **two
independent redaction layers**: masked content is stripped from the
render clone _before pixels exist_, and viewport rects of every
masked/ignored element are painted over the canvas _after_. The result is
downscaled and walked down a WebP→JPEG quality ladder until it fits the
server's 512 KiB cap — if it can't fit, it is **dropped with a notice**,
never sent oversized and never allowed to block the submit.

Known limitations (accepted for v0.1): cross-origin images may render
blank (CORS taint rules); output is a faithful re-render, not a
pixel-identical screen grab; iframes are opaque boxes (by policy anyway);
content inside **closed** shadow roots is not serializable by the
renderer at all — it simply never reaches the clone.

## Threads and read tokens

Submission returns a one-time read token per item; the widget keeps
thread records **in memory only** by default (reload forgets them).
`persistThreads: true` opts into localStorage — note a read token grants
read access to the item _including its capture context_, so enable this
only in internal apps on trusted machines. Tokens are never logged and
never appear in URLs.

## Status display

Canonical job states map to labels in `status-map.ts`
(compile-time-exhaustive). The reply box renders only while a job is at
`feedback.needs_clarification`; the "Start patch" button renders only
with an apiKey + `feedback.triaged` + `patchable` — presentation only,
the server re-enforces every gate. There is no auto-merge anywhere:
`pr.reviewed` and beyond only happen through human action on GitHub.
