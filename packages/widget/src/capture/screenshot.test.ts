import { describe, expect, it } from 'vitest';

import { createMaskingEngine } from '../masking/engine.js';
import {
  paintRedactions,
  REDACTION_FILL,
  type Context2DLike,
} from './redact.js';
import { captureScreenshot, type ScreenshotRenderer } from './screenshot.js';

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
});
