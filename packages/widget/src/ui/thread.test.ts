import { describe, expect, it } from 'vitest';

import type { JobStatusResponse } from '@patchback/sdk';

import { renderThread, type ThreadViewActions } from './thread.js';

/**
 * Direct render tests for the feedback outcome view (jsdom): the plain-language
 * summary renders as an escaped TEXT NODE, the preview link is a hardened,
 * scheme-validated anchor, and with neither field set the DOM is unchanged.
 */

const noopActions: ThreadViewActions = {
  onReply: () => {},
  onStartPatch: () => {},
  onNewFeedback: () => {},
  onClose: () => {},
};

function baseStatus(
  overrides: Partial<JobStatusResponse> = {},
): JobStatusResponse {
  return {
    id: 'job-1',
    feedbackId: 'fb-1',
    state: 'pr.opened',
    history: [
      { from: 'patch.running', to: 'pr.opened', at: '2026-07-20T00:00:00Z' },
    ],
    ...overrides,
  };
}

function render(status: JobStatusResponse): HTMLElement {
  const container = document.createElement('div');
  renderThread(
    container,
    {
      status,
      hasApiKey: false,
      submittingReply: false,
      startingPatch: false,
      connectionLost: false,
    },
    noopActions,
  );
  return container;
}

describe('renderThread — outcome view (userSummary + previewUrl)', () => {
  it('renders the userSummary as an AI note', () => {
    const container = render(
      baseStatus({ userSummary: 'The button now reads Submit.' }),
    );
    const note = container.querySelector('.pb-ai-summary');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('What changed');
    expect(note?.textContent).toContain('The button now reads Submit.');
  });

  it('renders a summary containing HTML as literal text, never as markup (no XSS)', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const container = render(baseStatus({ userSummary: evil }));
    const paragraph = container.querySelector('.pb-ai-summary p');
    expect(paragraph).not.toBeNull();
    // The dangerous string is present as text, not as parsed elements.
    expect(paragraph?.textContent).toBe(evil);
    expect(paragraph?.querySelector('img')).toBeNull();
    expect(paragraph?.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders a hardened "Preview this change" anchor for a safe http(s) URL', () => {
    const container = render(
      baseStatus({ previewUrl: 'https://preview.example.com/pr/1' }),
    );
    const link = container.querySelector(
      'a.pb-preview-link',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://preview.example.com/pr/1');
    expect(link?.getAttribute('rel')).toBe('noreferrer noopener');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.textContent).toBe('Preview this change');
  });

  it('renders NO preview anchor for a javascript: URL', () => {
    const container = render(baseStatus({ previewUrl: 'javascript:alert(1)' }));
    expect(container.querySelector('a.pb-preview-link')).toBeNull();
  });

  it('renders NO preview anchor for a data: URL', () => {
    const container = render(
      baseStatus({ previewUrl: 'data:text/html,<script>alert(1)</script>' }),
    );
    expect(container.querySelector('a.pb-preview-link')).toBeNull();
  });

  it('renders NEITHER block when both fields are absent (byte-identical DOM)', () => {
    const withOutcome = render(
      baseStatus({
        userSummary: 'x',
        previewUrl: 'https://preview.example.com/pr/1',
      }),
    );
    const without = render(baseStatus());
    // The absent case has no summary note and no preview link at all.
    expect(without.querySelector('.pb-ai-summary')).toBeNull();
    expect(without.querySelector('a.pb-preview-link')).toBeNull();
    // Sanity: the present case does add them, so the assertion is meaningful.
    expect(withOutcome.querySelector('.pb-ai-summary')).not.toBeNull();
    expect(withOutcome.querySelector('a.pb-preview-link')).not.toBeNull();
  });
});
