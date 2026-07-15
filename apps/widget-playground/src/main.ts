import { createPatchbackWidget } from '@patchback/widget';

import { renderDemoPage } from './demo-page.js';

renderDemoPage(document.querySelector('#demo-root') as HTMLElement);

/**
 * Playground mounts with the INSIDER dev key so the full loop runs:
 * submit → triage → Start patch → agent (fake) → PR → merge helper →
 * closed. Everything opt-in is switched ON here — the playground is the
 * kitchen sink; the zero-config default is exercised by the widget's own
 * tests.
 */
const widget = createPatchbackWidget({
  apiUrl: '/api',
  apiKey: 'pb_dev_insider_key_000000',
  capture: {
    page: true,
    screenshot: true,
    console: { levels: ['error', 'warn'], max: 50 },
  },
  polling: { fastMs: 700, slowMs: 1200 },
  submitter: { id: 'playground-user', name: 'Playground User' },
});

widget.on('submitted', (event) => {
  console.warn('[playground] submitted', event);
});
widget.on('statusChange', (event) => {
  console.warn('[playground] status', event.state);
});

// Expose for console poking in the playground ONLY.
(window as unknown as { patchback: unknown }).patchback = widget;
