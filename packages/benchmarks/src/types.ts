/**
 * Benchmark dataset type definitions.
 *
 * These interfaces define the schema for curated benchmark queries
 * used to evaluate CodeRAG search quality against baselines.
 */

export interface BenchmarkDataset {
  name: string;
  description: string;
  targetRepo: string;
  queries: BenchmarkQuery[];
}

export type QueryDifficulty = 'easy' | 'medium' | 'hard';

export type QueryCategory =
  | 'function_lookup'
  | 'concept_search'
  | 'cross_file'
  | 'error_investigation';

export interface BenchmarkQuery {
  id: string;
  query: string;
  difficulty: QueryDifficulty;
  category: QueryCategory;
  expectedChunks: ExpectedChunk[];
  tags: string[];
}

export type ChunkRelevance = 'primary' | 'secondary';

export interface ExpectedChunk {
  /** Relative file path, e.g. "packages/core/src/embedding/hybrid-search.ts" */
  filePath: string;
  /** Chunk type, e.g. "function", "class", "method" */
  chunkType: string;
  /** Symbol name, e.g. "HybridSearch", "search" */
  name: string;
  /** Whether this chunk is a primary or secondary expected result */
  relevance: ChunkRelevance;
}

/** Aggregate metrics for a benchmark run. */
export interface BenchmarkMetrics {
  precisionAt5: number;
  precisionAt10: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
}

/** Result of running a single query through a runner. */
export interface QueryRunResult {
  queryId: string;
  query: string;
  retrievedPaths: string[];
  relevantPaths: string[];
  durationMs: number;
  metrics: {
    precisionAt5: number;
    precisionAt10: number;
    recallAt5: number;
    recallAt10: number;
    mrr: number;
    ndcgAt10: number;
  };
}

/** Full benchmark report for a single runner. */
export interface BenchmarkReport {
  runner: string;
  timestamp: string;
  totalQueries: number;
  aggregateMetrics: BenchmarkMetrics;
  queryResults: QueryRunResult[];
}
