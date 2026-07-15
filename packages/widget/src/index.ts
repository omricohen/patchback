/**
 * @patchback/widget — vanilla embeddable feedback widget.
 *
 * Zero runtime dependencies in the core (the screenshot renderer is the
 * one lazy-loaded exception); open shadow DOM isolation; no custom-element
 * registration; no telemetry — network I/O goes exclusively to the
 * configured `apiUrl`.
 */
import { createWidgetController, type PatchbackWidget } from './controller.js';
import type { PatchbackWidgetConfig } from './config.js';

export function createPatchbackWidget(
  config: PatchbackWidgetConfig,
): PatchbackWidget {
  return createWidgetController(config);
}

/** Alias used by the IIFE global (`window.Patchback.create(...)`). */
export const create = createPatchbackWidget;

export type { PatchbackWidget } from './controller.js';
export type {
  CaptureConfig,
  PatchbackWidgetConfig,
  ResolvedCaptureConfig,
} from './config.js';
export { WidgetConfigError } from './config.js';
export type { WidgetEventMap, WidgetEventName } from './events.js';
export { createMaskingEngine, type MaskingEngine } from './masking/engine.js';
export {
  MaskingConfigError,
  type MaskClassification,
  type MaskingConfig,
} from './masking/policy.js';
export { scrubText } from './masking/scrub.js';
export {
  STATUS_MAP,
  presentState,
  type StatusPresentation,
  type StatusTone,
} from './status-map.js';
export type { ThreadEntry, ThreadRecord } from './storage.js';
