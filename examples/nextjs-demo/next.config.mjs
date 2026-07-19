import { withPatchbackProvenance } from '@patchback/provenance/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Demo app: the Patchback widget is loaded from the local `patchback dev`
  // API via a plain script tag (see app/components/patchback-snippet.tsx).
};

// Build-time source provenance (dev only): together with the
// `jsxImportSource` setting in tsconfig.json, this stamps rendered elements
// with `data-pb-source="<repo-relative-file>:<line>"` in `next dev` so the
// widget's element picker can carry a real source hint. Production builds
// stamp nothing (the prod JSX runtime has no source info).
export default withPatchbackProvenance(nextConfig);
