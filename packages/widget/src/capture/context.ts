import type {
  CaptureContext,
  ConsoleEntry,
  PickedElement,
} from '@patchback/types';

import type { ResolvedCaptureConfig } from '../config.js';
import type { MaskingEngine } from '../masking/engine.js';
import { sanitizeUrl } from './url.js';

/**
 * The panel's "What will be sent" preview model. The payload is built FROM
 * this — the preview cannot lie, because there is no second assembly path.
 * Optional items carry what the user explicitly attached (gesture consent)
 * or left checked (console).
 */
export interface CapturePreviewModel {
  /** Element the user explicitly picked, if any (text already masked). */
  element?: PickedElement;
  /** Post-redaction screenshot the user attached, if any. */
  screenshot?: { dataUri: string; masked: boolean };
  /** Ring-buffer entries (already scrubbed at insert). */
  consoleEntries?: ConsoleEntry[];
  /** The "include recent errors" preview checkbox. Default true when entries exist. */
  includeConsole?: boolean;
}

export interface CaptureEnvironment {
  href: string;
  pageTitle: string;
  viewport: { width: number; height: number };
  userAgent: string;
  now?: () => Date;
}

/** Read the capture environment from a window (the default in the widget). */
export function environmentFromWindow(win: Window): CaptureEnvironment {
  return {
    href: win.location.href,
    pageTitle: win.document.title,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    userAgent: win.navigator.userAgent,
  };
}

/**
 * THE payload assembler — the single choke point where captured data
 * becomes a CaptureContext. Unconstructable without the masking engine.
 *
 * Zero-config emissions: query-stripped URL + capturedAt. Everything else
 * requires the matching config flag AND (for element/screenshot/console)
 * a present preview-model entry.
 */
export function buildCaptureContext(
  capture: ResolvedCaptureConfig,
  engine: MaskingEngine,
  preview: CapturePreviewModel,
  env: CaptureEnvironment,
): CaptureContext {
  if (engine === null || typeof engine !== 'object') {
    // Belt for plain-JS callers; the type already requires it.
    throw new TypeError('buildCaptureContext requires a MaskingEngine');
  }
  const now = env.now ?? ((): Date => new Date());
  const context: CaptureContext = {
    capturedAt: now().toISOString(),
  };

  if (capture.url !== false) {
    const url = sanitizeUrl(env.href, {
      includeQuery: capture.url.includeQuery,
    });
    if (url !== undefined) {
      context.url = url;
    }
  }

  if (capture.page) {
    const title = engine.scrub(env.pageTitle).slice(0, 1000);
    if (title !== '') {
      context.pageTitle = title;
    }
    context.viewport = {
      width: env.viewport.width,
      height: env.viewport.height,
    };
    context.userAgent = env.userAgent.slice(0, 500);
  }

  if (capture.elementPicker && preview.element !== undefined) {
    const element: PickedElement = {
      domPath: preview.element.domPath.slice(0, 2000),
    };
    if (preview.element.tagName !== undefined) {
      element.tagName = preview.element.tagName.slice(0, 100);
    }
    if (preview.element.text !== undefined && preview.element.text !== '') {
      // The picker already produced masked text; scrub is idempotent and
      // cheap — run it again here so the choke point does not rely on the
      // caller having done it.
      element.text = engine.scrub(preview.element.text).slice(0, 2000);
    }
    context.element = element;
  }

  if (capture.screenshot && preview.screenshot !== undefined) {
    context.screenshot = {
      dataUri: preview.screenshot.dataUri,
      masked: preview.screenshot.masked,
    };
  }

  if (
    capture.console !== false &&
    preview.consoleEntries !== undefined &&
    preview.consoleEntries.length > 0 &&
    preview.includeConsole !== false
  ) {
    context.console = preview.consoleEntries
      .slice(-capture.console.max)
      .map((entry) => ({
        level: entry.level,
        // Scrubbed at insert; scrub again at the choke point (idempotent).
        message: engine.scrub(entry.message).slice(0, 2000),
        timestamp: entry.timestamp,
      }));
  }

  return context;
}
