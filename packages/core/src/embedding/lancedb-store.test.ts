import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LanceDBStore } from './lancedb-store.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('LanceDBStore', () => {
  let tmpDir: string;
  let store: LanceDBStore;
  const DIMENSIONS = 4;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancedb-test-'));
    store = new LanceDBStore(tmpDir, DIMENSIONS);
    await store.connect();
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should expose the configured dimensions', () => {
      expect(store.dimensions).toBe(DIMENSIONS);
    });
  });

  describe('upsert', () => {
    it('should insert new records successfully', async () => {
      const result = await store.upsert(
        ['chunk-1', 'chunk-2'],
        [
          [1.0, 0.0, 0.0, 0.0],
          [0.0, 1.0, 0.0, 0.0],
        ],
        [
          {
            content: 'function add(a, b) { return a + b; }',
            nl_summary: 'Adds two numbers',
            chunk_type: 'function',
            file_path: 'src/utils.ts',
            language: 'typescript',
          },
          {
            content: 'function sub(a, b) { return a - b; }',
            nl_summary: 'Subtracts two numbers',
            chunk_type: 'function',
            file_path: 'src/utils.ts',
            language: 'typescript',
          },
        ],
      );

      expect(result.isOk()).toBe(true);
      const countResult = await store.count();
      expect(countResult.isOk()).toBe(true);
      const count = countResult.isOk() ? countResult.value : -1;
      expect(count).toBe(2);
    });

    it('should update existing records on upsert with same IDs', async () => {
      // Insert initial data
      await store.upsert(
        ['chunk-1'],
        [[1.0, 0.0, 0.0, 0.0]],
        [
          {
            content: 'original content',
            nl_summary: 'original summary',
            chunk_type: 'function',
            file_path: 'src/old.ts',
            language: 'typescript',
          },
        ],
      );

      // Upsert with same ID
      const result = await store.upsert(
        ['chunk-1'],
        [[0.0, 1.0, 0.0, 0.0]],
        [
          {
            content: 'updated content',
            nl_summary: 'updated summary',
            chunk_type: 'function',
            file_path: 'src/new.ts',
            language: 'typescript',
          },
        ],
      );

      expect(result.isOk()).toBe(true);
      const countResult = await store.count();
      expect(countResult.isOk()).toBe(true);
      const count = countResult.isOk() ? countResult.value : -1;
      expect(count).toBe(1);
    });

    it('should handle metadata with missing fields gracefully', async () => {
      const result = await store.upsert(
        ['chunk-1'],
        [[1.0, 0.0, 0.0, 0.0]],
        [{}],
      );

      expect(result.isOk()).toBe(true);
      const countResult = await store.count();
      expect(countResult.isOk()).toBe(true);
      const count = countResult.isOk() ? countResult.value : -1;
      expect(count).toBe(1);
    });
  });

  describe('query', () => {
    it('should return results sorted by similarity', async () => {
      await store.upsert(
        ['chunk-1', 'chunk-2', 'chunk-3'],
        [
          [1.0, 0.0, 0.0, 0.0],
          [0.9, 0.1, 0.0, 0.0],
          [0.0, 0.0, 0.0, 1.0],
        ],
        [
          {
            content: 'content-1',
            nl_summary: 'summary-1',
            chunk_type: 'function',
            file_path: 'a.ts',
            language: 'typescript',
          },
          {
            content: 'content-2',
            nl_summary: 'summary-2',
            chunk_type: 'function',
            file_path: 'b.ts',
            language: 'typescript',
          },
          {
            content: 'content-3',
            nl_summary: 'summary-3',
            chunk_type: 'function',
            file_path: 'c.ts',
            language: 'typescript',
          },
        ],
      );

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        // First result should be closest to the query vector
        expect(result.value[0]!.id).toBe('chunk-1');
        expect(result.value[0]!.score).toBeGreaterThan(0);
        expect(result.value[0]!.score).toBeLessThanOrEqual(1);
        // Second should be next closest
        expect(result.value[1]!.id).toBe('chunk-2');
      }
    });

    it('should return empty array when no table exists', async () => {
      const emptyStore = new LanceDBStore(tmpDir + '-empty', DIMENSIONS);
      const emptyDir = tmpDir + '-empty';
      fs.mkdirSync(emptyDir, { recursive: true });

      try {
        await emptyStore.connect();
        const result = await emptyStore.query([1.0, 0.0, 0.0, 0.0], 5);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value).toEqual([]);
        }
      } finally {
        emptyStore.close();
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('should respect topK limit', async () => {
      await store.upsert(
        ['a', 'b', 'c'],
        [
          [1.0, 0.0, 0.0, 0.0],
          [0.0, 1.0, 0.0, 0.0],
          [0.0, 0.0, 1.0, 0.0],
        ],
        [
          { content: '1', nl_summary: '', chunk_type: 'function', file_path: '', language: 'ts' },
          { content: '2', nl_summary: '', chunk_type: 'function', file_path: '', language: 'ts' },
          { content: '3', nl_summary: '', chunk_type: 'function', file_path: '', language: 'ts' },
        ],
      );

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
      }
    });

    it('should compute score from distance correctly', async () => {
      await store.upsert(
        ['exact-match'],
        [[1.0, 0.0, 0.0, 0.0]],
        [
          { content: 'exact', nl_summary: '', chunk_type: 'function', file_path: '', language: 'ts' },
        ],
      );

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Exact match => distance = 0 => score = 1/(1+0) = 1
        expect(result.value[0]!.score).toBeCloseTo(1.0, 1);
      }
    });
  });

  describe('delete', () => {
    it('should remove records by ID', async () => {
      await store.upsert(
        ['chunk-1', 'chunk-2'],
        [
          [1.0, 0.0, 0.0, 0.0],
          [0.0, 1.0, 0.0, 0.0],
        ],
        [
          { content: 'a', nl_summary: '', chunk_type: 'function', file_path: '', language: 'ts' },
          { content: 'b', nl_summary: '', chunk_type: 'function', file_path: '', language: 'ts' },
        ],
      );

      const result = await store.delete(['chunk-1']);
      expect(result.isOk()).toBe(true);

      const countResult = await store.count();
      expect(countResult.isOk()).toBe(true);
      const count = countResult.isOk() ? countResult.value : -1;
      expect(count).toBe(1);
    });

    it('should handle deleting non-existent IDs', async () => {
      await store.upsert(
        ['chunk-1'],
        [[1.0, 0.0, 0.0, 0.0]],
        [
          { content: 'a', nl_summary: '', chunk_type: 'function', file_path: '', language: 'ts' },
        ],
      );

      // Delete non-existent ID should not throw
      const result = await store.delete(['non-existent']);
      expect(result.isOk()).toBe(true);

      const countResult = await store.count();
      expect(countResult.isOk()).toBe(true);
      const count = countResult.isOk() ? countResult.value : -1;
      expect(count).toBe(1);
    });

    it('should return ok when table does not exist', async () => {
      const emptyDir = tmpDir + '-empty2';
      fs.mkdirSync(emptyDir, { recursive: true });
      const emptyStore = new LanceDBStore(emptyDir, DIMENSIONS);

      try {
        await emptyStore.connect();
        const result = await emptyStore.delete(['anything']);
        expect(result.isOk()).toBe(true);
      } finally {
        emptyStore.close();
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('count', () => {
    it('should return 0 for empty store', async () => {
      const emptyDir = tmpDir + '-empty3';
      fs.mkdirSync(emptyDir, { recursive: true });
      const emptyStore = new LanceDBStore(emptyDir, DIMENSIONS);

      try {
        await emptyStore.connect();
        const countResult = await emptyStore.count();
        expect(countResult.isOk()).toBe(true);
        const count = countResult.isOk() ? countResult.value : -1;
        expect(count).toBe(0);
      } finally {
        emptyStore.close();
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('should return correct count after inserts', async () => {
      await store.upsert(
        ['a', 'b', 'c'],
        [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
        ],
        [
          { content: '', nl_summary: '', chunk_type: '', file_path: '', language: '' },
          { content: '', nl_summary: '', chunk_type: '', file_path: '', language: '' },
          { content: '', nl_summary: '', chunk_type: '', file_path: '', language: '' },
        ],
      );

      const countResult = await store.count();
      expect(countResult.isOk()).toBe(true);
      const count = countResult.isOk() ? countResult.value : -1;
      expect(count).toBe(3);
    });
  });

  describe('close', () => {
    it('should be callable multiple times without error', () => {
      store.close();
      store.close(); // should not throw
    });
  });

  describe('connect', () => {
    it('should auto-connect on first operation', async () => {
      const freshStore = new LanceDBStore(tmpDir, DIMENSIONS);

      // Should auto-connect and work without explicit connect()
      const countResult = await freshStore.count();
      expect(countResult.isOk()).toBe(true);
      if (countResult.isOk()) {
        expect(countResult.value).toBeGreaterThanOrEqual(0);
      }
      freshStore.close();
    });
  });
});
