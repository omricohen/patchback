import type { ConsoleEntry, PickedElement } from '@patchback/types';

import type { ResolvedCaptureConfig } from '../config.js';
import { h, clear } from './dom.js';

/**
 * The feedback panel: message box, capture actions, and the "What will be
 * sent" preview. STRUCTURAL transparency: the preview enumerates every
 * capture field with its actual post-masking value, each optional item has
 * a remove control, and the submit payload is assembled FROM this model —
 * the preview cannot lie.
 */
export interface PanelDraft {
  message: string;
  element?: PickedElement;
  screenshot?: { dataUri: string; masked: boolean };
  includeConsole: boolean;
}

export interface PanelState {
  draft: PanelDraft;
  capture: ResolvedCaptureConfig;
  /** Post-masking URL exactly as it will be sent (undefined = not sent). */
  urlPreview?: string;
  consoleEntries: ConsoleEntry[];
  submitting: boolean;
  error?: string;
}

export interface PanelActions {
  onMessageInput(message: string): void;
  onPick(): void;
  onScreenshot(): void;
  onRemoveElement(): void;
  onRemoveScreenshot(): void;
  onToggleConsole(include: boolean): void;
  onSubmit(): void;
  onClose(): void;
}

export function renderPanel(
  container: HTMLElement,
  state: PanelState,
  actions: PanelActions,
): void {
  clear(container);
  const { draft, capture } = state;

  const heading = h('h2', { id: 'pb-panel-title' }, ['Send feedback']);

  const textarea = h('textarea', {
    'aria-label': 'Feedback message',
    placeholder: 'What should change?',
  });
  textarea.value = draft.message;
  textarea.addEventListener('input', () => {
    actions.onMessageInput(textarea.value);
  });

  const actionsRow = h('div', { className: 'pb-row' });
  if (capture.elementPicker) {
    const pick = h('button', { className: 'pb-btn', type: 'button' }, [
      draft.element === undefined
        ? 'Point at the problem'
        : 'Pick a different element',
    ]);
    pick.addEventListener('click', () => actions.onPick());
    actionsRow.append(pick);
  }
  if (capture.screenshot) {
    const shot = h('button', { className: 'pb-btn', type: 'button' }, [
      draft.screenshot === undefined
        ? 'Attach screenshot'
        : 'Retake screenshot',
    ]);
    shot.addEventListener('click', () => actions.onScreenshot());
    actionsRow.append(shot);
  }

  const preview = renderPreview(state, actions);

  const submit = h(
    'button',
    {
      className: 'pb-btn pb-btn-primary',
      type: 'button',
      disabled: state.submitting || draft.message.trim() === '',
    },
    [state.submitting ? 'Sending…' : 'Send feedback'],
  );
  submit.addEventListener('click', () => actions.onSubmit());

  const close = h(
    'button',
    { className: 'pb-btn', type: 'button', 'aria-label': 'Close panel' },
    ['Close'],
  );
  close.addEventListener('click', () => actions.onClose());

  const footer = h('div', { className: 'pb-row' }, [submit, close]);

  const children: Array<HTMLElement | undefined> = [
    heading,
    textarea,
    actionsRow,
    preview,
    state.error !== undefined
      ? h('div', { className: 'pb-error', role: 'alert' }, [state.error])
      : undefined,
    footer,
  ];
  container.append(...children.filter((c) => c !== undefined));
}

function renderPreview(state: PanelState, actions: PanelActions): HTMLElement {
  const { draft, capture } = state;
  const items: HTMLElement[] = [];

  // The message itself, so "what will be sent" is complete.
  items.push(
    h('li', {}, [
      h('span', { className: 'pb-field' }, ['Message:']),
      h('span', {}, [
        draft.message.trim() === '' ? '(empty)' : truncate(draft.message, 120),
      ]),
    ]),
  );

  if (state.urlPreview !== undefined) {
    items.push(
      h('li', {}, [
        h('span', { className: 'pb-field' }, ['Page URL:']),
        h('span', {}, [state.urlPreview]),
      ]),
    );
  }

  if (draft.element !== undefined) {
    const remove = h(
      'button',
      {
        className: 'pb-remove',
        type: 'button',
        'aria-label': 'Remove picked element',
      },
      ['✕'],
    );
    remove.addEventListener('click', () => actions.onRemoveElement());
    items.push(
      h('li', { 'data-preview': 'element' }, [
        h('span', { className: 'pb-field' }, ['Element:']),
        h('span', {}, [
          `<${draft.element.tagName ?? '?'}> ${truncate(draft.element.text ?? draft.element.domPath, 80)}`,
          ...(draft.element.sourceHint !== undefined
            ? [
                h('div', { className: 'pb-muted', 'data-preview-source': '' }, [
                  `source: ${truncate(draft.element.sourceHint, 80)}`,
                ]),
              ]
            : []),
        ]),
        remove,
      ]),
    );
  }

  if (draft.screenshot !== undefined) {
    const remove = h(
      'button',
      {
        className: 'pb-remove',
        type: 'button',
        'aria-label': 'Remove screenshot',
      },
      ['✕'],
    );
    remove.addEventListener('click', () => actions.onRemoveScreenshot());
    const img = h('img', {
      src: draft.screenshot.dataUri,
      alt: 'Screenshot preview (after redaction)',
    });
    items.push(
      h('li', { 'data-preview': 'screenshot' }, [
        h('span', { className: 'pb-field' }, ['Screenshot:']),
        h('div', {}, [
          img,
          h('div', { className: 'pb-muted' }, ['masked before capture']),
        ]),
        remove,
      ]),
    );
  }

  if (capture.console !== false && state.consoleEntries.length > 0) {
    const checkbox = h('input', {
      type: 'checkbox',
      id: 'pb-include-console',
    }) as HTMLInputElement;
    checkbox.checked = draft.includeConsole;
    checkbox.addEventListener('change', () =>
      actions.onToggleConsole(checkbox.checked),
    );
    const toggle = h('button', { className: 'pb-btn-link', type: 'button' }, [
      'show',
    ]);
    const list = h('div', { className: 'pb-console-list' });
    list.style.display = 'none';
    for (const entry of state.consoleEntries) {
      list.append(
        h('div', {}, [`[${entry.level}] ${truncate(entry.message, 160)}`]),
      );
    }
    toggle.addEventListener('click', () => {
      const hidden = list.style.display === 'none';
      list.style.display = hidden ? 'block' : 'none';
      toggle.textContent = hidden ? 'hide' : 'show';
    });
    items.push(
      h('li', { 'data-preview': 'console' }, [
        checkbox,
        h('label', { for: 'pb-include-console' }, [
          `Include recent errors (${state.consoleEntries.length})`,
        ]),
        toggle,
      ]),
      h('li', {}, [list]),
    );
  }

  return h('div', { className: 'pb-preview' }, [
    h('h3', {}, ['What will be sent']),
    h('ul', {}, items),
  ]);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
