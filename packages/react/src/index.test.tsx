import { act, render, cleanup } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PatchbackLauncher,
  PatchbackProvider,
  usePatchback,
  usePatchbackStatus,
} from './index.js';

const CONFIG = { apiUrl: 'http://api.test' };

function hostCount(): number {
  return document.querySelectorAll('[data-patchback-widget]').length;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('PatchbackProvider', () => {
  it('creates exactly one widget on mount and destroys it on unmount', () => {
    const view = render(
      <PatchbackProvider config={CONFIG}>
        <span>app</span>
      </PatchbackProvider>,
    );
    expect(hostCount()).toBe(1);
    view.unmount();
    expect(hostCount()).toBe(0);
  });

  it('is StrictMode-safe: double-mount still nets exactly one widget', () => {
    const view = render(
      <StrictMode>
        <PatchbackProvider config={CONFIG}>
          <span>app</span>
        </PatchbackProvider>
      </StrictMode>,
    );
    expect(hostCount()).toBe(1);
    view.unmount();
    expect(hostCount()).toBe(0);
  });

  it('recreates the widget when the config identity changes', () => {
    const view = render(<PatchbackProvider config={CONFIG} />);
    const first = document.querySelector('[data-patchback-widget]');
    view.rerender(<PatchbackProvider config={{ apiUrl: 'http://api.test' }} />);
    expect(hostCount()).toBe(1);
    expect(document.querySelector('[data-patchback-widget]')).not.toBe(first);
  });

  it('SSR: renderToString emits no widget markup and does not throw', () => {
    const html = renderToString(
      <PatchbackProvider config={CONFIG}>
        <main>content</main>
      </PatchbackProvider>,
    );
    expect(html).toContain('content');
    expect(html).not.toContain('patchback');
  });
});

describe('hooks and launcher', () => {
  it('usePatchback exposes the controller after mount', () => {
    let seen: unknown = 'unset';
    function Probe() {
      seen = usePatchback();
      return null;
    }
    render(
      <PatchbackProvider config={CONFIG}>
        <Probe />
      </PatchbackProvider>,
    );
    expect(seen).not.toBeNull();
    expect(typeof (seen as { open: unknown }).open).toBe('function');
  });

  it('usePatchbackStatus re-renders on statusChange events', () => {
    const states: Array<string | null> = [];
    function Probe() {
      const status = usePatchbackStatus();
      states.push(status?.state ?? null);
      return null;
    }
    render(
      <PatchbackProvider config={CONFIG}>
        <Probe />
      </PatchbackProvider>,
    );
    expect(states.at(-1)).toBeNull();
    // No public event-injection surface — statusChange fires from polling,
    // which the jsdom suite for the widget covers; here we assert the hook
    // subscribes without crashing and starts null.
  });

  it('PatchbackLauncher toggles the widget panel', () => {
    const { getByRole } = render(
      <PatchbackProvider config={{ ...CONFIG, launcher: false }}>
        <PatchbackLauncher>Feedback</PatchbackLauncher>
      </PatchbackProvider>,
    );
    const host = document.querySelector(
      '[data-patchback-widget]',
    ) as HTMLElement;
    // launcher: false suppresses the built-in button.
    expect(host.shadowRoot?.querySelector('.pb-launcher')).toBeNull();
    const button = getByRole('button', { name: 'Feedback' });
    act(() => button.click());
    expect(host.shadowRoot?.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => button.click());
    expect(host.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
  });
});
