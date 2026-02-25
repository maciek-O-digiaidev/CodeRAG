/**
 * Benchmark evaluator that runs auto-generated queries through CodeRAG search
 * and computes IR metrics by comparing results to ground truth.
 *
 * Uses the portable IR metrics from @code-rag/benchmarks where possible,
 * but also includes a standalone implementation to avoid cross-package
 * dependency (core should not depend on benchmarks).
 */

import { ok, err, type Result } from 'neverthrow';
import type { GeneratedQuery, BenchmarkQueryType } from './query-generator.js';

/** Result of evaluating a single query. */
export interface QueryEvalResult {
  readonly query: string;
  readonly queryType: BenchmarkQueryType;
  readonly retrievedIds: readonly string[];
  readonly expectedIds: readonly string[];
  readonly metrics: QueryMetrics;
}

/** Metrics for a single query. */
export interface QueryMetrics {
  readonly precisionAt5: number;
  readonly precisionAt10: number;
  readonly recallAt10: number;
  readonly mrr: number;
  readonly ndcgAt10: number;
}

/** Aggregate metrics across all queries. */
export interface AggregateEvalMetrics {
  readonly precisionAt5: number;
  readonly precisionAt10: number;
  readonly recallAt10: number;
  readonly mrr: number;
  readonly ndcgAt10: number;
  readonly queryCount: number;
}

/** Breakdown of metrics per query type. */
export interface QueryTypeBreakdown {
  readonly queryType: BenchmarkQueryType;
  readonly metrics: AggregateEvalMetrics;
}

/** Full benchmark report. */
export interface BenchmarkReport {
  readonly aggregate: AggregateEvalMetrics;
  readonly byQueryType: readonly QueryTypeBreakdown[];
  readonly perQuery: readonly QueryEvalResult[];
  readonly metadata: BenchmarkMetadata;
}

/** Metadata about the benchmark run. */
export interface BenchmarkMetadata {
  readonly timestamp: string;
  readonly totalQueries: number;
  readonly totalChunksInIndex: number;
  readonly durationMs: number;
}

export class BenchmarkEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkEvalError';
  }
}

/** A function that performs search and returns ordered chunk IDs. */
export type SearchFn = (query: string) => Promise<readonly string[]>;

// --- Standalone IR metric functions (no external dependency) ---

function precisionAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0 || retrieved.length === 0) return 0;
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const item of topK) {
    if (relevant.has(item)) hits++;
  }
  return hits / k;
}

function recallAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0 || relevant.size === 0) return 0;
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const item of topK) {
    if (relevant.has(item)) hits++;
  }
  return hits / relevant.size;
}

