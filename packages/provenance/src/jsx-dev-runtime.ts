/**
 * `jsxImportSource: '@patchback/provenance'` — DEV runtime entry.
 *
 * The automatic dev transform (babel, esbuild, SWC, oxc alike) calls
 * `jsxDEV(type, props, key, isStaticChildren, source, self)` with
 * `source = { fileName, lineNumber, columnNumber }`. This wrapper stamps
 * `data-pb-source="relative/file.tsx:line"` onto HOST elements only
 * (`typeof type === 'string'`) and then delegates to React's own runtime.
 *
 * - A manually authored `data-pb-source` prop always wins (never overwritten).
 * - Fail closed: no injected root / outside-root / node_modules ⇒ no stamp
 *   (see core.ts). Absolute paths never reach the DOM.
 * - Production builds import `jsx-runtime` instead, which is a pure
 *   passthrough — stripping is structural, not a flag.
 */
import { PROVENANCE_ATTRIBUTE } from '@patchback/types';
import * as ReactJSXDevRuntime from 'react/jsx-dev-runtime';

import { computeStamp } from './core.js';

export const Fragment = ReactJSXDevRuntime.Fragment;
export type { JSX } from 'react/jsx-dev-runtime';

interface JsxDevSource {
  fileName?: unknown;
  lineNumber?: unknown;
  columnNumber?: unknown;
}

type ReactJsxDEV = (
  type: unknown,
  props: unknown,
  key: unknown,
  isStaticChildren: unknown,
  source?: unknown,
  self?: unknown,
) => unknown;

const reactJsxDEV = (ReactJSXDevRuntime as unknown as { jsxDEV: ReactJsxDEV })
  .jsxDEV;

export function jsxDEV(
  type: unknown,
  props: unknown,
  key: unknown,
  isStaticChildren: unknown,
  source?: JsxDevSource,
  self?: unknown,
): unknown {
  if (
    typeof type === 'string' &&
    props !== null &&
    typeof props === 'object' &&
    source !== null &&
    typeof source === 'object' &&
    !(PROVENANCE_ATTRIBUTE in props)
  ) {
    const stamp = computeStamp(source.fileName, source.lineNumber);
    if (stamp !== undefined) {
      props = { ...props, [PROVENANCE_ATTRIBUTE]: stamp };
    }
  }
  return reactJsxDEV(type, props, key, isStaticChildren, source, self);
}
