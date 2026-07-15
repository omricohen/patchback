import { classifyElement, type ResolvedMaskingConfig } from './policy.js';

/** Viewport-space redaction box (CSS pixels). */
export interface RedactionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollectRectsOptions {
  /** Injectable rect reader — jsdom reports zero rects, tests inject real ones. */
  getRect?: (el: Element) => Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
  /** Viewport to clip against. Defaults to the document's window size. */
  viewport?: { width: number; height: number };
}

/**
 * Raster-stage redaction geometry — the input to LAYER 2.
 *
 * Snapshots the viewport-space boxes of every masked/ignored element from
 * the LIVE document, before any cloning, in the same synchronous frame as
 * the capture. Painted over the canvas after rasterization, these rects
 * cover pixels even if a renderer quirk ever bypasses the clone-stage
 * layer.
 */
export function collectRedactionRects(
  root: Document | ShadowRoot,
  config: ResolvedMaskingConfig,
  options: CollectRectsOptions = {},
): RedactionRect[] {
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  const win = doc?.defaultView ?? undefined;
  const viewport = options.viewport ?? {
    width: win?.innerWidth ?? 0,
    height: win?.innerHeight ?? 0,
  };
  const getRect =
    options.getRect ?? ((el: Element) => el.getBoundingClientRect());

  const rects: RedactionRect[] = [];
  walk(root, config, getRect, viewport, rects);
  return rects;
}

function walk(
  root: Document | ShadowRoot | Element,
  config: ResolvedMaskingConfig,
  getRect: NonNullable<CollectRectsOptions['getRect']>,
  viewport: { width: number; height: number },
  out: RedactionRect[],
): void {
  const children =
    root.nodeType === 1
      ? Array.from((root as Element).children)
      : Array.from((root as Document | ShadowRoot).children);
  for (const el of children) {
    const classification = classifyElement(el, config);
    if (classification !== 'visible') {
      const rect = clip(getRect(el), viewport);
      if (rect !== undefined) {
        out.push(rect);
      }
    }
    walk(el, config, getRect, viewport, out);
    if (el.shadowRoot !== null) {
      walk(el.shadowRoot, config, getRect, viewport, out);
    }
  }
}

function clip(
  rect: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>,
  viewport: { width: number; height: number },
): RedactionRect | undefined {
  const x0 = Math.max(rect.x, 0);
  const y0 = Math.max(rect.y, 0);
  const x1 = Math.min(rect.x + rect.width, viewport.width);
  const y1 = Math.min(rect.y + rect.height, viewport.height);
  if (x1 <= x0 || y1 <= y0) {
    return undefined;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