function mrr(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
): number {
  for (let i = 0; i < retrieved.length; i++) {
    const item = retrieved[i];
    if (item !== undefined && relevant.has(item)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function ndcgAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0 || relevant.size === 0) return 0;
  const topK = retrieved.slice(0, k);

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const item = topK[i];
    if (item !== undefined && relevant.has(item)) {
      dcg += 1 / Math.log2(i + 2);
    }
  }

  const idealCount = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Compute metrics for a single query result.
 */
export function computeQueryMetrics(
  retrieved: readonly string[],
  expected: readonly string[],
): QueryMetrics {
  const relevantSet = new Set(expected);
  return {
    precisionAt5: precisionAtK(retrieved, relevantSet, 5),
    precisionAt10: precisionAtK(retrieved, relevantSet, 10),
    recallAt10: recallAtK(retrieved, relevantSet, 10),
    mrr: mrr(retrieved, relevantSet),
    ndcgAt10: ndcgAtK(retrieved, relevantSet, 10),
  };
}

/**
 * Compute aggregate metrics by averaging per-query metrics.
 */
export function computeAggregateMetrics(
  results: readonly QueryEvalResult[],
): AggregateEvalMetrics {
  if (results.length === 0) {
    return {
      precisionAt5: 0,
      precisionAt10: 0,
      recallAt10: 0,
      mrr: 0,
      ndcgAt10: 0,
      queryCount: 0,
    };
  }

  let sumP5 = 0;
  let sumP10 = 0;
  let sumR10 = 0;
  let sumMrr = 0;
  let sumNdcg = 0;

  for (const result of results) {
    sumP5 += result.metrics.precisionAt5;
    sumP10 += result.metrics.precisionAt10;
    sumR10 += result.metrics.recallAt10;
    sumMrr += result.metrics.mrr;
    sumNdcg += result.metrics.ndcgAt10;
  }

  const count = results.length;
  return {
    precisionAt5: sumP5 / count,
    precisionAt10: sumP10 / count,
    recallAt10: sumR10 / count,
    mrr: sumMrr / count,
    ndcgAt10: sumNdcg / count,
    queryCount: count,
  };
}

/**
 * Group results by query type and compute per-type aggregates.
 */
export function computeQueryTypeBreakdown(
  results: readonly QueryEvalResult[],
): readonly QueryTypeBreakdown[] {
  const groups = new Map<BenchmarkQueryType, QueryEvalResult[]>();

  for (const result of results) {
    const existing = groups.get(result.queryType);
    if (existing) {
      existing.push(result);
    } else {
      groups.set(result.queryType, [result]);
    }
  }

  const breakdowns: QueryTypeBreakdown[] = [];
  for (const [queryType, groupResults] of groups) {
    breakdowns.push({
      queryType,
      metrics: computeAggregateMetrics(groupResults),
    });
  }

  // Sort by query type for consistent output
  breakdowns.sort((a, b) => a.queryType.localeCompare(b.queryType));
  return breakdowns;
}

/** Progress callback for benchmark evaluation. */
export type BenchmarkProgressFn = (completed: number, total: number) => void;

/**
 * Run the full benchmark evaluation.
 *
 * For each generated query, calls the search function and computes metrics
 * by comparing retrieved chunk IDs to the ground-truth expected IDs.
 */
export async function runBenchmark(
  queries: readonly GeneratedQuery[],
  searchFn: SearchFn,
  totalChunksInIndex: number,
  onProgress?: BenchmarkProgressFn,
): Promise<Result<BenchmarkReport, BenchmarkEvalError>> {
  try {
    const startTime = Date.now();
    const perQuery: QueryEvalResult[] = [];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i]!;
      const retrievedIds = await searchFn(query.query);
      const metrics = computeQueryMetrics(retrievedIds, query.expectedChunkIds);

      perQuery.push({
        query: query.query,
        queryType: query.queryType,
        retrievedIds,
        expectedIds: query.expectedChunkIds,
        metrics,
      });

      if (onProgress) {
        onProgress(i + 1, queries.length);
      }
    }

    const durationMs = Date.now() - startTime;
    const aggregate = computeAggregateMetrics(perQuery);
    const byQueryType = computeQueryTypeBreakdown(perQuery);

    return ok({
      aggregate,
      byQueryType,
      perQuery,
      metadata: {
        timestamp: new Date().toISOString(),
        totalQueries: queries.length,
        totalChunksInIndex,
        durationMs,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return err(new BenchmarkEvalError(`Benchmark evaluation failed: ${message}`));
  }
}

/**
 * Format a BenchmarkReport as a human-readable summary table string.
 */
export function formatBenchmarkSummary(report: BenchmarkReport): string {
  const lines: string[] = [];
  const a = report.aggregate;

  lines.push('Benchmark Results');
  lines.push('=================');
  lines.push(`Queries: ${report.metadata.totalQueries}`);
  lines.push(`Index size: ${report.metadata.totalChunksInIndex} chunks`);
  lines.push(`Duration: ${(report.metadata.durationMs / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push('Aggregate Metrics:');
  lines.push(`  P@5:       ${fmt(a.precisionAt5)}`);
  lines.push(`  P@10:      ${fmt(a.precisionAt10)}`);
  lines.push(`  Recall@10: ${fmt(a.recallAt10)}`);
  lines.push(`  MRR:       ${fmt(a.mrr)}`);
  lines.push(`  nDCG@10:   ${fmt(a.ndcgAt10)}`);

  if (report.byQueryType.length > 0) {
    lines.push('');
    lines.push('By Query Type:');
    lines.push('  Type                 | Count |  P@5  | P@10  | R@10  |  MRR  | nDCG@10');
    lines.push('  ---------------------|-------|-------|-------|-------|-------|--------');
    for (const bt of report.byQueryType) {
      const m = bt.metrics;
      const type = bt.queryType.padEnd(20);
      lines.push(
        `  ${type} | ${String(m.queryCount).padStart(5)} | ${fmt(m.precisionAt5)} | ${fmt(m.precisionAt10)} | ${fmt(m.recallAt10)} | ${fmt(m.mrr)} | ${fmt(m.ndcgAt10)}`,
      );
    }
  }

  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toFixed(4).padStart(6);
}
