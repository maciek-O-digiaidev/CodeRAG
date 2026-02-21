import { describe, it, expect } from 'vitest';
import type { ParsedFile } from '../types/provider.js';
import { GraphBuilder, GraphError } from './graph-builder.js';

function makeFile(
  filePath: string,
  content: string,
  language = 'typescript',
  declarations: string[] = [],
): ParsedFile {
  return { filePath, content, language, declarations };
}

describe('GraphBuilder', () => {
  const rootDir = '/project';

  describe('buildFromFiles', () => {
    it('should build graph from files with no imports', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile('src/a.ts', 'export const x = 1;', 'typescript', ['x']),
        makeFile('src/b.ts', 'export const y = 2;', 'typescript', ['y']),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const graph = result.value;
        expect(graph.nodeCount()).toBe(2);
        expect(graph.edgeCount()).toBe(0);
        expect(graph.getNode('src/a.ts')).toBeDefined();
        expect(graph.getNode('src/b.ts')).toBeDefined();
      }
    });

    it('should create edges for relative imports', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/a.ts',
          `import { foo } from './b.js';`,
          'typescript',
          ['bar'],
        ),
        makeFile('src/b.ts', 'export const foo = 1;', 'typescript', ['foo']),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const graph = result.value;
        expect(graph.nodeCount()).toBe(2);
        expect(graph.edgeCount()).toBe(1);
        expect(graph.getDependencies('src/a.ts')).toEqual(['src/b.ts']);
      }
    });

    it('should skip bare specifiers (npm packages)', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/a.ts',
          `import { ok } from 'neverthrow';`,
          'typescript',
        ),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.edgeCount()).toBe(0);
      }
    });

    it('should resolve .js imports to .ts files', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/index.ts',
          `import { Foo } from './foo.js';`,
          'typescript',
        ),
        makeFile('src/foo.ts', 'export class Foo {}', 'typescript', ['Foo']),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.getDependencies('src/index.ts')).toEqual(['src/foo.ts']);
      }
    });

    it('should resolve index file imports', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/app.ts',
          `import { thing } from './utils.js';`,
          'typescript',
        ),
        makeFile(
          'src/utils/index.ts',
          'export const thing = 1;',
          'typescript',
          ['thing'],
        ),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.getDependencies('src/app.ts')).toEqual([
          'src/utils/index.ts',
        ]);
      }
    });

    it('should handle multiple imports from different files', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/main.ts',
          `import { a } from './a.js';\nimport { b } from './b.js';`,
          'typescript',
        ),
        makeFile('src/a.ts', 'export const a = 1;', 'typescript', ['a']),
        makeFile('src/b.ts', 'export const b = 2;', 'typescript', ['b']),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const deps = result.value.getDependencies('src/main.ts').sort();
        expect(deps).toEqual(['src/a.ts', 'src/b.ts']);
      }
    });

    it('should set node type to module', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [makeFile('src/mod.ts', '', 'typescript', ['Foo'])];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const node = result.value.getNode('src/mod.ts');
        expect(node?.type).toBe('module');
        expect(node?.symbols).toEqual(['Foo']);
      }
    });

    it('should set edge type to imports', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile('src/a.ts', `import { x } from './b.js';`, 'typescript'),
        makeFile('src/b.ts', 'export const x = 1;', 'typescript'),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const edges = result.value.getEdges('src/a.ts');
        expect(edges).toHaveLength(1);
        expect(edges[0]?.type).toBe('imports');
      }
    });

    it('should handle empty file list', () => {
      const builder = new GraphBuilder(rootDir);
      const result = builder.buildFromFiles([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.nodeCount()).toBe(0);
        expect(result.value.edgeCount()).toBe(0);
      }
    });

    it('should ignore imports that cannot be resolved', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/a.ts',
          `import { missing } from './nonexistent.js';`,
          'typescript',
        ),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.edgeCount()).toBe(0);
      }
    });

    it('should handle Python file imports', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/main.py',
          `from .utils import helper`,
          'python',
        ),
        makeFile('src/utils.py', 'def helper(): pass', 'python', ['helper']),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
    });

    it('should normalize backslashes in file paths for node IDs', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile('src\\a.ts', 'export const x = 1;', 'typescript'),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.getNode('src/a.ts')).toBeDefined();
      }
    });

    it('should resolve imports without extension', () => {
      const builder = new GraphBuilder(rootDir);
      const files = [
        makeFile(
          'src/a.ts',
          `import { x } from './b';`,
          'typescript',
        ),
        makeFile('src/b.ts', 'export const x = 1;', 'typescript'),
      ];

      const result = builder.buildFromFiles(files);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.getDependencies('src/a.ts')).toEqual(['src/b.ts']);
      }
    });
  });

  describe('GraphError', () => {
    it('should have the correct name', () => {
      const error = new GraphError('test error');
      expect(error.name).toBe('GraphError');
      expect(error.message).toBe('test error');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
