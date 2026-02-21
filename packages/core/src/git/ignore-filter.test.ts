import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIgnoreFilter } from './ignore-filter.js';

describe('createIgnoreFilter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'coderag-ignore-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('default patterns', () => {
    it('should ignore node_modules', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('node_modules/package/index.js')).toBe(true);
    });

    it('should ignore .git directory', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('.git/config')).toBe(true);
    });

    it('should ignore .coderag directory', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('.coderag/index.db')).toBe(true);
    });

    it('should ignore dist directory', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('dist/index.js')).toBe(true);
    });

    it('should ignore build directory', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('build/output.js')).toBe(true);
    });

    it('should not ignore regular source files', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('src/index.ts')).toBe(false);
    });
  });

  describe('.gitignore patterns', () => {
    it('should respect .gitignore patterns', () => {
      writeFileSync(join(tempDir, '.gitignore'), '*.log\ncoverage/\n');
      const filter = createIgnoreFilter(tempDir);

      expect(filter('debug.log')).toBe(true);
      expect(filter('coverage/lcov.info')).toBe(true);
      expect(filter('src/main.ts')).toBe(false);
    });

    it('should handle .gitignore comments and empty lines', () => {
      writeFileSync(
        join(tempDir, '.gitignore'),
        '# This is a comment\n\n*.tmp\n\n# Another comment\n*.bak\n',
      );
      const filter = createIgnoreFilter(tempDir);

      expect(filter('file.tmp')).toBe(true);
      expect(filter('file.bak')).toBe(true);
      expect(filter('file.ts')).toBe(false);
    });

    it('should work when .gitignore does not exist', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('src/index.ts')).toBe(false);
      expect(filter('node_modules/pkg/index.js')).toBe(true);
    });
  });

  describe('.coderagignore patterns', () => {
    it('should respect .coderagignore patterns', () => {
      writeFileSync(join(tempDir, '.coderagignore'), 'vendor/\n*.generated.ts\n');
      const filter = createIgnoreFilter(tempDir);

      expect(filter('vendor/lib.js')).toBe(true);
      expect(filter('src/types.generated.ts')).toBe(true);
      expect(filter('src/types.ts')).toBe(false);
    });

    it('should work when .coderagignore does not exist', () => {
      const filter = createIgnoreFilter(tempDir);
      expect(filter('src/index.ts')).toBe(false);
    });
  });

  describe('combined patterns', () => {
    it('should combine .gitignore and .coderagignore patterns', () => {
      writeFileSync(join(tempDir, '.gitignore'), '*.log\n');
      writeFileSync(join(tempDir, '.coderagignore'), 'docs/internal/\n');
      const filter = createIgnoreFilter(tempDir);

      expect(filter('node_modules/pkg/index.js')).toBe(true);
      expect(filter('error.log')).toBe(true);
      expect(filter('docs/internal/secret.md')).toBe(true);
      expect(filter('src/app.ts')).toBe(false);
      expect(filter('docs/public/readme.md')).toBe(false);
    });
  });
});
