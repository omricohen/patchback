import { applyMaskingToClone } from './clone.js';
import {
  classifyElement,
  resolveMaskingConfig,
  type MaskClassification,
  type MaskingConfig,
  type ResolvedMaskingConfig,
} from './policy.js';
import {
  collectRedactionRects,
  type CollectRectsOptions,
  type RedactionRect,
} from './rects.js';
import { scrubText } from './scrub.js';
import { maskedTextOf } from './text.js';

/**
 * The one object every capture path consumes. `buildCaptureContext` is
 * unconstructable without it — masking works before any capture ships,
 * structurally.
 */
export interface MaskingEngine {
  readonly config: ResolvedMaskingConfig;
  classify(el: Element): MaskClassification;
  /** Text with masked descendants replaced, ignored dropped, then scrubbed. */
  maskedTextOf(el: Element): string;
  /** Viewport-space boxes of masked+ignored elements — layer-2 input. */
  collectRedactionRects(
    root: Document | ShadowRoot,
    options?: CollectRectsOptions,
  ): RedactionRect[];
  /** Strip values/text in a capture clone — layer 1. */
  applyToClone(cloneRoot: Element): void;
  /** Scrub captured text (no-op when `scrubText: false`). */
  scrub(text: string): string;
}

/** Throws MaskingConfigError on invalid selectors — loud at init. */
export function createMaskingEngine(config?: MaskingConfig): MaskingEngine {
  const resolved = resolveMaskingConfig(config);
  return {
    config: resolved,
    classify: (el) => classifyElement(el, resolved),
    maskedTextOf: (el) => maskedTextOf(el, resolved),
    collectRedactionRects: (root, options) =>
      collectRedactionRects(root, resolved, options),
    applyToClone: (cloneRoot) => applyMaskingToClone(cloneRoot, resolved),
    scrub: (text) => (resolved.scrubText ? scrubText(text) : text),
  };
}
