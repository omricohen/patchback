import type { RedactionRect } from '../masking/rects.js';

/**
 * Raster-stage (geometric) screenshot redaction — LAYER 2 of two.
 *
 * Pure over a minimal 2D-context surface so it is unit-testable with a
 * recording fake in jsdom. Runs AFTER rasterization: opaque boxes are
 * painted over every masked/ignored rect measured from the ORIGINAL
 * document in the same synchronous frame. If a renderer quirk ever
 * bypasses the clone-stage layer, pixels are still covered.
 */
export interface Context2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export const REDACTION_FILL = '#242a33';

export function paintRedactions(
  ctx: Context2DLike,
  rects: readonly RedactionRect[],
  scale = 1,
): void {
  ctx.fillStyle = REDACTION_FILL;
  for (const rect of rects) {
    // Bleed by one CSS pixel on every side so anti-aliased edges of the
    // underlying content can never peek out.
    ctx.fillRect(
      (rect.x - 1) * scale,
      (rect.y - 1) * scale,
      (rect.width + 2) * scale,
      (rect.height + 2) * scale,
    );
  }
}
