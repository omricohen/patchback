import type { PickedElement } from '@patchback/types';
import {
  createPatchbackClient,
  pollJobStatus,
  type FeedbackThreadResponse,
  type JobStatusResponse,
  type PatchbackClient,
} from '@patchback/sdk';

import {
  resolveCaptureConfig,
  validateWidgetConfig,
  type PatchbackWidgetConfig,
  type ResolvedCaptureConfig,
} from './config.js';
import {
  buildCaptureContext,
  environmentFromWindow,
  type CapturePreviewModel,
} from './capture/context.js';
import {
  createConsoleBuffer,
  type ConsoleBuffer,
} from './capture/console-buffer.js';
import { sanitizeUrl } from './capture/url.js';
import {
  createEmitter,
  type WidgetEventMap,
  type WidgetEventName,
} from './events.js';
import { createMaskingEngine, type MaskingEngine } from './masking/engine.js';
import { scrubText } from './masking/scrub.js';
import { createThreadStore, type ThreadStore } from './storage.js';
import { createWidgetRoot, type WidgetRoot } from './ui/root.js';
import { h, clear } from './ui/dom.js';
import { renderPanel, type PanelDraft } from './ui/panel.js';
import { pickElementInteractive } from './ui/picker-overlay.js';
import { renderThread } from './ui/thread.js';

export interface PatchbackWidget {
  open(): void;
  close(): void;
  toggle(): void;
  /** Programmatic picker entry (also the keyboard-path escape hatch). */
  pickElement(): Promise<PickedElement | undefined>;
  /** Full teardown, including console unwrap and host removal. Idempotent. */
  destroy(): void;
  on<E extends WidgetEventName>(
    event: E,
    listener: (payload: WidgetEventMap[E]) => void,
  ): () => void;
}

type View = 'closed' | 'panel' | 'thread';

interface ActiveThread {
  rootId: string;
  feedbackId: string;
  jobId: string;
  readToken: string;
}

