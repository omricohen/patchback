import { createPatchbackWidget } from '@patchback/widget';

import { renderPage, renderSetupNote } from './page.js';

const root = document.querySelector('#app') as HTMLElement;
renderPage(root);

/**
 * Same wiring as the snippet `patchback dev` prints, but through the
 * package import instead of the script tag (this app has a bundler). The
 * insider dev key is minted per run of `patchback dev` — copy it from the
 * banner into `.env.local` (template: `.env.example`).
 */
const apiUrl =
  (import.meta.env.VITE_PATCHBACK_API_URL as string | undefined) ??
  'http://127.0.0.1:8787';
const apiKey = import.meta.env.VITE_PATCHBACK_API_KEY as string | undefined;

if (apiKey === undefined || apiKey === '') {
  renderSetupNote(
    root,
    'Patchback is not wired up yet: run `patchback dev`, copy the insider ' +
      'dev key from its banner into examples/vite-demo/.env.local (see ' +
      '.env.example), then restart `vite`.',
  );
} else {
  createPatchbackWidget({ apiUrl, apiKey });
  renderSetupNote(
    root,
    'Patchback is running — use the feedback button in the corner.',
  );
}
