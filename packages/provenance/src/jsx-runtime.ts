/**
 * `jsxImportSource: '@patchback/provenance'` — PRODUCTION runtime entry.
 *
 * A pure passthrough to React's own `jsx-runtime`. The production transform
 * emits no source info, so there is nothing to stamp and nothing to strip:
 * dev-only annotation falls out structurally, with zero prod overhead.
 * (Production annotation, for internal apps that opt in, is the babel
 * plugin's job — see `./babel`.)
 */
export { Fragment, jsx, jsxs } from 'react/jsx-runtime';
export type { JSX } from 'react/jsx-runtime';
