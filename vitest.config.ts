import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['dist/**', '**/dist/**', 'node_modules/**', '**/node_modules/**'],
  },
});
