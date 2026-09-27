import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['services/**/*.ts'],
      exclude: ['services/**/*.test.ts', 'services/**/node_modules/**'],
    },
  },
});
