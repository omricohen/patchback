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
 * What gets stripped per element, by classification:
 * - masked: form-field values; direct text nodes (same-length filler);
 *   and ALL replaced/graphic content — img/source src+srcset, canvas
 *   buffers, svg children, video/audio sources and posters, plus inline
 *   `background-image`/`border-image`/`mask-image` set to none with
 *   !important (a masked box must not leak through pixels any more than
 *   through text).
 * - ignored: the subtree is emptied AND the element's OWN value, media
 *   attributes, and background images are stripped — an ignored <img> or
 *   a background-image card has no children to remove; the leak is the
 *   element itself.
 *
 * Unmasked descendants of a masked container (nearest-marker semantics)
 * are left intact — they classify 'visible' and are simply not touched.
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
    stripVisualContent(el);
    return;
  }
  if (classification === 'masked') {
    stripValue(el);
    stripVisualContent(el);
    if (!isFormField(el)) {
      blankDirectTextNodes(el);
    }
    // Keep walking: descendants classify individually — masked ones get
    // the same treatment, unmask-marked ones stay visible, ignored ones
    // are emptied.
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

/**
 * Strip replaced/graphic content that text blanking cannot reach: images,
 * canvas buffers, inline SVG, media elements, and CSS image sources.
 */
function stripVisualContent(el: Element): void {
  const tag = el.tagName.toUpperCase();
  if (tag === 'IMG') {
    // src/srcset are attribute-reflected — removing the attributes fully
    // clears the effective source on the detached clone.
    el.removeAttribute('src');
    el.removeAttribute('srcset');
    el.removeAttribute('data-src');
    el.removeAttribute('data-srcset');
  } else if (tag === 'SOURCE') {
    el.removeAttribute('src');
    el.removeAttribute('srcset');
  } else if (tag === 'VIDEO' || tag === 'AUDIO') {
    el.removeAttribute('src');
    el.removeAttribute('poster');
    empty(el); // <source>/<track> children.
  } else if (tag === 'CANVAS') {
    // A same-size write resets the buffer; renderers that inlined the
    // source canvas's pixels as a background are covered by the CSS
    // stripping below.
    const canvas = el as HTMLCanvasElement;
    try {
      const width = canvas.width;
      canvas.width = width;
    } catch {
      el.setAttribute('width', el.getAttribute('width') ?? '0');
    }
  } else if (tag === 'SVG') {
    empty(el);
  } else if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
    el.removeAttribute('src');
    el.removeAttribute('srcdoc');
    el.removeAttribute('data');
  }

  // CSS image sources — inline with !important so they beat whatever
  // style pipeline the renderer serializes (class CSS or style attrs).
  const style = (el as HTMLElement | SVGElement).style;
  if (style !== undefined && typeof style.setProperty === 'function') {
    style.setProperty('background-image', 'none', 'important');
    style.setProperty('border-image-source', 'none', 'important');
    style.setProperty('mask-image', 'none', 'important');
    style.setProperty('-webkit-mask-image', 'none', 'important');
    style.setProperty('list-style-image', 'none', 'important');
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
  for (
    let node = walkerRoot.nextNode();
    node !== null;
    node = walkerRoot.nextNode()
  ) {
    texts.push(node);
  }
  for (const node of texts) {
    node.textContent = maskFiller(node.textContent ?? '');
  }
}

/**
 * Blank only the element's DIRECT text nodes — descendants are classified
 * and handled individually by the main walk (so unmasked children keep
 * their text).
 */
function blankDirectTextNodes(el: Element): void {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      child.textContent = maskFiller(child.textContent ?? '');
    }
  }
}

function empty(el: Element): void {
  while (el.firstChild !== null) {
    el.removeChild(el.firstChild);
  }
}
