import { describe, expect, it } from 'vitest';

import { createMaskingEngine } from '../masking/engine.js';
import {
  paintRedactions,
  REDACTION_FILL,
  type Context2DLike,
} from './redact.js';
import {
  captureScreenshot,
  computeViewportCrop,
  type ScreenshotRenderer,
} from './screenshot.js';

/**
 * Screenshot redaction unit proofs (jsdom): each layer is tested
 * independently — layer 1 (clone-stage stripping) in clone.test.ts and via
 * the renderer hook here; layer 2 (rect painting) with a recording fake
 * context. Pixel truth is proven in the env-gated browser acceptance
 * suite.
 */

interface RecordedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

function recordingContext(): { ctx: Context2DLike; rects: RecordedRect[] } {
  const rects: RecordedRect[] = [];
  const ctx: Context2DLike = {
    fillStyle: '',
    fillRect(x, y, width, height) {
      rects.push({ x, y, width, height, fill: String(this.fillStyle) });
    },
  };
  return { ctx, rects };
}

describe('paintRedactions (screenshot layer 2)', () => {
  it('paints exactly one opaque box per rect, with a 1px safety bleed', () => {
    const { ctx, rects } = recordingContext();
    paintRedactions(ctx, [
      { x: 10, y: 20, width: 100, height: 30 },
      { x: 0, y: 0, width: 5, height: 5 },
    ]);
    expect(rects).toEqual([
      { x: 9, y: 19, width: 102, height: 32, fill: REDACTION_FILL },
      { x: -1, y: -1, width: 7, height: 7, fill: REDACTION_FILL },
    ]);
  });

  it('scales rects into device-pixel space', () => {
    const { ctx, rects } = recordingContext();
    paintRedactions(ctx, [{ x: 10, y: 10, width: 50, height: 20 }], 2);
    expect(rects).toEqual([
      { x: 18, y: 18, width: 104, height: 44, fill: REDACTION_FILL },
    ]);
  });
});

function fakeCanvas(dataByType: Record<string, string>): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 600;
  const fillCalls: RecordedRect[] = [];
  const ctx = {
    fillStyle: '' as string,
    fillRect(x: number, y: number, w: number, h: number) {
      fillCalls.push({
        x,
        y,
        width: w,
        height: h,
        fill: String(this.fillStyle),
      });
    },
    drawImage() {},
  };
  Object.defineProperty(canvas, 'getContext', { value: () => ctx });
  Object.defineProperty(canvas, 'toDataURL', {
    value: (type = 'image/png') =>
      dataByType[type] ?? 'data:image/png;base64,AA==',
  });
  (canvas as unknown as { __fills: RecordedRect[] }).__fills = fillCalls;
  return canvas;
}

