import type { PickedElement } from '@patchback/types';

import { buildDomPath } from '../dom/path.js';
import type { MaskingEngine } from '../masking/engine.js';
import { h } from './dom.js';

/**
 * Element picker — per-use GESTURE consent: nothing is captured until the
 * user explicitly clicks a target, and the result lands in the "What will
 * be sent" preview before anything is submitted.
 *
 * - Renders a full-viewport overlay INSIDE the widget shadow root; the
 *   page DOM is never mutated (a widget that dirties the page it reports
 *   on taints its own captures).
 * - Ignored elements (masking policy) show a struck-through "excluded"
 *   highlight and cannot be picked.
 * - Escape cancels; the overlay traps the confirming click.
 */
export function pickElementInteractive(
  shadow: ShadowRoot,
  host: HTMLElement,
  engine: MaskingEngine,
): Promise<PickedElement | undefined> {
  return new Promise((resolve) => {
    const doc = host.ownerDocument;
    const overlay = h('div', {
      className: 'pb-picker-overlay',
      role: 'application',
      'aria-label':
        'Element picker: move to highlight, click to select, Escape to cancel',
    });
    const box = h('div', { className: 'pb-picker-box' });
    const label = h('div', { className: 'pb-picker-label' });
    const live = h('div', {
      className: 'pb-visually-hidden',
      'aria-live': 'polite',
    });
    live.textContent =
      'Picking an element. Move the pointer and click to select. Press Escape to cancel.';
    box.style.display = 'none';
    label.style.display = 'none';
    overlay.append(box, label, live);
    shadow.appendChild(overlay);

    let candidate: Element | undefined;
    let candidateExcluded = false;

    function candidateAt(x: number, y: number): Element | undefined {
      const stack = doc.elementsFromPoint(x, y);
      for (let el of stack) {
        if (el === host || host.contains(el)) {
          continue;
        }
        // Descend into open shadow roots where possible.
        while (el.shadowRoot !== null) {
          const inner = el.shadowRoot
            .elementsFromPoint(x, y)
            .find((n) => n !== el);
          if (inner === undefined || inner === el) {
            break;
          }
          el = inner;
        }
        if (el === doc.documentElement || el === doc.body) {
          return undefined;
        }
        return el;
      }
      return undefined;
    }

    function onMove(event: PointerEvent): void {
      const el = candidateAt(event.clientX, event.clientY);
      candidate = el;
      if (el === undefined) {
        box.style.display = 'none';
        label.style.display = 'none';
        return;
      }
      candidateExcluded = engine.classify(el) === 'ignored';
      const rect = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      if (candidateExcluded) {
        box.setAttribute('data-excluded', '');
      } else {
        box.removeAttribute('data-excluded');
      }
      label.style.display = 'block';
      label.style.left = `${Math.max(rect.left, 4)}px`;
      label.style.top = `${Math.max(rect.top - 4, 18)}px`;
      label.textContent = candidateExcluded
        ? 'excluded from capture'
        : `<${el.tagName.toLowerCase()}> ${engine.maskedTextOf(el).slice(0, 60)}`;
    }

    function finish(result: PickedElement | undefined): void {
      doc.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    }

    function onClick(event: MouseEvent): void {
      event.preventDefault();
      event.stopPropagation();
      if (candidate === undefined || candidateExcluded) {
        return; // No-op on excluded/empty — stay in picking mode.
      }
      const el = candidate;
      const text = engine.maskedTextOf(el).slice(0, 2000);
      const picked: PickedElement = {
        domPath: buildDomPath(el),
        tagName: el.tagName.toLowerCase(),
        ...(text !== '' ? { text } : {}),
      };
      finish(picked);
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(undefined);
      }
    }

    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKey, true);
  });
}
