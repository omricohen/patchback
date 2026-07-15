import {
  classifyElement,
  type ResolvedMaskingConfig,
} from './policy.js';
import { scrubText } from './scrub.js';

/** Placeholder that replaces a masked element's text in picker captures. */
export const MASKED_PLACEHOLDER = '[masked]';

const MAX_WALK_CHARS = 8000;

/**
 * Visible text of an element with masking applied: masked descendants are
 * replaced by {@link MASKED_PLACEHOLDER}, ignored subtrees are dropped, and
 * the result is scrubbed (when `scrubText` is on) and whitespace-normalized.
 *
 * Form-field VALUES are never read here at all — input/textarea values are
 * not text nodes — so even an unmasked input contributes only its markup
 * text (e.g. option labels), never what the user typed.
 */
export function maskedTextOf(
  el: Element,
  config: ResolvedMaskingConfig,
): string {
  const parts: string[] = [];
  collect(el, config, parts);
  let text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (config.scrubText) {
    text = scrubText(text);
  }
  return text;
}

function collect(
  el: Element,
  config: ResolvedMaskingConfig,
  parts: string[],
): void {
  if (totalLength(parts) > MAX_WALK_CHARS) {
    return;
  }
  const classification = classifyElement(el, config);
  if (classification === 'ignored') {
    return;
  }
  if (classification === 'masked') {
    parts.push(MASKED_PLACEHOLDER);
    return;
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      const text = child.textContent;
      if (text !== null && text.trim() !== '') {
        parts.push(text);
      }
    } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
      collect(child as Element, config, parts);
    }
  }
}

function totalLength(parts: string[]): number {
  let n = 0;
  for (const part of parts) {
    n += part.length;
  }
  return n;
}
