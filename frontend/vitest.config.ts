import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // `app/**` is here so route-level invariants can be tested at all. The
    // footer linked to ten non-existent routes for months; the footer's own
    // test asserted those hrefs were PRESENT and passed the whole time, because
    // "is in the nav" and "is a route" are different claims and only the second
    // one needs the filesystem. See `app/static-routes.test.ts`.
    include: ['app/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['components/**', 'lib/**'],
      exclude: ['**/*.stories.tsx', '**/*.test.tsx'],
    },
  },
});
