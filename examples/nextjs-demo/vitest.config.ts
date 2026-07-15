import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app tsconfig uses `jsx: "preserve"` (Next.js requirement); for
  // tests, the transform must actually compile the JSX.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'jsdom',
  },
});
