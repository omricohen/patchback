/**
 * DOM path builder — the most-specific STABLE selector for a picked
 * element. This string is what triage and the agent brief lean on, so it
 * prefers human-meaningful anchors and rejects generated-looking ids.
 *
 * Order of preference:
 * 1. unique `#id` (unless it looks generated)
 * 2. unique `[data-testid="…"]`
 * 3. ancestor chain of `tag:nth-of-type()` segments from the nearest stable
 *    anchor (or the root), `>`-joined.
 *
 * Pure function; capped at 2000 chars (the server schema's limit).
 */

export const DOM_PATH_MAX_CHARS = 2000;

export function buildDomPath(el: Element): string {
  const doc = el.ownerDocument;
  const own = ownSelector(el, doc);
  if (own !== undefined) {
    return cap(own);
  }

  const segments: string[] = [segmentFor(el)];
  let node: Element | null = el.parentElement;
  while (node !== null && node !== doc.documentElement) {
    const anchor = ownSelector(node, doc);
    if (anchor !== undefined) {
      segments.unshift(anchor);
      return cap(segments.join(' > '));
    }
    segments.unshift(segmentFor(node));
    node = node.parentElement;
  }
  if (node !== null) {
    segments.unshift('html');
  }
  return cap(segments.join(' > '));
}

/** A selector that identifies this element uniquely on its own, if any. */
function ownSelector(el: Element, doc: Document): string | undefined {
  const id = el.getAttribute('id');
  if (id !== null && id !== '' && !looksGenerated(id) && isSimpleId(id)) {
    const selector = `#${cssEscape(id)}`;
    if (isUnique(doc, selector, el)) {
      return selector;
    }
  }
  const testId = el.getAttribute('data-testid');
  if (testId !== null && testId !== '' && !testId.includes('"')) {
    const selector = `[data-testid="${testId}"]`;
    if (isUnique(doc, selector, el)) {
      return selector;
    }
  }
  return undefined;
}

function isUnique(doc: Document, selector: string, el: Element): boolean {
  try {
    const matches = doc.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

/**
 * Generated-looking ids make brittle selectors: uuid-ish, long trailing
 * digit runs, or framework-generated (`:r1:`-style React useId, radix).
 */
export function looksGenerated(id: string): boolean {
  if (/\d{8,}$/.test(id)) {
    return true;
  }
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(id)) {
    return true;
  }
  if (/^:.*:$/.test(id) || /^radix-/.test(id)) {
    return true;
  }
  // Long hex/base36 hash-looking tails, e.g. "button-3f9a2c7d1b".
  if (/[-_][0-9a-f]{8,}$/i.test(id)) {
    return true;
  }
  return false;
}

function isSimpleId(id: string): boolean {
  return !/\s/.test(id);
}

function segmentFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (parent === null) {
    return tag;
  }
  const sameTag = Array.from(parent.children).filter(
    (child) => child.tagName === el.tagName,
  );
  if (sameTag.length <= 1) {
    return tag;
  }
  const index = sameTag.indexOf(el) + 1;
  return `${tag}:nth-of-type(${index})`;
}

function cap(path: string): string {
  return path.length <= DOM_PATH_MAX_CHARS
    ? path
    : path.slice(0, DOM_PATH_MAX_CHARS);
}

function cssEscape(value: string): string {
  const impl = (globalThis as { CSS?: { escape?: (v: string) => string } })
    .CSS?.escape;
  if (typeof impl === 'function') {
    return impl(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
