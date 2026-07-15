# @patchback/react

Thin React wrapper for `@patchback/widget` — lifecycle + events + types,
nothing else. One UI implementation exists (the vanilla one); this
package creates it in an effect and destroys it on unmount. SSR-safe and
StrictMode-safe. Peer dependency: `react ^18 || ^19`; no `react-dom`
required.

```tsx
import {
  PatchbackProvider,
  PatchbackLauncher,
  usePatchbackStatus,
} from '@patchback/react';

// Hoist or memoize: config is compared by IDENTITY.
const CONFIG = { apiUrl: '/patchback-api' };

export function App() {
  return (
    <PatchbackProvider config={CONFIG}>
      <Dashboard />
    </PatchbackProvider>
  );
}
```

- `usePatchback()` — the widget controller
  (`open`/`close`/`toggle`/`pickElement`/`on`), `null` before mount and
  during SSR.
- `usePatchbackStatus()` — re-renders on job status changes (canonical
  `JobState` strings), `null` until the first event.
- `<PatchbackLauncher>` — optional custom button; pair with
  `launcher: false` in the config to suppress the built-in one.

All capture, masking, and trust-model semantics are the widget's — see
`@patchback/widget`'s README, especially the apiKey warning before
shipping a key in a page.