describe('captureScreenshot', () => {
  it('collects rects from the live DOM, applies the clone hook, and paints layer 2', async () => {
    document.body.innerHTML = '<input id="pw" type="password"><p>copy</p>';
    const engine = createMaskingEngine();
    const canvas = fakeCanvas({
      'image/webp': 'data:image/webp;base64,SMALL',
    });
    let cloneSeen: Element | undefined;
    const renderer: ScreenshotRenderer = {
      async render(target, options) {
        const clone = target.cloneNode(true) as Element;
        options.onClone(clone);
        cloneSeen = clone;
        return canvas;
      },
    };
    const result = await captureScreenshot({
      engine,
      renderer,
      getRect: (el) =>
        (el as HTMLElement).id === 'pw'
          ? { x: 10, y: 10, width: 200, height: 30 }
          : { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(result).toEqual({
      ok: true,
      dataUri: 'data:image/webp;base64,SMALL',
      masked: true,
    });
    // Layer 1 ran on the clone (value stripped).
    expect(cloneSeen?.querySelector('#pw')?.getAttribute('value')).toBeNull();
    // Layer 2 painted the password box (with bleed, scaled by canvas/viewport).
    const fills = (canvas as unknown as { __fills: RecordedRect[] }).__fills;
    expect(fills.length).toBe(1);
    expect(fills[0]?.fill).toBe(REDACTION_FILL);
  });

  it('walks the encode ladder and DROPS (never violates the cap)', async () => {
    document.body.innerHTML = '<p>page</p>';
    const engine = createMaskingEngine();
    const big = `data:image/webp;base64,${'A'.repeat(600000)}`;
    const canvas = fakeCanvas({ 'image/webp': big, 'image/jpeg': big });
    const renderer: ScreenshotRenderer = {
      async render() {
        return canvas;
      },
    };
    const result = await captureScreenshot({ engine, renderer });
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('reports render failures without throwing (submit must never block)', async () => {
    document.body.innerHTML = '<p>page</p>';
    const engine = createMaskingEngine();
    const renderer: ScreenshotRenderer = {
      async render() {
        throw new Error('rasterization exploded');
      },
    };
    const result = await captureScreenshot({ engine, renderer });
    expect(result).toEqual({ ok: false, reason: 'render_failed' });
  });

  it('excludes the widget host from capture', async () => {
    document.body.innerHTML = '<p>page</p><div data-patchback-widget></div>';
    const engine = createMaskingEngine();
    let excluded: readonly string[] | undefined;
    const renderer: ScreenshotRenderer = {
      async render(_target, options) {
        excluded = options.excludeSelectors;
        return fakeCanvas({ 'image/webp': 'data:image/webp;base64,AA==' });
      },
    };
    await captureScreenshot({ engine, renderer });
    expect(excluded).toContain('[data-patchback-widget]');
  });

  it('paints scroll-correct positions on a full-document raster (geometry regression)', async () => {
    // Scenario: 768-tall viewport, page scrolled 1700px down, full-document
    // raster 2400px tall. A masked element visible at viewport y=50 lives
    // at document y≈1750 — the paint must land THERE, not at raster y=50.
    document.body.innerHTML = '<input id="pw" type="password">';
    const engine = createMaskingEngine();
    const canvas = fakeCanvas({ 'image/webp': 'data:image/webp;base64,AA==' });
    canvas.width = 1000;
    canvas.height = 2400;
    const renderer: ScreenshotRenderer = {
      async render() {
        return canvas;
      },
    };
    const result = await captureScreenshot({
      engine,
      renderer,
      // Body starts 12px right / 1688px ABOVE the viewport origin (scrollY
      // 1700 minus an 12px top margin), 1000 CSS px wide → scale 1.
      getBodyRect: () => ({ x: 12, y: -1688, width: 1000, height: 2400 }),
      getRect: (el) =>
        (el as HTMLElement).id === 'pw'
          ? { x: 100, y: 50, width: 200, height: 30 }
          : { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(result.ok).toBe(true);
    const fills = (canvas as unknown as { __fills: RecordedRect[] }).__fills;
    expect(fills).toHaveLength(1);
    // jsdom cannot create the crop canvas (no 2D context), so the paint
    // falls back to the full raster with rects translated into body space:
    // x = 100 - 12, y = 50 - (-1688) — plus the 1px bleed.
    expect(fills[0]).toEqual({
      x: 87,
      y: 1737,
      width: 202,
      height: 32,
      fill: REDACTION_FILL,
    });
  });
});

describe('computeViewportCrop', () => {
  it('maps an unscrolled page (body margin only)', () => {
    const crop = computeViewportCrop(
      1264,
      2939,
      { x: 8, y: 8, width: 1264, height: 2923 },
      { width: 1280, height: 900 },
    );
    expect(crop).toEqual({
      sx: -8,
      sy: -8,
      sw: 1280,
      sh: 900,
      outWidth: 1280,
      outHeight: 900,
      scale: 1,
    });
  });

  it('maps a scrolled page: viewport origin lands scrollY into the raster', () => {
    // scrollY = 1700, body margin 8 → bodyRect.y = 8 - 1700 = -1692.
    const crop = computeViewportCrop(
      1264,
      2939,
      { x: 8, y: -1692, width: 1264, height: 2923 },
      { width: 1280, height: 900 },
    );
    expect(crop?.sy).toBe(1692);
    expect(crop?.sx).toBe(-8);
    expect(crop?.sh).toBe(900);
    expect(crop?.scale).toBe(1);
    // A viewport rect at y=100 paints at out-canvas y=100, which shows the
    // document pixel at y = 1692 + 100 + 8(margin offset baked into sy).
  });

  it('absorbs devicePixelRatio via canvas-px per CSS-px', () => {
    const crop = computeViewportCrop(
      2528, // 1264 CSS px × dpr 2
      5878,
      { x: 8, y: -492, width: 1264, height: 2923 },
      { width: 1280, height: 900 },
    );
    expect(crop?.scale).toBe(2);
    expect(crop?.sy).toBe(984);
    expect(crop?.outWidth).toBe(2560);
    expect(crop?.outHeight).toBe(1800);
  });

  it('returns undefined for unmeasurable geometry (jsdom fallback path)', () => {
    expect(
      computeViewportCrop(
        1000,
        600,
        { x: 0, y: 0, width: 0, height: 0 },
        { width: 1024, height: 768 },
      ),
    ).toBeUndefined();
    expect(
      computeViewportCrop(
        0,
        0,
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 1024, height: 768 },
      ),
    ).toBeUndefined();
  });
});
