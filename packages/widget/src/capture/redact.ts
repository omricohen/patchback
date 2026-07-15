import { REDACTION_FILL } from '../masking/policy.js';
import type { RedactionRect } from '../masking/rects.js';

/**
 * Raster-stage (geometric) screenshot redaction — LAYER 2 of two.
 *
 * Pure over a minimal 2D-context surface so it is unit-testable with a
 * recording fake in jsdom. Runs AFTER rasterization: opaque boxes are
 * painted over every masked/ignored rect measured from the ORIGINAL
 * document in the same synchronous frame. If a renderer quirk ever
 * bypasses the clone-stage layer, pixels are still covered.
 *
 * Rounding is ALWAYS OUTWARD: rects arrive as fractional CSS px (element
 * geometry, scroll offsets, and crop resampling are all sub-pixel); a
 * rect bled by 1 CSS px is scaled to device px, floor/ceil'd outward,
 * then outset one more device pixel. Over-covering a masked region by a
 * pixel is fine; under-covering leaks a content sliver at an edge.
 */
export interface Context2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export { REDACTION_FILL };

export function paintRedactions(
  ctx: Context2DLike,
  rects: readonly RedactionRect[],
  scale = 1,
): void {
  ctx.fillStyle = REDACTION_FILL;
  for (const rect of rects) {
    // 1 CSS px bleed → device px → round outward → 1 device px outset.
    const x0 = Math.floor((rect.x - 1) * scale) - 1;
    const y0 = Math.floor((rect.y - 1) * scale) - 1;
    const x1 = Math.ceil((rect.x + rect.width + 1) * scale) + 1;
    const y1 = Math.ceil((rect.y + rect.height + 1) * scale) + 1;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}
