import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: [
        'src/config/**/*.ts',
        'src/index.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**/*.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
