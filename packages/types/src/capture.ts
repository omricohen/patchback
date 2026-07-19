/**
 * Context captured by the widget alongside a feedback message.
 *
 * Capture is opt-in and maskable: every field here is optional, and nothing
 * is captured by default without explicit config. Masking (inputs, emails,
 * selectors) is applied by the widget before a CaptureContext ever leaves
 * the page.
 */

/** One entry from the widget's console-error ring buffer. */
export interface ConsoleEntry {
  level: 'error' | 'warn';
  message: string;
  /** ISO 8601 timestamp of when the entry was recorded. */
  timestamp: string;
}

/** Element selected via the widget's element picker. */
export interface PickedElement {
  /** DOM path (CSS selector chain) to the picked element. */
  domPath: string;
  /** Tag name of the picked element, lowercase (e.g. "button"). */
  tagName?: string;
  /** Visible text content, post-masking, truncated by the widget. */
  text?: string;
  /**
   * Build-provenance source location (`relative/file.tsx:line`) read from the
   * picked element's `data-pb-source` attribute (or nearest annotated
   * ancestor). App/DOM-controlled data — always validate with
   * `parseSourceHint` before trusting; the brief factory is the
   * authoritative gate.
   */
  sourceHint?: string;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface CaptureContext {
  /** Page URL at submit time. */
  url?: string;
  /** Document title at submit time. */
  pageTitle?: string;
  /** Element the user picked, if any. */
  element?: PickedElement;
  /**
   * Screenshot as a data URI. Masked elements are redacted before encoding;
   * a screenshot with `masked: false` means masking was explicitly disabled.
   */
  screenshot?: {
    dataUri: string;
    masked: boolean;
  };
  /** Recent console errors/warnings from the ring buffer. */
  console?: ConsoleEntry[];
  viewport?: Viewport;
  userAgent?: string;
  /** ISO 8601 timestamp of when capture happened. */
  capturedAt?: string;
}
