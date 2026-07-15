import {
  classifyElement,
  isFormField,
  type ResolvedMaskingConfig,
} from './policy.js';

/**
 * Clone-stage (semantic) screenshot redaction — LAYER 1 of two.
 *
 * Runs on the renderer's detached clone BEFORE rasterization, so masked
 * content never exists in the serialized SVG at all: nothing to "paint
 * over" can leak via anti-aliasing, scroll bleed, or partial rects.
 *
 * The clone preserves the source's attributes and structure, so the same
 * masking policy classifies clone elements directly. A detached clone's
 * iframes report null contentDocument → classified ignored → emptied
 * (fail-closed for the uninspectable).
 */
export function applyMaskingToClone(
  cloneRoot: Element,
  config: ResolvedMaskingConfig,
): void {
  visit(cloneRoot, config);
}

function visit(el: Element, config: ResolvedMaskingConfig): void {
  const classification = classifyElement(el, config);
  if (classification === 'ignored') {
    empty(el);
    stripValue(el);
    return;
  }
  if (classification === 'masked') {
    stripValue(el);
    if (!isFormField(el)) {
      blankTextNodes(el, config);
    }
    // Descendants of a masked element still need value-stripping (e.g. a
    // masked <form> containing inputs) — keep walking.
  }
  for (const child of Array.from(el.children)) {
    visit(child, config);
  }
  if (el.shadowRoot !== null) {
    for (const child of Array.from(el.shadowRoot.children)) {
      visit(child, config);
    }
  }
}

/** Remove every trace of a form field's value from the clone. */
function stripValue(el: Element): void {
  if (el.tagName === 'INPUT') {
    el.removeAttribute('value');
    el.removeAttribute('checked');
    (el as HTMLInputElement).value = '';
    (el as HTMLInputElement).checked = false;
    return;
  }
  if (el.tagName === 'TEXTAREA') {
    el.textContent = '';
    (el as HTMLTextAreaElement).value = '';
    return;
  }
  if (el.tagName === 'SELECT') {
    // Option labels are page content and may identify the selection; blank
    // them all and clear selection state.
    for (const option of Array.from(el.querySelectorAll('option'))) {
      option.removeAttribute('selected');
      option.selected = false;
      option.textContent = maskFiller(option.textContent ?? '');
    }
    return;
  }
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && editable.toLowerCase() !== 'false') {
    blankAllText(el);
  }
}

/** Replace text with same-length bullet filler — geometry preserved, content gone. */
function maskFiller(text: string): string {
  return text.replace(/\S/g, '•');
}

function blankAllText(el: Element): void {
  const walkerRoot = el.ownerDocument?.createTreeWalker
    ? el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */)
    : null;
  if (walkerRoot === null) {
    el.textContent = maskFiller(el.textContent ?? '');
    return;
  }
  const texts: Node[] = [];
  for (let node = walkerRoot.nextNode(); node !== null; node = walkerRoot.nextNode()) {
    texts.push(node);
  }
  for (const node of texts) {
    node.textContent = maskFiller(node.textContent ?? '');
  }
}

/**
 * Blank the text of a masked element, but leave any UNMASKED descendant
 * subtrees intact (nearest-marker semantics: a data-patchback-unmask child
 * inside a masked container stays visible).
 */
function blankTextNodes(el: Element, config: ResolvedMaskingConfig): void {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      child.textContent = maskFiller(child.textContent ?? '');
    } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const childEl = child as Element;
      if (classifyElement(childEl, config) === 'masked') {
        blankTextNodes(childEl, config);
      }
    }
  }
}

function empty(el: Element): void {
  while (el.firstChild !== null) {
    el.removeChild(el.firstChild);
  }
}
