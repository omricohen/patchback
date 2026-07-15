/**
 * Smoke test: the page renders in jsdom. Deliberately does NOT pin the
 * seeded demo flaw (the "Whats new" header) — a Patchback demo PR fixing
 * it must leave this test green.
 */
import { describe, expect, it } from 'vitest';

import { renderPage, renderSetupNote } from '../src/page.js';

describe('renderPage', () => {
  it('renders the demo content and the setup-note slot', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    renderPage(root);

    expect(root.querySelector('h1')?.textContent).toBe('Vite demo');
    expect(root.querySelectorAll('li').length).toBeGreaterThan(0);

    renderSetupNote(root, 'hello from the test');
    expect(root.querySelector('#patchback-note')?.textContent).toBe(
      'hello from the test',
    );
  });
});
