import type { MaskingEngine } from '../masking/engine.js';
import { paintRedactions } from './redact.js';

/**
 * Screenshot capture: DOM rasterization with masking applied BEFORE pixels
 * exist (clone-stage layer 1) plus geometric rect painting after (raster-
 * stage layer 2), then a drop-not-violate size ladder against the server's
 * 512 KiB data-URI cap.
 *
 * GEOMETRY CONTRACT (the scroll bug this encodes against): DOM renderers
 * raster the FULL element box — for `doc.body` that is the whole document,
 * not the viewport — while redaction rects are measured in VIEWPORT space.
 * The raster is therefore cropped to the visible viewport first (using the
 * live body rect, whose x/y already encode scroll and margins, and a scale
 * derived from canvas-px per CSS-px, which also absorbs devicePixelRatio).
 * Only then are the viewport-space rects painted, so they land on the
 * right pixels at ANY scroll position. The shipped screenshot is "what the
 * user saw", which is also what the panel previews.
 *
 * The renderer is a seam: the snapdom adapter (`screenshot-snapdom.ts`) is
 * the ONLY file that imports the vendor library, lazily. Tests inject a
 * fake renderer; a future pixel-true mode can slot in without touching
 * redaction.
 */
export interface ScreenshotRenderOptions {
  /**
   * LAYER 1 hook: called with the renderer's detached clone before
   * serialization. The engine strips masked values/text here.
   */
  onClone: (cloneRoot: Element) => void;
  /** Selector for subtrees the renderer must exclude (the widget itself). */
  excludeSelectors?: readonly string[];
  scale?: number;
}

export interface ScreenshotRenderer {
  render(
    target: Element,
    options: ScreenshotRenderOptions,
  ): Promise<HTMLCanvasElement>;
}

export interface CaptureScreenshotOptions {
  engine: MaskingEngine;
  /** Injected renderer (tests/pixel-true mode); default = lazy snapdom. */
  renderer?: ScreenshotRenderer;
  document?: Document;
  /** Data-URI byte cap; default 512 KiB (the server schema's limit). */
  maxChars?: number;
  /** Max output width in px before encoding. Default 1568. */
  maxWidth?: number;
  /** Injectable rect reader for tests. */
  getRect?: (el: Element) => Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
  /** Injectable body-rect reader for tests (viewport-space). */
  getBodyRect?: () => Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
}

export type ScreenshotResult =
  | { ok: true; dataUri: string; masked: true }
  | { ok: false; reason: 'render_failed' | 'too_large' };

export const SCREENSHOT_MAX_CHARS = 524288;
export const SCREENSHOT_MAX_WIDTH = 1568;

/** Encode ladder: step down until the data URI fits, else DROP. */
const ENCODE_LADDER: ReadonlyArray<{ type: string; quality: number }> = [
  { type: 'image/webp', quality: 0.82 },
  { type: 'image/webp', quality: 0.6 },
  { type: 'image/webp', quality: 0.4 },
  { type: 'image/jpeg', quality: 0.7 },
  { type: 'image/jpeg', quality: 0.5 },
  { type: 'image/jpeg', quality: 0.3 },
];

