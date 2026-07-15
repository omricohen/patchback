import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPatchbackWidget } from './index.js';
import { MaskingConfigError } from './masking/policy.js';

/**
 * Widget lifecycle in jsdom: shadow-root isolation, open/close/destroy,
 * console-wrap consent, submit path through the real SDK client against a
 * mocked fetch, and no page-DOM mutation. Geometry-dependent picker
 * behavior lives in the env-gated browser suite.
 */

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  };
}

const widgets: Array<{ destroy(): void }> = [];

function makeWidget(
  config: Partial<Parameters<typeof createPatchbackWidget>[0]> = {},
) {
  const widget = createPatchbackWidget({
    apiUrl: 'http://api.test',
    launcher: true,
    ...config,
  });
  widgets.push(widget);
  return widget;
}

afterEach(() => {
  for (const widget of widgets) {
    widget.destroy();
  }
  widgets.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('widget lifecycle', () => {
  it('mounts ONE ignored host with an open shadow root; destroy removes it', () => {
    const widget = makeWidget();
    const hosts = document.querySelectorAll('[data-patchback-widget]');
    expect(hosts).toHaveLength(1);
    const host = hosts[0] as HTMLElement;
    // The widget must never capture itself: the host is ignore-marked.
    expect(host.hasAttribute('data-patchback-ignore')).toBe(true);
    expect(host.shadowRoot).not.toBeNull();
    // Widget UI lives in the shadow, not the page DOM.
    expect(document.querySelector('.pb-launcher')).toBeNull();
    expect(host.shadowRoot?.querySelector('.pb-launcher')).not.toBeNull();

    widget.destroy();
    expect(document.querySelectorAll('[data-patchback-widget]')).toHaveLength(
      0,
    );
    // Idempotent.
    widget.destroy();
  });

  it('open() renders the panel with the "What will be sent" preview; close() clears it', () => {
    const widget = makeWidget();
    const shadow = (
      document.querySelector('[data-patchback-widget]') as HTMLElement
    ).shadowRoot as ShadowRoot;
    widget.open();
    expect(shadow.querySelector('[role="dialog"]')).not.toBeNull();
    expect(shadow.textContent).toContain('What will be sent');
    // Zero-config: URL preview shown (query-stripped), no screenshot button.
    expect(shadow.textContent).toContain('Page URL:');
    expect(shadow.textContent).not.toContain('Attach screenshot');
    // Picker button visible by default (gesture-gated capture).
    expect(shadow.textContent).toContain('Point at the problem');
    widget.close();
    expect(shadow.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not touch the page DOM outside its own host', () => {
    document.body.innerHTML = '<main id="app"><p>content</p></main>';
    const before = (document.querySelector('#app') as Element).outerHTML;
    const widget = makeWidget();
    widget.open();
    widget.close();
    expect((document.querySelector('#app') as Element).outerHTML).toBe(before);
  });

  it('installs the console wrap ONLY when configured, and restores on destroy', () => {
    const original = console.error;
    const plain = makeWidget();
    expect(console.error).toBe(original);
    plain.destroy();

    const wired = makeWidget({ capture: { console: true } });
    expect(console.error).not.toBe(original);
    wired.destroy();
    expect(console.error).toBe(original);
  });

  it('throws loudly at init on invalid masking selectors', () => {
    expect(() => makeWidget({ masking: { maskSelectors: ['<<<'] } })).toThrow(
      MaskingConfigError,
    );
  });

  it('submits through the SDK and renders the thread view with a status chip', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/feedback')) {
        return jsonResponse(201, {
          id: 'fb-1',
          jobId: 'job-1',
          readToken: 'tok-1',
        });
      }
      if (input.includes('/jobs/job-1/status')) {
        return jsonResponse(200, {
          id: 'job-1',
          feedbackId: 'fb-1',
          state: 'feedback.needs_clarification',
          history: [
            {
              from: 'feedback.received',
              to: 'feedback.triaged',
              at: '2026-07-15T12:00:00.000Z',
            },
            {
              from: 'feedback.triaged',
              to: 'feedback.needs_clarification',
              at: '2026-07-15T12:00:01.000Z',
            },
          ],
        });
      }
      if (input.includes('/feedback/fb-1')) {
        return jsonResponse(200, {
          id: 'fb-1',
          message: 'The label is wrong',
          trustTier: 'insider',
          triage: {
            classification: 'needs_clarification',
            confidence: 0.6,
            clarifyingQuestion: 'Which label?',
          },
          replies: [],
          createdAt: '2026-07-15T12:00:00.000Z',
          updatedAt: '2026-07-15T12:00:00.000Z',
        });
      }
      return jsonResponse(404, {
        error: { code: 'not_found', message: 'nope' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const widget = makeWidget({ apiKey: 'k'.repeat(24) });
    const events: string[] = [];
    widget.on('submitted', () => events.push('submitted'));
    widget.on('statusChange', (e) => events.push(e.state));
    widget.open();

    const shadow = (
      document.querySelector('[data-patchback-widget]') as HTMLElement
    ).shadowRoot as ShadowRoot;
    const textarea = shadow.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'The label is wrong';
    textarea.dispatchEvent(new Event('input'));
    const submit = Array.from(shadow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Send feedback',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();

    // Submit + first poll tick resolve on the microtask queue.
    await vi.waitFor(() => {
      const chip = shadow.querySelector('.pb-chip');
      if (chip === null) {
        throw new Error('no chip yet');
      }
      expect(chip.textContent).toBe('Question for you');
    });
    expect(events).toContain('submitted');
    expect(events).toContain('feedback.needs_clarification');
    // Clarification terminal state → reply box present.
    await vi.waitFor(() => {
      expect(shadow.textContent).toContain('Which label?');
    });
    expect(shadow.querySelector('textarea')).not.toBeNull();

    // The submit body went through the choke point: capture defaults only.
    const submitCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith('/feedback'),
    ) as unknown as [string, { body: string }];
    const body = JSON.parse(submitCall[1].body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['capture', 'message']);
    const capture = body.capture as Record<string, unknown>;
    expect(Object.keys(capture).sort()).toEqual(['capturedAt', 'url']);
    expect(body).not.toHaveProperty('trustTier');
  });
});
