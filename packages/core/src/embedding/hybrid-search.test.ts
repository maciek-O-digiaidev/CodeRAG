import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';
import { HybridSearch } from './hybrid-search.js';
import { BM25Index } from './bm25-index.js';
import { EmbedError, StoreError } from '../types/provider.js';
import type { EmbeddingProvider, VectorStore } from '../types/provider.js';
import type { SearchConfig } from '../types/config.js';
import type { SearchResult } from '../types/search.js';
import type { ChunkMetadata } from '../types/chunk.js';

function createMockEmbeddingProvider(
  embeddings: number[][] = [[0.1, 0.2, 0.3]],
): EmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue(ok(embeddings)),
    dimensions: 3,
  };
}

function createMockVectorStore(
  results: { id: string; score: number; metadata?: Record<string, unknown> }[] = [],
): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(ok(undefined)),
    query: vi.fn().mockResolvedValue(ok(results)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    count: vi.fn().mockResolvedValue(ok(0)),
    close: vi.fn(),
  };
}

function createMockBM25Index(results: SearchResult[] = []): BM25Index {
  const index = new BM25Index();
  vi.spyOn(index, 'search').mockReturnValue(results);
  return index;
}

function makeSearchResult(overrides: Partial<SearchResult> & { chunkId: string }): SearchResult {
  const metadata: ChunkMetadata = {
    chunkType: 'function',
    name: overrides.chunkId,
    declarations: [],
    imports: [],
    exports: [],
  };
  return {
    content: `content of ${overrides.chunkId}`,
    nlSummary: `summary of ${overrides.chunkId}`,
    score: 1.0,
    method: 'bm25',
    metadata,
    ...overrides,
  };
}

const DEFAULT_CONFIG: SearchConfig = {
  topK: 10,
  vectorWeight: 0.7,
  bm25Weight: 0.3,
};

