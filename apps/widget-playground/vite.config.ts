import { resolve } from 'node:path';

import { patchbackProvenance } from '@patchback/provenance/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Two pages: / (vanilla widget) and /react.html (React wrapper). The dev
 * proxy forwards /api → the local fake-pipeline API, which keeps this
 * phase CORS-free (real cross-origin embedding is a Phase 8 concern — see
 * OPEN_ISSUES).
 *
 * Provenance wiring (v0.2 phase 1): plugin-react owns the JSX pipeline, so
 * the jsxImportSource is passed to react() directly; patchbackProvenance()
 * injects the discovered repo root in dev (and stays inert in builds).
 * /react.html is the ANNOTATED surface; / (vanilla innerHTML) is the living
 * negative control — no JSX, no attributes, hint-free payloads.
 */
export default defineConfig({
  plugins: [
    react({ jsxImportSource: '@patchback/provenance' }),
    patchbackProvenance(),
  ],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        react: resolve(import.meta.dirname, 'react.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PATCHBACK_DEV_API_PORT ?? 8787}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
