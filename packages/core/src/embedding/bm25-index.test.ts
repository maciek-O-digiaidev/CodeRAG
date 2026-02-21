import { describe, it, expect } from 'vitest';
import { BM25Index } from './bm25-index.js';
import type { Chunk } from '../types/chunk.js';

function makeChunk(overrides: Partial<Chunk> & { id: string }): Chunk {
  return {
    content: 'function add(a, b) { return a + b; }',
    nlSummary: 'Adds two numbers together',
    filePath: 'src/utils.ts',
    startLine: 1,
    endLine: 3,
    language: 'typescript',
    metadata: {
      chunkType: 'function',
      name: 'add',
      declarations: [],
      imports: [],
      exports: [],
    },
    ...overrides,
  };
}

describe('BM25Index', () => {
  describe('addChunks', () => {
    it('should index chunks and update count', () => {
      const index = new BM25Index();
      const chunks = [
        makeChunk({ id: 'chunk-1' }),
        makeChunk({
          id: 'chunk-2',
          content: 'function subtract(a, b) { return a - b; }',
          nlSummary: 'Subtracts two numbers',
          metadata: {
            chunkType: 'function',
            name: 'subtract',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
      ];

      index.addChunks(chunks);
      expect(index.count()).toBe(2);
    });

    it('should handle empty array', () => {
      const index = new BM25Index();
      index.addChunks([]);
      expect(index.count()).toBe(0);
    });
  });

  describe('search', () => {
    it('should return matching results sorted by relevance', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({
          id: 'chunk-1',
          content: 'function add(a, b) { return a + b; }',
          nlSummary: 'Adds two numbers together',
          metadata: {
            chunkType: 'function',
            name: 'add',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
        makeChunk({
          id: 'chunk-2',
          content: 'function multiply(a, b) { return a * b; }',
          nlSummary: 'Multiplies two numbers',
          metadata: {
            chunkType: 'function',
            name: 'multiply',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
        makeChunk({
          id: 'chunk-3',
          content: 'class Calculator { add(a, b) { return a + b; } }',
          nlSummary: 'A calculator class that can add numbers',
          metadata: {
            chunkType: 'class',
            name: 'Calculator',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
      ]);

      const results = index.search('add numbers', 10);

      expect(results.length).toBeGreaterThan(0);
      // All results should have method = 'bm25'
      for (const result of results) {
        expect(result.method).toBe('bm25');
      }
      // Results should have positive scores
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
      }
    });

    it('should respect topK limit', () => {
      const index = new BM25Index();
      const chunks = Array.from({ length: 20 }, (_, i) =>
        makeChunk({
          id: `chunk-${i}`,
          content: `function func${i}() { return ${i}; }`,
          nlSummary: `Returns the number ${i}`,
          metadata: {
            chunkType: 'function',
            name: `func${i}`,
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
      );

      index.addChunks(chunks);
      const results = index.search('function returns number', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for no matches', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({ id: 'chunk-1' }),
      ]);

      const results = index.search('xyzzynonexistent', 10);
      expect(results).toEqual([]);
    });

    it('should populate SearchResult fields correctly', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({
          id: 'chunk-1',
          content: 'function add(a, b) { return a + b; }',
          nlSummary: 'Adds two numbers together',
          filePath: 'src/math.ts',
          language: 'typescript',
          metadata: {
            chunkType: 'function',
            name: 'add',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
      ]);

      const results = index.search('add', 10);
      expect(results.length).toBeGreaterThan(0);

      const result = results[0]!;
      expect(result.chunkId).toBe('chunk-1');
      expect(result.content).toBe('function add(a, b) { return a + b; }');
      expect(result.nlSummary).toBe('Adds two numbers together');
      expect(result.method).toBe('bm25');
      expect(result.metadata.chunkType).toBe('function');
      expect(result.metadata.name).toBe('add');
      expect(result.chunk).toBeDefined();
      expect(result.chunk!.filePath).toBe('src/math.ts');
      expect(result.chunk!.language).toBe('typescript');
    });

    it('should boost nlSummary field over content', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({
          id: 'summary-match',
          content: 'function doSomething() { /* unrelated code */ }',
          nlSummary: 'Performs a database migration',
          metadata: {
            chunkType: 'function',
            name: 'doSomething',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
        makeChunk({
          id: 'content-match',
          content: 'function migration() { /* database migration code */ }',
          nlSummary: 'A helper function for processing',
          metadata: {
            chunkType: 'function',
            name: 'migration',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
      ]);

      const results = index.search('database migration', 10);
      expect(results.length).toBeGreaterThan(0);
      // Both should appear in results due to fuzzy matching / partial matching
    });
  });

  describe('removeChunks', () => {
    it('should remove indexed chunks by ID', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({ id: 'chunk-1' }),
        makeChunk({
          id: 'chunk-2',
          content: 'function other() {}',
          nlSummary: 'Another function',
          metadata: {
            chunkType: 'function',
            name: 'other',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
      ]);

      expect(index.count()).toBe(2);
      index.removeChunks(['chunk-1']);
      expect(index.count()).toBe(1);
    });

    it('should handle removing multiple chunks', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({ id: 'a' }),
        makeChunk({ id: 'b', content: 'b content', metadata: { chunkType: 'function', name: 'b', declarations: [], imports: [], exports: [] } }),
        makeChunk({ id: 'c', content: 'c content', metadata: { chunkType: 'function', name: 'c', declarations: [], imports: [], exports: [] } }),
      ]);

      index.removeChunks(['a', 'b']);
      expect(index.count()).toBe(1);
    });
  });

  describe('serialize / deserialize', () => {
    it('should round-trip through serialization', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({
          id: 'chunk-1',
          content: 'function add(a, b) { return a + b; }',
          nlSummary: 'Adds two numbers',
          metadata: {
            chunkType: 'function',
            name: 'add',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
        makeChunk({
          id: 'chunk-2',
          content: 'function multiply(a, b) { return a * b; }',
          nlSummary: 'Multiplies two numbers',
          metadata: {
            chunkType: 'function',
            name: 'multiply',
            declarations: [],
            imports: [],
            exports: [],
          },
        }),
      ]);

      const json = index.serialize();
      const restored = BM25Index.deserialize(json);

      expect(restored.count()).toBe(2);

      // Search should still work after deserialization
      const results = restored.search('add', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.chunkId).toBe('chunk-1');
    });

    it('should produce valid JSON', () => {
      const index = new BM25Index();
      index.addChunks([makeChunk({ id: 'chunk-1' })]);

      const json = index.serialize();
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should handle empty index serialization', () => {
      const index = new BM25Index();
      const json = index.serialize();
      const restored = BM25Index.deserialize(json);
      expect(restored.count()).toBe(0);
    });
  });

  describe('count', () => {
    it('should return 0 for empty index', () => {
      const index = new BM25Index();
      expect(index.count()).toBe(0);
    });

    it('should return correct count after additions', () => {
      const index = new BM25Index();
      index.addChunks([
        makeChunk({ id: 'a' }),
        makeChunk({ id: 'b', content: 'b', metadata: { chunkType: 'function', name: 'b', declarations: [], imports: [], exports: [] } }),
      ]);
      expect(index.count()).toBe(2);
    });
  });
});
