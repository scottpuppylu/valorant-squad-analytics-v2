import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // PGlite applies the full schema per test database; generous under parallel load.
    testTimeout: 30_000,
  },
});
