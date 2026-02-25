/**
 * Generic benchmark dataset types for the portable IR metrics runner.
 *
 * These types are provider-agnostic and work with any dataset format
 * (synthetic, external, or the existing coderag-queries.json).
 */

/** A single benchmark query with expected relevant chunk IDs. */
export interface GenericBenchmarkQuery {
  /** Unique identifier for the query. */
  readonly query: string;
  /** Ordered list of expected relevant chunk/document IDs. */
  readonly expectedChunkIds: readonly string[];
  /** Optional ground-truth context text (for context_recall metric). */
  readonly context?: string;
}

/** A benchmark dataset containing queries and optional metadata. */
export interface GenericBenchmarkDataset {
  readonly queries: readonly GenericBenchmarkQuery[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Result of computing all IR metrics for a single query. */
export interface QueryMetricsResult {
  readonly query: string;
  readonly retrievedIds: readonly string[];
  readonly expectedIds: readonly string[];
  readonly metrics: SingleQueryMetrics;
}

/** All metric values for a single query. */
export interface SingleQueryMetrics {
  readonly precisionAt5: number;
  readonly precisionAt10: number;
  readonly recallAt5: number;
  readonly recallAt10: number;
  readonly mrr: number;
  readonly ndcgAt10: number;
  readonly map: number;
  readonly contextPrecision: number;
  readonly contextRecall: number | null;
}

/** Aggregated metrics across all queries in a dataset. */
export interface AggregateMetrics {
  readonly precisionAt5: number;
  readonly precisionAt10: number;
  readonly recallAt5: number;
  readonly recallAt10: number;
  readonly mrr: number;
  readonly ndcgAt10: number;
  readonly map: number;
  readonly contextPrecision: number;
  readonly contextRecall: number | null;
}

/** Full report from a metrics runner execution. */
export interface MetricsReport {
  readonly perQuery: readonly QueryMetricsResult[];
  readonly aggregate: AggregateMetrics;
  readonly metadata: ReportMetadata;
}

/** Metadata about the benchmark run. */
export interface ReportMetadata {
  readonly datasetName: string;
  readonly timestamp: string;
  readonly queryCount: number;
}

/**
 * A retrieval function: given a query string, return an ordered list of chunk IDs.
 * The runner calls this for each query in the dataset.
 */
export type RetrievalFn = (query: string) => Promise<readonly string[]>;