export function createWidgetController(
  config: PatchbackWidgetConfig,
): PatchbackWidget {
  validateWidgetConfig(config);
  const capture: ResolvedCaptureConfig = resolveCaptureConfig(config.capture);
  // Masking engine construction validates selectors — loud at init.
  const engine: MaskingEngine = createMaskingEngine(config.masking);
  const client: PatchbackClient = createPatchbackClient({
    baseUrl: config.apiUrl,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config.getToken !== undefined ? { getToken: config.getToken } : {}),
  });
  // Either credential can authorize elevated actions (starting a patch); the
  // server re-enforces every tier gate regardless.
  const hasElevatedCredential =
    config.apiKey !== undefined || config.getToken !== undefined;
  const threads: ThreadStore = createThreadStore({
    persist: config.persistThreads ?? false,
    apiUrl: config.apiUrl,
  });
  const emitter = createEmitter();

  // Config consent: the console wrap is INSTALLED only when enabled.
  let consoleBuffer: ConsoleBuffer | undefined;
  if (capture.console !== false) {
    consoleBuffer = createConsoleBuffer({
      levels: capture.console.levels,
      max: capture.console.max,
      scrub: engine.config.scrubText ? scrubText : (t): string => t,
    });
    consoleBuffer.install();
  }

  const root: WidgetRoot = createWidgetRoot({
    ...(config.theme !== undefined ? { theme: config.theme } : {}),
    ...(config.zIndex !== undefined ? { zIndex: config.zIndex } : {}),
  });

  let destroyed = false;
  let view: View = 'closed';
  let draft: PanelDraft = { message: '', includeConsole: true };
  let submitting = false;
  let panelError: string | undefined;

  let active: ActiveThread | undefined;
  let threadResponse: FeedbackThreadResponse | undefined;
  let status: JobStatusResponse | undefined;
  let submittingReply = false;
  let startingPatch = false;
  let connectionLost = false;
  let threadError: string | undefined;
  let pollAbort: AbortController | undefined;

  // ----- rendering -------------------------------------------------------

  const panelHost = h('div', {});
  root.container.appendChild(panelHost);

  let launcherButton: HTMLButtonElement | undefined;
  if (config.launcher !== false) {
    launcherButton = h(
      'button',
      {
        className: 'pb-launcher',
        type: 'button',
        'aria-label': 'Send feedback',
      },
      [],
    );
    launcherButton.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.9-.9L3 20l1.2-4.3a8.2 8.2 0 0 1-1-4A8.38 8.38 0 0 1 11.7 3.4 8.5 8.5 0 0 1 21 11.5z"/></svg>';
    launcherButton.addEventListener('click', () => toggle());
    root.container.appendChild(launcherButton);
  }

  function render(): void {
    if (destroyed) {
      return;
    }
    if (view === 'closed') {
      clear(panelHost);
      return;
    }
    const dialog = ensureDialog();
    if (view === 'panel') {
      renderPanel(
        dialog,
        {
          draft,
          capture,
          ...(urlPreview() !== undefined ? { urlPreview: urlPreview() } : {}),
          consoleEntries: consoleBuffer?.entries() ?? [],
          submitting,
          ...(panelError !== undefined ? { error: panelError } : {}),
        },
        {
          onMessageInput: (message) => {
            draft.message = message;
            // No re-render on keystrokes — only the submit disabled state
            // depends on it; update it in place.
            const submit = dialog.querySelector('.pb-btn-primary');
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = submitting || message.trim() === '';
            }
          },
          onPick: () => {
            void runPicker();
          },
          onScreenshot: () => {
            void runScreenshot();
          },
          onRemoveElement: () => {
            delete draft.element;
            render();
          },
          onRemoveScreenshot: () => {
            delete draft.screenshot;
            render();
          },
          onToggleConsole: (include) => {
            draft.includeConsole = include;
          },
          onSubmit: () => {
            void submit();
          },
          onClose: () => close(),
        },
      );
      return;
    }
    renderThread(
      dialog,
      {
        ...(threadResponse !== undefined ? { thread: threadResponse } : {}),
        ...(status !== undefined ? { status } : {}),
        hasApiKey: hasElevatedCredential,
        submittingReply,
        startingPatch,
        connectionLost,
        ...(threadError !== undefined ? { error: threadError } : {}),
      },
      {
        onReply: (message) => {
          void sendReply(message);
        },
        onStartPatch: () => {
          void startPatch();
        },
        onNewFeedback: () => {
          stopPolling();
          active = undefined;
          threadResponse = undefined;
          status = undefined;
          threadError = undefined;
          draft = { message: '', includeConsole: true };
          view = 'panel';
          render();
        },
        onClose: () => close(),
      },
    );
  }

  function ensureDialog(): HTMLElement {
    let dialog = panelHost.querySelector('.pb-panel');
    if (!(dialog instanceof HTMLElement)) {
      clear(panelHost);
      dialog = h('div', {
        className: 'pb-panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-labelledby': 'pb-panel-title',
      });
      panelHost.appendChild(dialog);
    }
    return dialog as HTMLElement;
  }

  function urlPreview(): string | undefined {
    if (capture.url === false) {
      return undefined;
    }
    return sanitizeUrl(window.location.href, {
      includeQuery: capture.url.includeQuery,
    });
  }

  // ----- capture actions (gesture consent) --------------------------------

  async function runPicker(): Promise<PickedElement | undefined> {
    const previousView = view;
    clear(panelHost); // Hide the panel while picking.
    const picked = await pickElementInteractive(root.shadow, root.host, engine);
    view = previousView;
    if (picked !== undefined) {
      draft.element = picked;
    }
    render();
    return picked;
  }

  async function runScreenshot(): Promise<void> {
    // The widget UI is excluded from capture via [data-patchback-widget] +
    // the ignore attribute; hide the panel anyway so the page is unobscured.
    panelHost.style.display = 'none';
    try {
      const { captureScreenshot } = await import('./capture/screenshot.js');
      const result = await captureScreenshot({ engine });
      if (result.ok) {
        draft.screenshot = { dataUri: result.dataUri, masked: result.masked };
        panelError = undefined;
      } else {
        panelError =
          result.reason === 'too_large'
            ? 'Screenshot was too large to attach and was dropped.'
            : 'Screenshot capture failed — you can submit without it.';
      }
    } catch {
      panelError = 'Screenshot capture failed — you can submit without it.';
    } finally {
      panelHost.style.display = '';
      render();
    }
  }

  // ----- submit / thread ---------------------------------------------------

  function previewModel(): CapturePreviewModel {
    return {
      ...(draft.element !== undefined ? { element: draft.element } : {}),
      ...(draft.screenshot !== undefined
        ? { screenshot: draft.screenshot }
        : {}),
      ...(consoleBuffer !== undefined
        ? { consoleEntries: consoleBuffer.entries() }
        : {}),
      includeConsole: draft.includeConsole,
    };
  }

  async function submit(): Promise<void> {
    if (submitting || draft.message.trim() === '') {
      return;
    }
    submitting = true;
    panelError = undefined;
    render();
    try {
      // The payload is built FROM the preview model — single choke point.
      const context = buildCaptureContext(
        capture,
        engine,
        previewModel(),
        environmentFromWindow(window),
      );
      const response = await client.submitFeedback({
        message: draft.message,
        ...(config.submitter !== undefined
          ? { submitter: config.submitter }
          : {}),
        capture: context,
      });
      active = {
        rootId: response.id,
        feedbackId: response.id,
        jobId: response.jobId,
        readToken: response.readToken,
      };
      threads.append(response.id, {
        feedbackId: response.id,
        jobId: response.jobId,
        readToken: response.readToken,
        createdAt: new Date().toISOString(),
      });
      emitter.emit('submitted', {
        feedbackId: response.id,
        jobId: response.jobId,
      });
      draft = { message: '', includeConsole: true };
      view = 'thread';
      render();
      startPolling();
    } catch (error) {
      panelError = 'Could not send feedback. Check your connection and retry.';
      emitter.emit('error', { error });
      render();
    } finally {
      submitting = false;
      if (view === 'panel') {
        render();
      }
    }
  }

  async function refreshThread(): Promise<void> {
    if (active === undefined) {
      return;
    }
    try {
      threadResponse = await client.getFeedback(active.rootId, {
        readToken: rootToken(),
      });
      render();
    } catch {
      // Non-fatal; the status chip still works.
    }
  }

  function rootToken(): string {
    const record = threads.get(active?.rootId ?? '');
    return record?.entries[0]?.readToken ?? active?.readToken ?? '';
  }

  function stopPolling(): void {
    pollAbort?.abort();
    pollAbort = undefined;
  }

  function startPolling(): void {
    if (active === undefined || destroyed) {
      return;
    }
    stopPolling();
    const abort = new AbortController();
    pollAbort = abort;
    const jobId = active.jobId;
    void refreshThread();
    void pollJobStatus(
      client,
      jobId,
      { readToken: active.readToken },
      {
        signal: abort.signal,
        ...(config.polling?.fastMs !== undefined
          ? { fastMs: config.polling.fastMs }
          : {}),
        ...(config.polling?.slowMs !== undefined
          ? { slowMs: config.polling.slowMs }
          : {}),
        onUpdate: (update) => {
          connectionLost = false;
          const changed = status?.state !== update.state;
          status = update;
          if (changed) {
            emitter.emit('statusChange', { jobId, state: update.state });
            // Triage details ride on the feedback item — refresh it when
            // the state moves.
            void refreshThread();
          }
          render();
        },
        onConnectionIssue: () => {
          connectionLost = true;
          render();
        },
      },
    ).catch(() => {
      // Terminal 404/abort — polling ends; the last rendered state stands.
    });
  }

  async function sendReply(message: string): Promise<void> {
    if (active === undefined || submittingReply) {
      return;
    }
    submittingReply = true;
    threadError = undefined;
    render();
    try {
      const response = await client.reply(active.feedbackId, message, {
        readToken: active.readToken,
      });
      threads.append(active.rootId, {
        feedbackId: response.id,
        jobId: response.jobId,
        readToken: response.readToken,
        createdAt: new Date().toISOString(),
      });
      // A reply is a NEW item + job + token; poll the NEW job.
      active = {
        rootId: active.rootId,
        feedbackId: response.id,
        jobId: response.jobId,
        readToken: response.readToken,
      };
      status = undefined;
      startPolling();
    } catch (error) {
      threadError = 'Could not send the reply. Try again.';
      emitter.emit('error', { error });
    } finally {
      submittingReply = false;
      render();
    }
  }

  async function startPatch(): Promise<void> {
    if (active === undefined || startingPatch) {
      return;
    }
    startingPatch = true;
    threadError = undefined;
    render();
    try {
      await client.startJob(active.jobId);
      startPolling(); // Pick up the new state promptly.
    } catch (error) {
      threadError = 'The server declined to start a patch job.';
      emitter.emit('error', { error });
    } finally {
      startingPatch = false;
      render();
    }
  }

  // ----- visibility-aware polling -----------------------------------------

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      stopPolling();
    } else if (view === 'thread' && active !== undefined) {
      startPolling();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ----- public API ---------------------------------------------------------

  function open(): void {
    if (destroyed || view !== 'closed') {
      return;
    }
    view = active !== undefined ? 'thread' : 'panel';
    render();
    if (view === 'thread') {
      startPolling();
    }
  }

  function close(): void {
    if (view === 'closed') {
      return;
    }
    view = 'closed';
    stopPolling();
    render();
  }

  function toggle(): void {
    if (view === 'closed') {
      open();
    } else {
      close();
    }
  }

  return {
    open,
    close,
    toggle,
    async pickElement(): Promise<PickedElement | undefined> {
      return runPicker();
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
      consoleBuffer?.uninstall();
      emitter.clear();
      root.destroy();
    },
    on(event, listener) {
      return emitter.on(event, listener);
    },
  };
}
