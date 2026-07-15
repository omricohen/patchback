import { defineConfig } from 'vite';

// 5174 keeps clear of the widget-playground (5173). If you change it,
// add the new origin to `appOrigins` in patchback.config.ts too.
export default defineConfig({
  server: { port: 5174 },
});
