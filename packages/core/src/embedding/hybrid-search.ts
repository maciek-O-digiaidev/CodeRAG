import { ok, err, type Result } from 'neverthrow';
import { EmbedError, type EmbeddingProvider, type VectorStore } from '../types/provider.js';
import type { SearchConfig } from '../types/config.js';
import type { SearchOptions, SearchResult } from '../types/search.js';
import type { ChunkMetadata, ChunkType } from '../types/chunk.js';
import type { BM25Index } from './bm25-index.js';
import { safeString, safeStringUnion } from '../utils/safe-cast.js';

const RRF_K = 60;
const CHUNK_TYPES: readonly ChunkType[] = [
  'function', 'method', 'class', 'module', 'interface',
  'type_alias', 'config_block', 'import_block', 'doc',
] as const;

export class HybridSearch {
  private readonly vectorStore: VectorStore;
  private readonly bm25Index: BM25Index;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly config: SearchConfig;

  constructor(
    vectorStore: VectorStore,
    bm25Index: BM25Index,
    embeddingProvider: EmbeddingProvider,
    config: SearchConfig,
  ) {
    this.vectorStore = vectorStore;
    this.bm25Index = bm25Index;
    this.embeddingProvider = embeddingProvider;
    this.config = config;
  }

  async search(
    query: string,
    options?: SearchOptions,
  ): Promise<Result<SearchResult[], EmbedError>> {
    const topK = options?.topK ?? this.config.topK;
    const vectorWeight = options?.vectorWeight ?? this.config.vectorWeight;
    const bm25Weight = options?.bm25Weight ?? this.config.bm25Weight;
    const fetchK = topK * 2;

    // Step a) Embed query and perform vector search
    const embedResult = await this.embeddingProvider.embed([query]);
    if (embedResult.isErr()) {
      return err(embedResult.error);
    }

    const queryEmbedding = embedResult.value[0];
    if (!queryEmbedding) {
      return err(new EmbedError('Failed to generate query embedding'));
    }

    const vectorResult = await this.vectorStore.query(queryEmbedding, fetchK);
    if (vectorResult.isErr()) {
      return err(
        new EmbedError(`Vector search failed: ${vectorResult.error.message}`),
      );
    }

    const vectorResults = vectorResult.value;

    // Step b) BM25 search
    const bm25Results = this.bm25Index.search(query, fetchK);

    // Step c) Reciprocal Rank Fusion
    const fusedScores = new Map<
      string,
      { vectorScore: number; bm25Score: number; result?: SearchResult }
    >();
    const vectorMetadataMap = new Map<string, Record<string, unknown>>();

    // Process vector results with RRF
    for (let rank = 0; rank < vectorResults.length; rank++) {
      const item = vectorResults[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);
      if (item.metadata) {
        vectorMetadataMap.set(item.id, item.metadata);
      }
      const existing = fusedScores.get(item.id);
      if (existing) {
        existing.vectorScore = rrfScore;
      } else {
        fusedScores.set(item.id, {
          vectorScore: rrfScore,
          bm25Score: 0,
        });
      }
    }

    // Process BM25 results with RRF
    for (let rank = 0; rank < bm25Results.length; rank++) {
      const item = bm25Results[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = fusedScores.get(item.chunkId);
      if (existing) {
        existing.bm25Score = rrfScore;
        existing.result = item;
      } else {
        fusedScores.set(item.chunkId, {
          vectorScore: 0,
          bm25Score: rrfScore,
          result: item,
        });
      }
    }

    // Step d) Merge, deduplicate, apply weights, sort by fused score
    const merged: SearchResult[] = [];
    for (const [chunkId, scores] of fusedScores) {
      const fusedScore =
        vectorWeight * scores.vectorScore + bm25Weight * scores.bm25Score;

      if (scores.result) {
        merged.push({
          ...scores.result,
          chunkId,
          score: fusedScore,
          method: 'hybrid',
        });
      } else {
        // Vector-only hit: hydrate from vector store metadata
        const meta = vectorMetadataMap.get(chunkId) ?? {};
        const storedName = safeString(meta['name'], '');
        const storedChunkType = safeStringUnion(meta['chunk_type'], CHUNK_TYPES, 'function');
        const storedFilePath = safeString(meta['file_path'], '');
        const storedLanguage = safeString(meta['language'], 'unknown');
        const storedContent = safeString(meta['content'], '');
        const storedNlSummary = safeString(meta['nl_summary'], '');

        const chunkMetadata: ChunkMetadata = {
          chunkType: storedChunkType,
          name: storedName,
          declarations: [],
          imports: [],
          exports: [],
        };

        merged.push({
          chunkId,
          content: storedContent,
          nlSummary: storedNlSummary,
          score: fusedScore,
          method: 'hybrid',
          metadata: chunkMetadata,
          chunk: {
            id: chunkId,
            content: storedContent,
            nlSummary: storedNlSummary,
            filePath: storedFilePath,
            startLine: 0,
            endLine: 0,
            language: storedLanguage,
            metadata: chunkMetadata,
          },
        });
      }
    }

    // Step e) Sort by fused score descending and return top_k
    merged.sort((a, b) => b.score - a.score);
    return ok(merged.slice(0, topK));
  }
}
