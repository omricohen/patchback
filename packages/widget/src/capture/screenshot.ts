import type { MaskingEngine } from '../masking/engine.js';
import { paintRedactions } from './redact.js';

/**
 * Screenshot capture: DOM rasterization with masking applied BEFORE pixels
 * exist (clone-stage layer 1) plus geometric rect painting after (raster-
 * stage layer 2), then a drop-not-violate size ladder against the server's
 * 512 KiB data-URI cap.
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

  // LAYER 2 geometry FIRST: viewport-space rects from the LIVE document,
  // before any cloning, same synchronous frame.
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
  }

  // LAYER 2: paint over every masked/ignored box.
  const viewportWidth = doc.defaultView?.innerWidth ?? canvas.width;
  const scale = viewportWidth > 0 ? canvas.width / viewportWidth : 1;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return { ok: false, reason: 'render_failed' };
  }
  paintRedactions(ctx, rects, scale);

  // Downscale before encoding if oversized.
  const scaled = downscale(canvas, maxWidth, doc);

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
