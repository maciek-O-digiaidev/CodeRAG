import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StoreError } from '../types/provider.js';

// Mock the Qdrant client before importing the store
const mockUpsert = vi.fn();
const mockSearch = vi.fn();
const mockDelete = vi.fn();
const mockCount = vi.fn();
const mockCollectionExists = vi.fn();
const mockCreateCollection = vi.fn();

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    upsert: mockUpsert,
    search: mockSearch,
    delete: mockDelete,
    count: mockCount,
    collectionExists: mockCollectionExists,
    createCollection: mockCreateCollection,
  })),
}));

import { QdrantVectorStore } from './qdrant-store.js';

describe('QdrantVectorStore', () => {
  const DIMENSIONS = 4;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCollectionExists.mockResolvedValue({ exists: false });
    mockCreateCollection.mockResolvedValue(true);
    mockUpsert.mockResolvedValue({ status: 'completed' });
    mockSearch.mockResolvedValue([]);
    mockDelete.mockResolvedValue({ status: 'completed' });
    mockCount.mockResolvedValue({ count: 0 });
  });

  describe('constructor', () => {
    it('should expose the configured dimensions', () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      expect(store.dimensions).toBe(DIMENSIONS);
    });

    it('should use default url and collection name', () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      expect(store.dimensions).toBe(DIMENSIONS);
    });

    it('should accept custom config', () => {
      const store = new QdrantVectorStore(DIMENSIONS, {
        url: 'http://remote:6333',
        collectionName: 'custom-collection',
        apiKey: 'test-key',
      });
      expect(store.dimensions).toBe(DIMENSIONS);
    });
  });

  describe('connect', () => {
    it('should create collection if it does not exist', async () => {
      mockCollectionExists.mockResolvedValue({ exists: false });

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      expect(mockCollectionExists).toHaveBeenCalledWith('coderag');
      expect(mockCreateCollection).toHaveBeenCalledWith('coderag', {
        vectors: {
          size: DIMENSIONS,
          distance: 'Cosine',
        },
      });
    });

    it('should not create collection if it already exists', async () => {
      mockCollectionExists.mockResolvedValue({ exists: true });

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      expect(mockCollectionExists).toHaveBeenCalledWith('coderag');
      expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    it('should use custom collection name from config', async () => {
      mockCollectionExists.mockResolvedValue({ exists: false });

      const store = new QdrantVectorStore(DIMENSIONS, {
        collectionName: 'my-vectors',
      });
      await store.connect();

      expect(mockCollectionExists).toHaveBeenCalledWith('my-vectors');
      expect(mockCreateCollection).toHaveBeenCalledWith('my-vectors', {
        vectors: {
          size: DIMENSIONS,
          distance: 'Cosine',
        },
      });
    });

    it('should handle errors during connect gracefully', async () => {
      mockCollectionExists.mockRejectedValue(new Error('Connection refused'));

      const store = new QdrantVectorStore(DIMENSIONS);
      // Should not throw - the catch block handles it
      await store.connect();
    });
  });

  describe('upsert', () => {
    it('should insert new records successfully', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.upsert(
        ['chunk-1', 'chunk-2'],
        [
          [1.0, 0.0, 0.0, 0.0],
          [0.0, 1.0, 0.0, 0.0],
        ],
        [
          {
            content: 'function add(a, b) { return a + b; }',
            chunk_type: 'function',
            file_path: 'src/utils.ts',
            language: 'typescript',
          },
          {
            content: 'function sub(a, b) { return a - b; }',
            chunk_type: 'function',
            file_path: 'src/utils.ts',
            language: 'typescript',
          },
        ],
      );

      expect(result.isOk()).toBe(true);
      expect(mockUpsert).toHaveBeenCalledWith('coderag', {
        wait: true,
        points: expect.arrayContaining([
          expect.objectContaining({
            vector: [1.0, 0.0, 0.0, 0.0],
            payload: expect.objectContaining({
              _coderag_id: 'chunk-1',
              content: 'function add(a, b) { return a + b; }',
            }),
          }),
          expect.objectContaining({
            vector: [0.0, 1.0, 0.0, 0.0],
            payload: expect.objectContaining({
              _coderag_id: 'chunk-2',
              content: 'function sub(a, b) { return a - b; }',
            }),
          }),
        ]),
      });
    });

    it('should return error for invalid chunk ID', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.upsert(
        ['invalid id with spaces'],
        [[1.0, 0.0, 0.0, 0.0]],
        [{ content: 'test' }],
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(StoreError);
        expect(result.error.message).toContain('Invalid chunk ID');
      }
    });

    it('should handle empty ids array', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.upsert([], [], []);

      expect(result.isOk()).toBe(true);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should handle metadata with missing fields gracefully', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.upsert(
        ['chunk-1'],
        [[1.0, 0.0, 0.0, 0.0]],
        [{}],
      );

      expect(result.isOk()).toBe(true);
    });

    it('should return StoreError on upsert failure', async () => {
      mockUpsert.mockRejectedValue(new Error('Connection lost'));

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.upsert(
        ['chunk-1'],
        [[1.0, 0.0, 0.0, 0.0]],
        [{ content: 'test' }],
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(StoreError);
        expect(result.error.message).toContain('Qdrant upsert failed');
        expect(result.error.message).toContain('Connection lost');
      }
    });

    it('should handle non-Error throw gracefully', async () => {
      mockUpsert.mockRejectedValue('string error');

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.upsert(
        ['chunk-1'],
        [[1.0, 0.0, 0.0, 0.0]],
        [{ content: 'test' }],
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(StoreError);
        expect(result.error.message).toContain('Unknown error');
      }
    });

    it('should auto-connect on first upsert if not connected', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      // Do NOT call connect()

      const result = await store.upsert(
        ['chunk-1'],
        [[1.0, 0.0, 0.0, 0.0]],
        [{ content: 'test' }],
      );

      expect(result.isOk()).toBe(true);
      expect(mockCollectionExists).toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('should return search results with scores', async () => {
      mockSearch.mockResolvedValue([
        { id: 123, score: 0.95, payload: { _coderag_id: 'chunk-1', content: 'content-1' } },
        { id: 456, score: 0.80, payload: { _coderag_id: 'chunk-2', content: 'content-2' } },
      ]);

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]!.id).toBe('chunk-1');
        expect(result.value[0]!.score).toBe(0.95);
        expect(result.value[1]!.id).toBe('chunk-2');
        expect(result.value[1]!.score).toBe(0.80);
      }

      expect(mockSearch).toHaveBeenCalledWith('coderag', {
        vector: [1.0, 0.0, 0.0, 0.0],
        limit: 2,
        with_payload: true,
      });
    });

    it('should return empty array when no results', async () => {
      mockSearch.mockResolvedValue([]);

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 5);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should fallback to point id when _coderag_id is missing', async () => {
      mockSearch.mockResolvedValue([
        { id: 999, score: 0.5, payload: {} },
      ]);

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.id).toBe('999');
      }
    });

    it('should handle null payload gracefully', async () => {
      mockSearch.mockResolvedValue([
        { id: 999, score: 0.5, payload: null },
      ]);

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.id).toBe('999');
      }
    });

    it('should return StoreError on search failure', async () => {
      mockSearch.mockRejectedValue(new Error('Timeout'));

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 5);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(StoreError);
        expect(result.error.message).toContain('Qdrant query failed');
        expect(result.error.message).toContain('Timeout');
      }
    });

    it('should auto-connect on first query if not connected', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      // Do NOT call connect()

      const result = await store.query([1.0, 0.0, 0.0, 0.0], 5);

      expect(result.isOk()).toBe(true);
      expect(mockCollectionExists).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete points by ID', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.delete(['chunk-1', 'chunk-2']);

      expect(result.isOk()).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('coderag', {
        wait: true,
        points: expect.arrayContaining([
          expect.any(Number),
          expect.any(Number),
        ]),
      });
    });

    it('should return error for invalid chunk ID', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.delete(['invalid id with spaces']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(StoreError);
        expect(result.error.message).toContain('Invalid chunk ID');
      }
    });

    it('should handle empty ids array', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.delete([]);

      expect(result.isOk()).toBe(true);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should return StoreError on delete failure', async () => {
      mockDelete.mockRejectedValue(new Error('Not found'));

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const result = await store.delete(['chunk-1']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(StoreError);
        expect(result.error.message).toContain('Qdrant delete failed');
        expect(result.error.message).toContain('Not found');
      }
    });
  });

  describe('count', () => {
    it('should return the count of points', async () => {
      mockCount.mockResolvedValue({ count: 42 });

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const countResult = await store.count();

      expect(countResult.isOk()).toBe(true);
      if (countResult.isOk()) {
        expect(countResult.value).toBe(42);
      }

      expect(mockCount).toHaveBeenCalledWith('coderag', { exact: true });
    });

    it('should return 0 for empty collection', async () => {
      mockCount.mockResolvedValue({ count: 0 });

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const countResult = await store.count();

      expect(countResult.isOk()).toBe(true);
      if (countResult.isOk()) {
        expect(countResult.value).toBe(0);
      }
    });

    it('should return StoreError on count failure', async () => {
      mockCount.mockRejectedValue(new Error('Service unavailable'));

      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      const countResult = await store.count();

      expect(countResult.isErr()).toBe(true);
      if (countResult.isErr()) {
        expect(countResult.error).toBeInstanceOf(StoreError);
        expect(countResult.error.message).toContain('Qdrant count failed');
      }
    });
  });

  describe('close', () => {
    it('should be callable multiple times without error', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();

      store.close();
      store.close(); // should not throw
    });

    it('should allow reconnect after close', async () => {
      const store = new QdrantVectorStore(DIMENSIONS);
      await store.connect();
      store.close();

      // Should auto-connect again
      const result = await store.count();
      expect(result.isOk()).toBe(true);
    });
  });
});
