import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileScanner, ScanError } from './file-scanner.js';
import { computeFileHash } from './index-state.js';

describe('FileScanner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'coderag-scanner-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scanFiles', () => {
    it('should find all files in a directory tree', async () => {
      writeFileSync(join(tempDir, 'main.ts'), 'export const x = 1;');
      mkdirSync(join(tempDir, 'src'));
      writeFileSync(join(tempDir, 'src', 'util.ts'), 'export function add(a: number, b: number) { return a + b; }');
      writeFileSync(join(tempDir, 'src', 'types.ts'), 'export interface Foo { bar: string; }');

      const scanner = new FileScanner(tempDir, () => false);
      const result = await scanner.scanFiles();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const filePaths = result.value.map((f) => f.filePath).sort();
        expect(filePaths).toHaveLength(3);
        expect(filePaths).toContain('main.ts');
        expect(filePaths).toContain(join('src', 'util.ts'));
        expect(filePaths).toContain(join('src', 'types.ts'));
      }
    });

    it('should respect the ignore filter', async () => {
      writeFileSync(join(tempDir, 'keep.ts'), 'keep me');
      writeFileSync(join(tempDir, 'ignore-me.ts'), 'ignore me');
      mkdirSync(join(tempDir, 'node_modules'));
      writeFileSync(join(tempDir, 'node_modules', 'dep.js'), 'dependency');

      const ignoreFilter = (path: string): boolean => {
        return path.includes('ignore-me') || path.startsWith('node_modules');
      };

      const scanner = new FileScanner(tempDir, ignoreFilter);
      const result = await scanner.scanFiles();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const filePaths = result.value.map((f) => f.filePath);
        expect(filePaths).toHaveLength(1);
        expect(filePaths).toContain('keep.ts');
      }
    });

    it('should handle an empty directory', async () => {
      const scanner = new FileScanner(tempDir, () => false);
      const result = await scanner.scanFiles();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should compute correct content hashes', async () => {
      const content = 'export const greeting = "hello";';
      writeFileSync(join(tempDir, 'hello.ts'), content);

      const expectedHash = computeFileHash(content);
      const scanner = new FileScanner(tempDir, () => false);
      const result = await scanner.scanFiles();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.contentHash).toBe(expectedHash);
        expect(result.value[0]?.content).toBe(content);
      }
    });

    it('should return file content as string', async () => {
      const content = 'const a = 42;\nconst b = "hello";\n';
      writeFileSync(join(tempDir, 'data.ts'), content);

      const scanner = new FileScanner(tempDir, () => false);
      const result = await scanner.scanFiles();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]?.content).toBe(content);
        expect(result.value[0]?.filePath).toBe('data.ts');
      }
    });

    it('should return ScanError for non-existent directory', async () => {
      const scanner = new FileScanner('/nonexistent/path/coderag-test', () => false);
      const result = await scanner.scanFiles();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ScanError);
        expect(result.error.message).toContain('Failed to scan directory');
      }
    });

    it('should handle nested directories with mixed ignored and non-ignored files', async () => {
      mkdirSync(join(tempDir, 'src'));
      mkdirSync(join(tempDir, 'src', 'utils'));
      mkdirSync(join(tempDir, 'dist'));
      writeFileSync(join(tempDir, 'src', 'index.ts'), 'export {}');
      writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'), 'export function help() {}');
      writeFileSync(join(tempDir, 'dist', 'bundle.js'), 'compiled code');

      const ignoreFilter = (path: string): boolean => path.startsWith('dist');

      const scanner = new FileScanner(tempDir, ignoreFilter);
      const result = await scanner.scanFiles();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const filePaths = result.value.map((f) => f.filePath).sort();
        expect(filePaths).toHaveLength(2);
        expect(filePaths).toContain(join('src', 'index.ts'));
        expect(filePaths).toContain(join('src', 'utils', 'helper.ts'));
      }
    });
  });
});
