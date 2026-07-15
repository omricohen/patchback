import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Two pages: / (vanilla widget) and /react.html (React wrapper). The dev
 * proxy forwards /api → the local fake-pipeline API, which keeps this
 * phase CORS-free (real cross-origin embedding is a Phase 8 concern — see
 * OPEN_ISSUES).
 */
export default defineConfig({
  plugins: [react()],
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
