/**
 * @patchback/provenance — build-time source provenance.
 *
 * Browser-safe entry: the runtime core only. Build integrations live in
 * dedicated subpath exports so client bundles never pull Node builtins:
 *
 * - `@patchback/provenance/jsx-dev-runtime` / `jsx-runtime` — jsxImportSource
 *   target (mechanism (c): dev-runtime stamping, structural prod stripping)
 * - `@patchback/provenance/vite` — Vite plugin
 * - `@patchback/provenance/next` — `withPatchbackProvenance` config helper
 * - `@patchback/provenance/babel` — static babel plugin (prod opt-in /
 *   escape hatch)
 */
export {
  PROVENANCE_ROOT_GLOBAL,
  computeStamp,
  relativeSourceFile,
  setProvenanceRoot,
} from './core.js';
export { PROVENANCE_ATTRIBUTE } from '@patchback/types';
