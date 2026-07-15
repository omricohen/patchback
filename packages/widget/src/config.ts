import type { Submitter } from '@patchback/types';

import type { MaskingConfig } from './masking/policy.js';

/**
 * Widget configuration. Capture is opt-in: with zero config, exactly TWO
 * things leave the page on submit — the user's typed message and the
 * query-stripped URL (plus the submit timestamp). Everything else requires
 * explicit config (config consent) and, for the picker and screenshots, a
 * per-use user gesture with a "What will be sent" preview (gesture
 * consent).
 *
 * The widget NEVER handles trust tiers: no config field, no payload field.
 * Tier assignment is exclusively server-side from the API key.
 */
export interface PatchbackWidgetConfig {
  /** Patchback API base URL. The ONLY network destination the widget has. */
  apiUrl: string;
  /**
   * The EMBEDDING APP's API key. Shipping an insider key in a page makes
   * every visitor of that page an insider — only do this in internal apps
   * behind your own authentication. Omit for public pages: submissions land
   * as outsider (data only).
   */
  apiKey?: string;
  /** Identity asserted by the embedding app. The widget never sniffs it. */
  submitter?: Submitter;
  capture?: CaptureConfig;
  masking?: MaskingConfig;
  /**
   * Persist thread read tokens in localStorage (default false: memory
   * only). A read token grants read access to the item INCLUDING capture
   * context — enable only in internal apps on trusted machines.
   */
  persistThreads?: boolean;
  /** Render the floating launcher button (default true). */
  launcher?: boolean;
  /**
   * Status-poll intervals (ms). Defaults: fast 2500 (pre-triage), slow
   * 15000 (post-triage). The playground tightens these for demo snappiness.
   */
  polling?: { fastMs?: number; slowMs?: number };
  /** CSS custom property overrides (`--patchback-*`). */
  theme?: Record<string, string>;
  zIndex?: number;
}

export interface CaptureConfig {
  /**
   * Page URL capture. Default: enabled with query string and hash STRIPPED.
   * `{ includeQuery: true }` keeps the query; `false` drops the URL
   * entirely.
   */
  url?: boolean | { includeQuery?: boolean };
  /** Page environment trio: title + viewport + userAgent. Default false. */
  page?: boolean;
  /**
   * Element picker button. Default true — data is captured only on the
   * user's explicit pick, previewed before submit, and maskable.
   */
  elementPicker?: boolean;
  /**
   * "Attach screenshot" button. Default false. Capture happens ONLY on
   * click, the post-redaction preview is shown, and it is removable before
   * submit.
   */
  screenshot?: boolean;
  /**
   * Console ring buffer. Default false — the console wrap is not even
   * installed. `true` captures errors only; the object form opts into
   * warnings and tunes the ring size.
   */
  console?: boolean | { levels?: ('error' | 'warn')[]; max?: number };
}

export interface ResolvedCaptureConfig {
  url: false | { includeQuery: boolean };
  page: boolean;
  elementPicker: boolean;
  screenshot: boolean;
  console: false | { levels: ('error' | 'warn')[]; max: number };
}

export class WidgetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetConfigError';
  }
}

export function resolveCaptureConfig(
  capture: CaptureConfig = {},
): ResolvedCaptureConfig {
  const url =
    capture.url === false
      ? (false as const)
      : {
          includeQuery:
            typeof capture.url === 'object'
              ? (capture.url.includeQuery ?? false)
              : false,
        };
  const consoleConfig =
    capture.console === undefined || capture.console === false
      ? (false as const)
      : {
          levels:
            typeof capture.console === 'object'
              ? (capture.console.levels ?? ['error' as const])
              : ['error' as const],
          max:
            typeof capture.console === 'object'
              ? (capture.console.max ?? 50)
              : 50,
        };
  return {
    url,
    page: capture.page ?? false,
    elementPicker: capture.elementPicker ?? true,
    screenshot: capture.screenshot ?? false,
    console: consoleConfig,
  };
}

export function validateWidgetConfig(config: PatchbackWidgetConfig): void {
  if (typeof config.apiUrl !== 'string' || config.apiUrl.trim() === '') {
    throw new WidgetConfigError('apiUrl is required');
  }
}
