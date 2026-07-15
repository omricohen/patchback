/** @type {import('next').NextConfig} */
const nextConfig = {
  // Demo app: nothing to configure. The Patchback widget is loaded from the
  // local `patchback dev` API via a plain script tag (see
  // app/components/patchback-snippet.tsx), so no workspace packages need
  // transpiling.
};

export default nextConfig;