export async function captureScreenshot(
  options: CaptureScreenshotOptions,
): Promise<ScreenshotResult> {
  const doc = options.document ?? document;
  const engine = options.engine;
  const maxChars = options.maxChars ?? SCREENSHOT_MAX_CHARS;
  const maxWidth = options.maxWidth ?? SCREENSHOT_MAX_WIDTH;
  const renderer = options.renderer ?? (await loadDefaultRenderer());

  // ALL live-DOM geometry is measured BEFORE rendering, in one synchronous
  // frame: renderers may mutate the page mid-capture (snapdom scrolls the
  // document to the top to raster the full element) — geometry read after
  // the render describes a different world.
  const win = doc.defaultView;
  const viewport = {
    width: win?.innerWidth ?? 0,
    height: win?.innerHeight ?? 0,
  };
  const bodyRect =
    options.getBodyRect !== undefined
      ? options.getBodyRect()
      : doc.body.getBoundingClientRect();
  const scrollX = win?.scrollX ?? 0;
  const scrollY = win?.scrollY ?? 0;

  // LAYER 2 geometry: viewport-space rects from the LIVE document, before
  // any cloning.
  const rects = engine.collectRedactionRects(doc, {
    ...(options.getRect !== undefined ? { getRect: options.getRect } : {}),
  });

  let canvas: HTMLCanvasElement;
  try {
    canvas = await renderer.render(doc.body, {
      onClone: (cloneRoot) => engine.applyToClone(cloneRoot),
      excludeSelectors: ['[data-patchback-widget]'],
    });
  } catch {
    return { ok: false, reason: 'render_failed' };
  } finally {
    // snapdom leaves the document scrolled to the top — put the user back
    // where they were.
    if (win !== null && win !== undefined) {
      if (win.scrollX !== scrollX || win.scrollY !== scrollY) {
        win.scrollTo(scrollX, scrollY);
      }
    }
  }

  // Crop the full-document raster to the viewport so viewport-space rects
  // land on the right pixels at any scroll position.
  const crop = computeViewportCrop(
    canvas.width,
    canvas.height,
    bodyRect,
    viewport,
  );

  let view = canvas;
  // canvas-px per CSS-px (absorbs devicePixelRatio); fallback for
  // environments where the body rect is unmeasurable (jsdom).
  let scale =
    crop?.scale ?? (viewport.width > 0 ? canvas.width / viewport.width : 1);
  if (crop !== undefined) {
    const cropped = doc.createElement('canvas');
    cropped.width = crop.outWidth;
    cropped.height = crop.outHeight;
    const cropCtx = cropped.getContext('2d');
    if (cropCtx !== null) {
      cropCtx.fillStyle = '#ffffff';
      cropCtx.fillRect(0, 0, cropped.width, cropped.height);
      cropCtx.drawImage(
        canvas,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        cropped.width,
        cropped.height,
      );
      view = cropped;
    } else {
      // No 2D context for the crop target — keep the full raster; the
      // paint below then needs document-space rects, so translate them.
      scale = crop.scale;
      rects.forEach((rect) => {
        rect.x -= bodyRect.x;
        rect.y -= bodyRect.y;
      });
    }
  }

  // LAYER 2: paint over every masked/ignored box.
  const ctx = view.getContext('2d');
  if (ctx === null) {
    return { ok: false, reason: 'render_failed' };
  }
  paintRedactions(ctx, rects, scale);

  // Downscale before encoding if oversized.
  const scaled = downscale(view, maxWidth, doc);

  // Encode ladder — drop, never violate the schema, never block submit.
  for (const step of ENCODE_LADDER) {
    let dataUri: string;
    try {
      dataUri = scaled.toDataURL(step.type, step.quality);
    } catch {
      continue;
    }
    // Browsers fall back to PNG when a type is unsupported; accept
    // whatever came back as long as it fits.
    if (dataUri.length <= maxChars && dataUri.startsWith('data:image/')) {
      return { ok: true, dataUri, masked: true };
    }
  }
  return { ok: false, reason: 'too_large' };
}

export interface ViewportCrop {
  /** Source rect on the full-document canvas (canvas px; may be negative — drawImage clips). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Output canvas size (canvas px). */
  outWidth: number;
  outHeight: number;
  /** canvas px per CSS px — also the factor for painting viewport rects. */
  scale: number;
}

/**
 * Map the visible viewport onto a full-document raster of `<body>`.
 *
 * Pure math, unit-tested across scroll positions and devicePixelRatios:
 * the body rect is measured in viewport space, so its x/y already carry
 * `-scroll` plus body margins; the canvas is a raster of the body box, so
 * `canvasWidth / bodyRect.width` is the canvas-px-per-CSS-px factor
 * (devicePixelRatio included). Viewport (0,0) therefore sits at
 * `(-bodyRect.x, -bodyRect.y) * scale` on the canvas.
 *
 * Returns undefined when the geometry is unmeasurable (jsdom, zero-sized
 * viewport) — callers fall back to painting on the uncropped raster.
 */
export function computeViewportCrop(
  canvasWidth: number,
  canvasHeight: number,
  bodyRect: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>,
  viewport: { width: number; height: number },
): ViewportCrop | undefined {
  if (
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    bodyRect.width <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return undefined;
  }
  const scale = canvasWidth / bodyRect.width;
  return {
    sx: -bodyRect.x * scale,
    sy: -bodyRect.y * scale,
    sw: viewport.width * scale,
    sh: viewport.height * scale,
    outWidth: Math.max(1, Math.round(viewport.width * scale)),
    outHeight: Math.max(1, Math.round(viewport.height * scale)),
    scale,
  };
}

function downscale(
  canvas: HTMLCanvasElement,
  maxWidth: number,
  doc: Document,
): HTMLCanvasElement {
  if (canvas.width <= maxWidth) {
    return canvas;
  }
  const ratio = maxWidth / canvas.width;
  const scaled = doc.createElement('canvas');
  scaled.width = Math.round(canvas.width * ratio);
  scaled.height = Math.round(canvas.height * ratio);
  const ctx = scaled.getContext('2d');
  if (ctx === null) {
    return canvas;
  }
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled;
}

async function loadDefaultRenderer(): Promise<ScreenshotRenderer> {
  const module = await import('./screenshot-snapdom.js');
  return module.createSnapdomRenderer();
}
