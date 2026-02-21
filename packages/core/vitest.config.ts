import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: [
        'src/config/**/*.ts',
        'src/git/**/*.ts',
        'src/parser/**/*.ts',
        'src/chunker/**/*.ts',
        'src/graph/**/*.ts',
        'src/enrichment/**/*.ts',
        'src/indexer/**/*.ts',
        'src/embedding/**/*.ts',
        'src/retrieval/**/*.ts',
        'src/index.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**/*.ts',
        'src/parser/tree-sitter-parser.ts',
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