describe('HybridSearch', () => {
  let embeddingProvider: EmbeddingProvider;
  let vectorStore: VectorStore;
  let bm25Index: BM25Index;
  let hybridSearch: HybridSearch;

  beforeEach(() => {
    embeddingProvider = createMockEmbeddingProvider();
    vectorStore = createMockVectorStore([
      { id: 'chunk-1', score: 0.95, metadata: { content: 'vector content 1', nl_summary: 'vector summary 1', chunk_type: 'function', file_path: 'src/a.ts', language: 'typescript', name: 'chunk-1' } },
      { id: 'chunk-2', score: 0.80, metadata: { content: 'vector content 2', nl_summary: 'vector summary 2', chunk_type: 'class', file_path: 'src/b.ts', language: 'typescript', name: 'chunk-2' } },
      { id: 'chunk-3', score: 0.70, metadata: { content: 'vector content 3', nl_summary: 'vector summary 3', chunk_type: 'function', file_path: 'src/c.ts', language: 'typescript', name: 'chunk-3' } },
    ]);
    bm25Index = createMockBM25Index([
      makeSearchResult({ chunkId: 'chunk-2', score: 5.0 }),
      makeSearchResult({ chunkId: 'chunk-4', score: 3.0 }),
      makeSearchResult({ chunkId: 'chunk-1', score: 1.0 }),
    ]);
    hybridSearch = new HybridSearch(
      vectorStore,
      bm25Index,
      embeddingProvider,
      DEFAULT_CONFIG,
    );
  });

  describe('search', () => {
    it('should combine vector and BM25 results using RRF', async () => {
      const result = await hybridSearch.search('add numbers');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        // All results should have method 'hybrid'
        for (const r of result.value) {
          expect(r.method).toBe('hybrid');
        }
      }
    });

    it('should deduplicate results that appear in both searches', async () => {
      const result = await hybridSearch.search('add numbers');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const chunkIds = result.value.map((r) => r.chunkId);
        const uniqueIds = new Set(chunkIds);
        expect(chunkIds.length).toBe(uniqueIds.size);
      }
    });

    it('should embed the query text', async () => {
      await hybridSearch.search('test query');

      expect(embeddingProvider.embed).toHaveBeenCalledWith(['test query']);
    });

    it('should query vector store with embedded query', async () => {
      await hybridSearch.search('test query');

      expect(vectorStore.query).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        expect.any(Number),
      );
    });

    it('should query BM25 index with original query', async () => {
      await hybridSearch.search('test query');

      expect(bm25Index.search).toHaveBeenCalledWith(
        'test query',
        expect.any(Number),
      );
    });

    it('should fetch 2*topK from each source', async () => {
      await hybridSearch.search('test query');

      // Default topK is 10, so fetchK should be 20
      expect(vectorStore.query).toHaveBeenCalledWith(
        expect.any(Array),
        20,
      );
      expect(bm25Index.search).toHaveBeenCalledWith('test query', 20);
    });

    it('should respect custom topK option', async () => {
      await hybridSearch.search('test query', { topK: 5 });

      expect(vectorStore.query).toHaveBeenCalledWith(
        expect.any(Array),
        10, // 2 * 5
      );
      expect(bm25Index.search).toHaveBeenCalledWith('test query', 10);
    });

    it('should return at most topK results', async () => {
      const result = await hybridSearch.search('test query', { topK: 2 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeLessThanOrEqual(2);
      }
    });

    it('should sort results by fused score descending', async () => {
      const result = await hybridSearch.search('test query');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        for (let i = 1; i < result.value.length; i++) {
          expect(result.value[i - 1]!.score).toBeGreaterThanOrEqual(
            result.value[i]!.score,
          );
        }
      }
    });

    it('should apply vectorWeight and bm25Weight to RRF scores', async () => {
      // chunk-1 is rank 0 in vector (rrfScore = 1/61), rank 2 in BM25 (rrfScore = 1/63)
      // chunk-2 is rank 1 in vector (rrfScore = 1/62), rank 0 in BM25 (rrfScore = 1/61)
      const result = await hybridSearch.search('test query');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const chunk1 = result.value.find((r) => r.chunkId === 'chunk-1');
        const chunk2 = result.value.find((r) => r.chunkId === 'chunk-2');

        expect(chunk1).toBeDefined();
        expect(chunk2).toBeDefined();

        // chunk-1: vectorWeight * (1/61) + bm25Weight * (1/63)
        const expectedChunk1Score =
          0.7 * (1 / 61) + 0.3 * (1 / 63);
        // chunk-2: vectorWeight * (1/62) + bm25Weight * (1/61)
        const expectedChunk2Score =
          0.7 * (1 / 62) + 0.3 * (1 / 61);

        expect(chunk1!.score).toBeCloseTo(expectedChunk1Score, 6);
        expect(chunk2!.score).toBeCloseTo(expectedChunk2Score, 6);
      }
    });

    it('should use custom weights from options', async () => {
      const result = await hybridSearch.search('test query', {
        vectorWeight: 0.5,
        bm25Weight: 0.5,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const chunk1 = result.value.find((r) => r.chunkId === 'chunk-1');
        expect(chunk1).toBeDefined();

        const expectedScore = 0.5 * (1 / 61) + 0.5 * (1 / 63);
        expect(chunk1!.score).toBeCloseTo(expectedScore, 6);
      }
    });

    it('should handle results only in vector store', async () => {
      // chunk-3 only appears in vector results
      const result = await hybridSearch.search('test query');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const chunk3 = result.value.find((r) => r.chunkId === 'chunk-3');
        expect(chunk3).toBeDefined();
        // Only vector RRF score, no BM25 contribution
        const expectedScore = 0.7 * (1 / 63);
        expect(chunk3!.score).toBeCloseTo(expectedScore, 6);
      }
    });

    it('should hydrate vector-only results with metadata from vector store', async () => {
      // chunk-3 only appears in vector results (not in BM25)
      const result = await hybridSearch.search('test query');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const chunk3 = result.value.find((r) => r.chunkId === 'chunk-3');
        expect(chunk3).toBeDefined();
        expect(chunk3!.content).toBe('vector content 3');
        expect(chunk3!.nlSummary).toBe('vector summary 3');
        expect(chunk3!.metadata.name).toBe('chunk-3');
        expect(chunk3!.metadata.chunkType).toBe('function');
        expect(chunk3!.chunk).toBeDefined();
        expect(chunk3!.chunk!.filePath).toBe('src/c.ts');
        expect(chunk3!.chunk!.language).toBe('typescript');
      }
    });

    it('should handle results only in BM25 index', async () => {
      // chunk-4 only appears in BM25 results
      const result = await hybridSearch.search('test query');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const chunk4 = result.value.find((r) => r.chunkId === 'chunk-4');
        expect(chunk4).toBeDefined();
        // Only BM25 RRF score, no vector contribution
        const expectedScore = 0.3 * (1 / 62);
        expect(chunk4!.score).toBeCloseTo(expectedScore, 6);
      }
    });

    it('should return error when embedding fails', async () => {
      const failingProvider: EmbeddingProvider = {
        embed: vi
          .fn()
          .mockResolvedValue(err(new EmbedError('Embed failed'))),
        dimensions: 3,
      };

      const search = new HybridSearch(
        vectorStore,
        bm25Index,
        failingProvider,
        DEFAULT_CONFIG,
      );

      const result = await search.search('test');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('Embed failed');
      }
    });

    it('should return error when vector store query fails', async () => {
      const failingStore: VectorStore = {
        upsert: vi.fn().mockResolvedValue(ok(undefined)),
        query: vi
          .fn()
          .mockResolvedValue(err(new StoreError('Query failed'))),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
        count: vi.fn().mockResolvedValue(ok(0)),
        close: vi.fn(),
      };

      const search = new HybridSearch(
        failingStore,
        bm25Index,
        embeddingProvider,
        DEFAULT_CONFIG,
      );

      const result = await search.search('test');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('Query failed');
      }
    });

    it('should return error when embedding returns empty result', async () => {
      const emptyProvider: EmbeddingProvider = {
        embed: vi.fn().mockResolvedValue(ok([])),
        dimensions: 3,
      };

      const search = new HybridSearch(
        vectorStore,
        bm25Index,
        emptyProvider,
        DEFAULT_CONFIG,
      );

      const result = await search.search('test');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('Failed to generate query embedding');
      }
    });

    it('should handle empty results from both sources', async () => {
      const emptyVectorStore = createMockVectorStore([]);
      const emptyBM25 = createMockBM25Index([]);

      const search = new HybridSearch(
        emptyVectorStore,
        emptyBM25,
        embeddingProvider,
        DEFAULT_CONFIG,
      );

      const result = await search.search('test');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should include BM25 result content in final output', async () => {
      const result = await hybridSearch.search('test');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const chunk2 = result.value.find((r) => r.chunkId === 'chunk-2');
        expect(chunk2).toBeDefined();
        expect(chunk2!.content).toBe('content of chunk-2');
        expect(chunk2!.nlSummary).toBe('summary of chunk-2');
      }
    });
  });
});
