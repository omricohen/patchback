import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/store/drizzle/schema.ts',
  out: './migrations',
});
