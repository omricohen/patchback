/**
 * Masking policy — pure DOM-in/data-out classification. Every capture path
 * (picker text, screenshots, page fields) MUST consume this module; it is
 * built and tested before any capture feature exists.
 *
 * Two distinct verbs, deliberately not conflated:
 *
 * - **masked** — the element EXISTS in capture but its content is replaced.
 *   Geometry preserved; `domPath`/`tagName` still captured (structure is not
 *   content).
 * - **ignored** — the subtree is ABSENT from capture. The picker refuses to
 *   select inside it; its text is never captured; its full bounding box is
 *   painted over in screenshots.
 */

export type MaskClassification = 'visible' | 'masked' | 'ignored';

export interface MaskingConfig {
  /** Default TRUE — all form-field VALUES are masked. */
  maskInputs?: boolean;
  /** Additional always-masked elements. */
  maskSelectors?: string[];
  /**
   * Opt specific elements back in. CANNOT reach the hard floor
   * (passwords, credit-card fields, one-time codes, hidden inputs).
   */
  unmaskSelectors?: string[];
  /** Subtrees fully EXCLUDED from all capture. */
  ignoreSelectors?: string[];
  /** Default TRUE — email/secret scrub of captured text (never the user's own message). */
  scrubText?: boolean;
}

export interface ResolvedMaskingConfig {
  maskInputs: boolean;
  maskSelectors: readonly string[];
  unmaskSelectors: readonly string[];
  ignoreSelectors: readonly string[];
  scrubText: boolean;
}

/** Markup-level controls — work with zero config, closest-ancestor semantics. */
export const MASK_ATTR = 'data-patchback-mask';
export const UNMASK_ATTR = 'data-patchback-unmask';
export const IGNORE_ATTR = 'data-patchback-ignore';

/**
 * Autocomplete tokens on the non-overridable hard floor. `cc-exp` is a
 * prefix family (cc-exp, cc-exp-month, cc-exp-year).
 */
const HARD_FLOOR_AUTOCOMPLETE = new Set([
  'cc-number',
  'cc-csc',
  'one-time-code',
  'current-password',
  'new-password',
]);

export class MaskingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaskingConfigError';
  }
}

/**
 * Resolve + validate a masking config. Invalid selectors throw at widget
 * init — loud, never silently unprotected.
 */
export function resolveMaskingConfig(
  config: MaskingConfig = {},
): ResolvedMaskingConfig {
  const resolved: ResolvedMaskingConfig = {
    maskInputs: config.maskInputs ?? true,
    maskSelectors: [...(config.maskSelectors ?? [])],
    unmaskSelectors: [...(config.unmaskSelectors ?? [])],
    ignoreSelectors: [...(config.ignoreSelectors ?? [])],
    scrubText: config.scrubText ?? true,
  };
  for (const [key, selectors] of [
    ['maskSelectors', resolved.maskSelectors],
    ['unmaskSelectors', resolved.unmaskSelectors],
    ['ignoreSelectors', resolved.ignoreSelectors],
  ] as const) {
    for (const selector of selectors) {
      if (!isValidSelector(selector)) {
        throw new MaskingConfigError(
          `masking.${key}: ${JSON.stringify(selector)} is not a valid CSS selector`,
        );
      }
    }
  }
  return resolved;
}

function isValidSelector(selector: string): boolean {
  if (typeof selector !== 'string' || selector.trim() === '') {
    return false;
  }
  try {
    // Any element works as a probe; matches() throws on invalid syntax.
    globalThis.document.createElement('div').matches(selector);
    return true;
  } catch {
    return false;
  }
}

/** matches() that treats a (config-validated) selector defensively. */
function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

function matchesAny(el: Element, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    if (safeMatches(el, selector)) {
      return true;
    }
  }
  return false;
}

/**
 * Parent in the flat tree: crosses OPEN shadow boundaries so a marker on a
 * shadow host governs its shadow content too.
 */
export function flatTreeParent(el: Element): Element | null {
  if (el.parentElement !== null) {
    return el.parentElement;
  }
  const root = el.getRootNode();
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
    return root.host;
  }
  return null;
}

/** Form fields whose VALUES are masked when `maskInputs` is on. */
export function isFormField(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  const editable = el.getAttribute('contenteditable');
  return editable !== null && editable.toLowerCase() !== 'false';
}

/**
 * The non-overridable hard floor: password/hidden inputs and credit-card /
 * one-time-code / password autocomplete fields are ALWAYS masked. No config
 * flag, unmask selector, or markup attribute can reach them.
 */
export function matchesHardFloor(el: Element): boolean {
  const autocomplete = el.getAttribute('autocomplete');
  if (autocomplete !== null) {
    for (const token of autocomplete.trim().toLowerCase().split(/\s+/)) {
      if (HARD_FLOOR_AUTOCOMPLETE.has(token) || token.startsWith('cc-exp')) {
        return true;
      }
    }
  }
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').trim().toLowerCase();
    if (type === 'password' || type === 'hidden') {
      return true;
    }
  }
  return false;
}

/**
 * A cross-origin iframe is uninspectable — fail closed: treat as ignored
 * (opaque box in screenshots, unpickable). Detached clones also report a
 * null contentDocument, which errs on the safe side.
 */
export function isCrossOriginIframe(el: Element): boolean {
  if (el.tagName !== 'IFRAME') {
    return false;
  }
  try {
    return (el as HTMLIFrameElement).contentDocument === null;
  } catch {
    return true;
  }
}

/**
 * Classify one element. Resolution rules, in order:
 *
 * 1. `ignore` beats everything on its subtree (any ancestor-or-self marker
 *    or configured selector). Cross-origin iframes are always ignored.
 * 2. The hard floor (self or ancestor) is always masked — unmask sources
 *    cannot reach it.
 * 3. Explicit markers: walking from the element upward, the NEAREST node
 *    carrying a mask or unmask source decides; if one node carries both,
 *    mask wins.
 * 4. No explicit marker: `maskInputs` (default true) masks form-field
 *    values; everything else is visible.
 */
export function classifyElement(
  el: Element,
  config: ResolvedMaskingConfig,
): MaskClassification {
  for (let node: Element | null = el; node !== null; node = flatTreeParent(node)) {
    if (
      node.hasAttribute(IGNORE_ATTR) ||
      matchesAny(node, config.ignoreSelectors)
    ) {
      return 'ignored';
    }
  }
  if (isCrossOriginIframe(el)) {
    return 'ignored';
  }
  for (let node: Element | null = el; node !== null; node = flatTreeParent(node)) {
    if (matchesHardFloor(node)) {
      return 'masked';
    }
  }
  for (let node: Element | null = el; node !== null; node = flatTreeParent(node)) {
    const mask =
      node.hasAttribute(MASK_ATTR) || matchesAny(node, config.maskSelectors);
    if (mask) {
      return 'masked';
    }
    const unmask =
      node.hasAttribute(UNMASK_ATTR) ||
      matchesAny(node, config.unmaskSelectors);
    if (unmask) {
      return 'visible';
    }
  }
  if (config.maskInputs && isFormField(el)) {
    return 'masked';
  }
  return 'visible';
}
