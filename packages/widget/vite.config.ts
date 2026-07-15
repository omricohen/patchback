import { defineConfig } from 'vite';

/**
 * IIFE bundle for script-tag embedding (`window.Patchback.create(...)`).
 * The ESM package entry is the tsc per-module output (dist/index.js),
 * which keeps the snapdom import a TRUE dynamic import for bundler users;
 * the IIFE inlines it instead (no CDN loading — the no-telemetry posture
 * forbids runtime fetches to third-party hosts).
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      name: 'Patchback',
      formats: ['iife'],
      fileName: () => 'patchback-widget.iife.js',
    },
  },
});
