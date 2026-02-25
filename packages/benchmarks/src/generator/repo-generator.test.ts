import { describe, it, expect } from 'vitest';
import { generateRepo } from './repo-generator.js';
import type { RepoGeneratorOptions } from './repo-generator.js';

describe('generateRepo', () => {
  const defaultOptions: RepoGeneratorOptions = {
    seed: 42,
    fileCount: 20,
    languages: ['typescript'],
    complexity: 'medium',
  };

  describe('determinism', () => {
    it('should produce identical output for the same seed and options', () => {
      const repo1 = generateRepo(defaultOptions);
      const repo2 = generateRepo(defaultOptions);

      expect(repo1.files.length).toBe(repo2.files.length);
      expect(repo1.manifest.entities.length).toBe(repo2.manifest.entities.length);

      for (let i = 0; i < repo1.files.length; i++) {
        expect(repo1.files[i]!.path).toBe(repo2.files[i]!.path);
        expect(repo1.files[i]!.content).toBe(repo2.files[i]!.content);
        expect(repo1.files[i]!.language).toBe(repo2.files[i]!.language);
      }

      for (let i = 0; i < repo1.manifest.entities.length; i++) {
        expect(repo1.manifest.entities[i]!.id).toBe(repo2.manifest.entities[i]!.id);
        expect(repo1.manifest.entities[i]!.name).toBe(repo2.manifest.entities[i]!.name);
      }
    });

    it('should produce different output for different seeds', () => {
      const repo1 = generateRepo({ ...defaultOptions, seed: 42 });
      const repo2 = generateRepo({ ...defaultOptions, seed: 99 });

      // File paths or entity names should differ
      const paths1 = repo1.files.map((f) => f.path).sort();
      const paths2 = repo2.files.map((f) => f.path).sort();
      expect(paths1).not.toEqual(paths2);
    });
  });

  describe('file generation', () => {
    it('should generate the requested number of source files', () => {
      const repo = generateRepo(defaultOptions);
      // Source files (non-test)
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.') && !f.path.includes('test_'),
      );
      expect(sourceFiles.length).toBe(20);
    });

    it('should also generate test files', () => {
      const repo = generateRepo(defaultOptions);
      const testFiles = repo.files.filter(
        (f) => f.path.includes('.test.') || f.path.includes('test_'),
      );
      expect(testFiles.length).toBeGreaterThan(0);
    });

    it('should clamp fileCount to minimum 10', () => {
      const repo = generateRepo({ ...defaultOptions, fileCount: 3 });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.') && !f.path.includes('test_'),
      );
      expect(sourceFiles.length).toBe(10);
    });

    it('should clamp fileCount to maximum 1000', () => {
      const repo = generateRepo({ ...defaultOptions, fileCount: 2000 });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.') && !f.path.includes('test_'),
      );
      expect(sourceFiles.length).toBe(1000);
    });

    it('should generate TypeScript files when language is typescript', () => {
      const repo = generateRepo({
        ...defaultOptions,
        languages: ['typescript'],
      });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.'),
      );
      for (const file of sourceFiles) {
        expect(file.language).toBe('typescript');
        expect(file.path).toMatch(/\.ts$/);
      }
    });

    it('should generate Python files when language is python', () => {
      const repo = generateRepo({
        ...defaultOptions,
        languages: ['python'],
      });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.startsWith('src/') || !f.path.includes('test_'),
      );
      for (const file of sourceFiles) {
        expect(file.language).toBe('python');
        expect(file.path).toMatch(/\.py$/);
      }
    });

    it('should generate both languages when both are specified', () => {
      const repo = generateRepo({
        ...defaultOptions,
        languages: ['typescript', 'python'],
      });
      const tsFiles = repo.files.filter((f) => f.language === 'typescript');
      const pyFiles = repo.files.filter((f) => f.language === 'python');
      expect(tsFiles.length).toBeGreaterThan(0);
      expect(pyFiles.length).toBeGreaterThan(0);
    });

    it('should place files in module directories under src/', () => {
      const repo = generateRepo(defaultOptions);
      for (const file of repo.files) {
        expect(file.path).toMatch(/^src\/[a-z]+\//);
      }
    });
  });

  describe('manifest', () => {
    it('should record the seed in the manifest', () => {
      const repo = generateRepo(defaultOptions);
      expect(repo.manifest.seed).toBe(42);
    });

    it('should record the options in the manifest', () => {
      const repo = generateRepo(defaultOptions);
      expect(repo.manifest.options).toEqual(defaultOptions);
    });

    it('should track all generated entities', () => {
      const repo = generateRepo(defaultOptions);
      expect(repo.manifest.entities.length).toBeGreaterThan(0);
    });

    it('should have unique entity IDs', () => {
      const repo = generateRepo(defaultOptions);
      const ids = repo.manifest.entities.map((e) => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include functions, classes, interfaces, methods, and tests', () => {
      const repo = generateRepo(defaultOptions);
      const types = new Set(repo.manifest.entities.map((e) => e.entityType));
      expect(types.has('function')).toBe(true);
      expect(types.has('class')).toBe(true);
      expect(types.has('interface')).toBe(true);
      expect(types.has('method')).toBe(true);
      expect(types.has('test')).toBe(true);
    });

    it('should list the selected modules', () => {
      const repo = generateRepo(defaultOptions);
      expect(repo.manifest.modules.length).toBeGreaterThan(0);
      // Each entity's module should be in the modules list
      for (const entity of repo.manifest.entities) {
        expect(repo.manifest.modules).toContain(entity.module);
      }
    });

    it('should have entity file paths matching generated files', () => {
      const repo = generateRepo(defaultOptions);
      const filePaths = new Set(repo.files.map((f) => f.path));
      for (const entity of repo.manifest.entities) {
        expect(filePaths.has(entity.filePath)).toBe(true);
      }
    });

    it('should have descriptions for all entities', () => {
      const repo = generateRepo(defaultOptions);
      for (const entity of repo.manifest.entities) {
        expect(entity.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('content quality', () => {
    it('should generate valid TypeScript syntax (export keywords)', () => {
      const repo = generateRepo({
        ...defaultOptions,
        languages: ['typescript'],
      });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.'),
      );
      for (const file of sourceFiles) {
        expect(file.content).toContain('export');
      }
    });

    it('should generate TypeScript classes with JSDoc', () => {
      const repo = generateRepo({
        ...defaultOptions,
        languages: ['typescript'],
      });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.'),
      );
      for (const file of sourceFiles) {
        expect(file.content).toContain('/**');
        expect(file.content).toContain('*/');
      }
    });

    it('should generate Python files with docstrings', () => {
      const repo = generateRepo({
        ...defaultOptions,
        languages: ['python'],
      });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('test_'),
      );
      for (const file of sourceFiles) {
        expect(file.content).toContain('"""');
      }
    });

    it('should generate test files with imports from source', () => {
      const repo = generateRepo({
        ...defaultOptions,
        languages: ['typescript'],
      });
      const testFiles = repo.files.filter((f) => f.path.includes('.test.'));
      for (const file of testFiles) {
        expect(file.content).toContain('import');
        expect(file.content).toContain('describe');
      }
    });
  });

  describe('complexity', () => {
    it('should generate simpler code for simple complexity', () => {
      const simple = generateRepo({
        ...defaultOptions,
        complexity: 'simple',
        fileCount: 10,
      });
      const complex = generateRepo({
        ...defaultOptions,
        complexity: 'complex',
        fileCount: 10,
      });

      // Complex repos should have more entities (more methods per class)
      expect(complex.manifest.entities.length).toBeGreaterThan(
        simple.manifest.entities.length,
      );
    });

    it('should generate more functions and methods for complex repos', () => {
      const complex = generateRepo({
        ...defaultOptions,
        complexity: 'complex',
        fileCount: 10,
      });
      const methods = complex.manifest.entities.filter(
        (e) => e.entityType === 'method',
      );
      // Complex: 3 methods per class, 10 source files = 30 methods
      expect(methods.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('scale', () => {
    it('should handle 10 files', () => {
      const repo = generateRepo({ ...defaultOptions, fileCount: 10 });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.') && !f.path.includes('test_'),
      );
      expect(sourceFiles.length).toBe(10);
    });

    it('should handle 100 files', () => {
      const repo = generateRepo({ ...defaultOptions, fileCount: 100 });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.') && !f.path.includes('test_'),
      );
      expect(sourceFiles.length).toBe(100);
    });

    it('should handle 500 files with both languages', () => {
      const repo = generateRepo({
        ...defaultOptions,
        fileCount: 500,
        languages: ['typescript', 'python'],
      });
      const sourceFiles = repo.files.filter(
        (f) => !f.path.includes('.test.') && !f.path.includes('test_'),
      );
      expect(sourceFiles.length).toBe(500);
      expect(repo.manifest.entities.length).toBeGreaterThan(500);
    });
  });
});
